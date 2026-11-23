#!/usr/bin/env node
/**
 * Captures d'écran de la documentation (docs/SCREENSHOTS.md).
 *
 * Lance l'application Electron (dist/ doit être construit : npm run build) avec
 * un profil vierge, crée une compétition de démonstration puis photographie
 * chaque menu dans docs/screenshots/.
 *
 * Usage : npm run docs:screenshots
 * Linux sans écran : xvfb-run -a npm run docs:screenshots
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('@playwright/test');
// Appareils de piste simulés (npm run cyrano:sim) : captures des appareils et du pilotage
const { CyranoDevice } = require('./lib/cyranoDevice');
const CYRANO_PORT = 51100;
const DEVICE_PORT = 51101;

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');
const VIEWPORT = { width: 1400, height: 860 };

// Tireurs fictifs de la compétition de démonstration
const FENCERS = [
  ['MARTIN', 'Lucas', 'Paris Escrime'],
  ['BERNARD', 'Emma', 'CE Lyon'],
  ['DUBOIS', 'Hugo', 'Bordeaux EC'],
  ['THOMAS', 'Léa', 'Lille Escrime'],
  ['ROBERT', 'Louis', 'Marseille CE'],
  ['RICHARD', 'Chloé', 'Paris Escrime'],
  ['PETIT', 'Jules', 'CE Lyon'],
  ['DURAND', 'Manon', 'Nantes Escrime'],
  ['LEROY', 'Gabriel', 'Bordeaux EC'],
  ['MOREAU', 'Camille', 'Toulouse EC'],
  ['SIMON', 'Arthur', 'Lille Escrime'],
  ['LAURENT', 'Inès', 'Marseille CE'],
  ['LEFEBVRE', 'Raphaël', 'Nantes Escrime'],
  ['MICHEL', 'Sarah', 'Toulouse EC'],
  ['GARCIA', 'Nathan', 'Rennes Escrime'],
  ['DAVID', 'Jade', 'Rennes Escrime'],
  ['BERTRAND', 'Tom', 'Paris Escrime'],
  ['ROUX', 'Lina', 'CE Lyon'],
];

const wait = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-screens-'));
  const app = await electron.launch({
    args: ['.', '--no-sandbox', `--user-data-dir=${userData}`, '--lang=fr'],
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'production' },
  });

  /** Appareils Cyrano simulés des pistes 1 à 4 de la salle (127.0.0.31 à .34) */
  const devices = [1, 2, 3, 4].map(
    n =>
      new CyranoDevice({
        piste: String(n),
        port: DEVICE_PORT,
        bind: `127.0.0.${30 + n}`,
        serverPort: CYRANO_PORT,
      })
  );
  try {
    // Splash → fenêtre principale
    await app.firstWindow();
    await wait(1500);
    const splash = app.windows().find(w => w.url().includes('splash'));
    if (splash) await splash.click('text=Entrer dans BellePoule').catch(() => {});
    let win;
    for (let i = 0; i < 40 && !win; i++) {
      win = app.windows().find(w => !w.url().includes('splash'));
      if (!win) await wait(500);
    }
    if (!win) throw new Error('Fenêtre principale introuvable');
    await win.setViewportSize(VIEWPORT);
    await win.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await win.waitForTimeout(2500);

    const click = sel => win.locator(sel).first().click({ timeout: 10000 });
    const confirm = () => click('.modal-footer .btn-primary');
    const phase = label => click(`.phase-step:has-text("${label}")`);
    const shot = async name => {
      await win.mouse.move(VIEWPORT.width - 5, VIEWPORT.height - 5);
      await win.waitForTimeout(1200);
      // Masque toasts et confettis ; remplace le dossier personnel par ~
      await win.evaluate(home => {
        document
          .querySelectorAll('[role="status"][aria-live], canvas, [role="tooltip"]')
          .forEach(el => (el.style.display = 'none'));
        // Bulles d'aide ponctuelles (coach marks)
        document
          .querySelectorAll('.coach-dismiss')
          .forEach(el => (el.parentElement.style.display = 'none'));
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (n.nodeValue.includes(home)) n.nodeValue = n.nodeValue.split(home).join('~');
        }
      }, os.homedir());
      await win.screenshot({ path: path.join(OUT, `${name}.png`) });
      console.log(`✓ ${name}.png`);
    };

    await shot('01-accueil');

    await click('button:has-text("Nouvelle compétition")');
    await shot('02-nouvelle-competition');
    await click('.btn-close');

    // Compétition de démonstration
    await win.evaluate(async fencers => {
      const db = window.electronAPI.db;
      const c = await db.createCompetition({
        title: 'Challenge de la Ville — Épée Senior',
        date: new Date('2026-11-14'),
        location: 'Gymnase Jean Moulin',
        weapon: 'E',
        gender: 'X',
        category: 'SEN',
        color: '#3b5bdb',
        settings: {
          defaultPoolMaxScore: 5,
          defaultTableMaxScore: 15,
          defaultPoolTimerSeconds: 180,
          defaultTableTimerSeconds: 180,
          poolRounds: 1,
          hasDirectElimination: true,
          thirdPlaceMatch: true,
          manualRanking: false,
          defaultRanking: 9999,
          randomScore: false,
          minTeamSize: 3,
        },
      });
      let i = 0;
      for (const [lastName, firstName, club] of fencers) {
        i++;
        await db.addFencer(c.id, {
          lastName,
          firstName,
          club,
          gender: i % 2 ? 'M' : 'F',
          nationality: 'FRA',
          ranking: i,
          status: 'N',
        });
      }
    }, FENCERS);
    // Salle par défaut et ses appareils (#2117, docs/adr/0023) : pistes 1 à 4 Cyrano (appareils
    // simulés), 5 et 6 OPP2 ; pilote Cyrano démarré
    await win.evaluate(
      async ({ cyranoPort, devicePort }) => {
        const call = async (name, input) => {
          const r = await window.electronAPI.api.invoke(name, input);
          if (!r.ok) throw new Error(`${name} : ${r.error.message}`);
          return r.data;
        };
        localStorage.setItem('bellepoule-cyrano-port', String(cyranoPort));
        const venue = await call('saveVenue', { name: 'Gymnase Jean Moulin', stripCount: 6 });
        await call('setStripDevices', {
          venueId: venue.id,
          devices: [
            ...[1, 2, 3, 4].map(n => ({
              strip: n,
              ...(n === 1 ? { label: 'Podium' } : {}),
              device: {
                protocol: 'cyrano',
                ip: `127.0.0.${30 + n}`,
                port: devicePort,
                version: 'EFP1.1',
              },
            })),
            { strip: 5, device: { protocol: 'opp2', opp2Id: 'rouge' } },
            { strip: 6, device: { protocol: 'opp2', opp2Id: 'bleue' } },
          ],
        });
        await call('startCyranoServer', { port: cyranoPort });
      },
      { cyranoPort: CYRANO_PORT, devicePort: DEVICE_PORT }
    );
    await Promise.all(devices.map(d => d.start()));
    // Piste 4 : appareil vu puis éteint (hors ligne 40 s plus tard)
    devices[3].sendInfo();
    await wait(1500);
    devices[3].stop();
    await win.reload();
    await win.waitForTimeout(2500);

    await click('text=Ouvrir →');
    await win.waitForTimeout(1500);
    await click('text=✓ Tout pointer');
    await shot('04-appel');

    await click('button:has-text("Préparer les poules")');
    await shot('05-preparation');

    await click('button:has-text("Lancer les poules")');
    await win.waitForTimeout(1500);
    const autofill = win.locator('button.pv-icon-btn.is-amber');
    await autofill.first().waitFor({ timeout: 15000 });
    await win.waitForTimeout(1000);
    const pools = await autofill.count();
    for (let i = 0; i < pools; i++) {
      await autofill.nth(i).click();
      await confirm();
      await win.waitForTimeout(800);
    }
    await win.evaluate(() => window.scrollTo(0, 0));
    await win.locator('.phase-nav').scrollIntoViewIfNeeded();
    await shot('06-poules');

    await phase('Classement');
    await shot('07-classement');

    await click('button:has-text("Passer au tableau")');
    await win.waitForTimeout(1500);
    // Confirmation éventuelle (selon la version de l'écran)
    await click('button:has-text("Oui")').catch(() => {});
    await win.waitForTimeout(1500);
    await click('.tableau-fab-trigger');
    await click('.tableau-fab-item:has-text("Remplir auto")');
    await confirm();
    await phase('Tableau');
    await shot('08-tableau');

    await phase('Résultats');
    await shot('09-resultats');

    // Saisie distante : bouton du bandeau (plus une phase), puis onglet Expert et appareils Cyrano
    await click('button:has-text("Saisie distante / Piste")');
    await win.waitForTimeout(1500);
    await click('button:has-text("Démarrer la saisie distante")');
    await win.waitForTimeout(4000);
    await click('.rsm-fold[data-section="strips"] .rsm-fold-header').catch(() => {});
    await shot('10-saisie-distante');
    await click('button:has-text("Expert")');
    await win.waitForTimeout(800);
    const cyrano = win.locator('.rsm-fold[data-section="cyrano"] .rsm-fold-header').first();
    if ((await cyrano.getAttribute('aria-expanded')) !== 'true') await cyrano.click();
    await win.waitForTimeout(800);
    await win.locator('.rsm-fold[data-section="cyrano"]').scrollIntoViewIfNeeded();
    await shot('17-appareils-piste');
    await click('button:has-text("Basique")');

    await phase('Historique');
    await shot('11-historique');

    await click('.comp-header-menu-btn[aria-label="Actions"]');
    await shot('12-menu-actions');
    await click('.comp-header-dropdown-item:has-text("Analytics")');
    await win.waitForTimeout(1500);
    await shot('18-analytics');
    await win.keyboard.press('Escape');
    await win.waitForTimeout(500);

    await click('button:has-text("Outils")');
    await shot('13-menu-outils');
    await win.keyboard.press('Escape');
    await win.mouse.click(10, VIEWPORT.height - 10);

    await click('button:has-text("Paramètres")');
    await shot('14-parametres');
    await click('.settings-nav-item:has-text("Salles et pistes")');
    // Salle en édition : pistes et appareils déclarés (libellés génériques Cyrano / OPP2)
    await click('button:has-text("Modifier")');
    await win.locator('.venue-strips-editor').evaluate(el => (el.open = true));
    await shot('19-salles-pistes');
    await click('.venue-form button:has-text("Annuler")');

    // Appareils de la salle : déclaration en masse (ajout en lot préparé, non envoyé)
    await click('button:has-text("Appareils")');
    await win.waitForTimeout(1500);
    await win.locator('.strip-bulk').evaluate(el => (el.open = true));
    await win.locator('.strip-bulk input[type="number"]').nth(0).fill('7');
    await win.locator('.strip-bulk input[type="number"]').nth(1).fill('2');
    await win.locator('.strip-bulk select').nth(1).selectOption('saintgeorge');
    await win.locator('.strip-control-box').evaluate(el => el.scrollIntoView({ block: 'start' }));
    await shot('25-salle-appareils');
    await win.locator('.strip-bulk').evaluate(el => (el.open = false));

    // Pilotage : l'épreuve en cours garde la piste 3 (les autres passées en manuel pour elle)
    await win.evaluate(async () => {
      const [comp] = await window.electronAPI.db.getAllCompetitions();
      await window.electronAPI.api.invoke('updateCompetitionSettings', {
        competitionId: comp.id,
        settings: { manualStrips: [1, 2, 4, 5, 6] },
      });
    });
    // Piste 4 hors ligne : 40 s sans trame depuis l'arrêt de son appareil
    await win.waitForTimeout(5000);
    for (const n of [1, 2, 3, 4]) await click(`[aria-label="Sélectionner la piste ${n}"]`);
    await win.locator('.strip-control .strip-control-form select').first().selectOption('S');
    await win.fill('[aria-label="Nom à gauche"]', 'Martin Lucas');
    await win.fill('[aria-label="Nation ou club à gauche"]', 'FRA');
    await win.fill('[aria-label="Nom à droite"]', 'Bernard Emma');
    await win.fill('[aria-label="Nation ou club à droite"]', 'ITA');
    await click('button:has-text("Envoyer à la sélection")');
    await win.locator('.strip-control-table >> text=Reçu').nth(1).waitFor({ timeout: 15000 });
    await win.locator('.strip-control-table').evaluate(el => el.scrollIntoView({ block: 'start' }));
    await shot('26-pilotage-salle');
    await click('button:has-text("Fermer")');
    await click('.settings-nav-item:has-text("Système")');
    await win
      .locator('text=Agent IA (MCP)')
      .first()
      .evaluate(el => el.scrollIntoView({ block: 'start' }))
      .catch(() => {});
    await shot('20-parametres-systeme');
    await click('.settings-nav-item:has-text("Affichage")');
    await win.keyboard.press('Escape');

    await click('button:has-text("Entraînement")');
    await shot('15-entrainement');
    await click('.modal-footer .btn-secondary, button:has-text("Annuler")');

    await win.keyboard.press('Control+k');
    await shot('16-palette-commandes');
    await win.keyboard.press('Escape');

    // Liste en fin de parcours : compteurs de tireurs à jour
    await click('button:has-text("Général")');
    await shot('03-competitions');

    // Journées multi-épreuves : 2e épreuve, journée commune, arbitres partagés
    await win.evaluate(async fencers => {
      const db = window.electronAPI.db;
      // Journée : par le contrat d'API (docs/adr/0022)
      const call = async (name, input) => {
        const r = await window.electronAPI.api.invoke(name, input);
        if (!r.ok) throw new Error(`${name} : ${r.error.message}`);
        return r.data;
      };
      const [first] = await db.getAllCompetitions();
      const second = await db.createCompetition({
        title: 'Challenge de la Ville — Fleuret U17',
        date: new Date('2026-11-14'),
        location: 'Gymnase Jean Moulin',
        weapon: 'F',
        gender: 'X',
        category: 'U17',
        color: '#e8590c',
      });
      for (const [i, [lastName, firstName, club]] of fencers.slice(0, 10).entries()) {
        await db.addFencer(second.id, { lastName, firstName, club, ranking: i + 1, status: 'N' });
      }
      const day = await call('createEventDay', {
        name: 'Challenge de la Ville',
        date: '2026-11-14',
        stripCount: 12,
      });
      await call('assignCompetitionToDay', { competitionId: first.id, dayId: day.id });
      await call('assignCompetitionToDay', { competitionId: second.id, dayId: day.id });
      const refs = [
        ['FONTAINE', 'Claire', 'Paris Escrime', ['E', 'F']],
        ['GIRARD', 'Paul', 'CE Lyon', ['E']],
        ['MERCIER', 'Anne', 'Nantes Escrime', ['F']],
        ['BONNET', 'Marc', 'Toulouse EC', ['E', 'F']],
      ];
      for (const [lastName, firstName, club, weapons] of refs) {
        await call('registerEventDayReferee', {
          dayId: day.id,
          details: { lastName, firstName, club, weapons },
        });
      }
    }, FENCERS);
    await win.reload();
    await win.waitForTimeout(2500);
    await click('button:has-text("Journées")');
    await win.waitForTimeout(800);
    await click('[role="dialog"] >> text=Challenge de la Ville').catch(() => {});
    await win.waitForTimeout(1000);
    await shot('21-journee-multi-epreuves');
    await win.keyboard.press('Escape');
    await win.waitForTimeout(500);

    // Mode Club : club de démonstration, membres et séance
    await win.evaluate(async fencers => {
      const club = window.electronAPI.club;
      const c = await club.createClub({ name: 'Cercle d’escrime de la Ville', stripCount: 6 });
      for (const [lastName, firstName] of fencers.slice(0, 12)) {
        await club.createMember(c.id, { lastName, firstName, weapon: 'E' });
      }
      await club.createSession(c.id, {
        date: '2026-11-18',
        label: 'Entraînement épée adultes',
        startTime: '19:30',
        weapon: 'E',
        stripCount: 6,
      });
    }, FENCERS);
    await win.reload();
    await win.waitForTimeout(2500);
    await click('button:has-text("Club")');
    await win.waitForTimeout(1500);
    await click('text=Cercle d’escrime de la Ville');
    await win.waitForTimeout(1500);
    await win.keyboard.press('Escape');
    await shot('22-mode-club');
    await click('button:has-text("Séances")');
    await shot('23-club-seances');
    await click('button:has-text("Statistiques")');
    await shot('24-club-statistiques');
  } finally {
    for (const d of devices) {
      try {
        d.stop();
      } catch {
        // déjà arrêté (piste 4)
      }
    }
    await app.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
