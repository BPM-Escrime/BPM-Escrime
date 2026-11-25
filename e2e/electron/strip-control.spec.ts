import { test, expect } from './app';
// Appareil de piste simulé (même code que npm run cyrano:sim / cyrano:remote)
const { CyranoDevice } = require('../../scripts/lib/cyranoDevice');

/**
 * Pilotage de la salle hors compétition sur l'application réelle (#2117, docs/adr/0023) :
 * deux appareils Cyrano simulés (UDP) déclarés sur les pistes 1 et 2 d'une salle, aucune
 * compétition ouverte. Depuis Paramètres → Salles et pistes → Appareils : démarrage du pilote,
 * sélection des deux pistes, envoi en une fois de l'arme et des noms ; chaque appareil affiche
 * l'envoi et l'accusé « Reçu » apparaît par piste. Puis remise à blanc.
 */
test('pilotage de la salle : arme et noms envoyés à 2 pistes, accusé visible', async ({
  win,
}, testInfo) => {
  test.setTimeout(90_000);
  const base = 19000 + (testInfo.workerIndex % 50) * 20;
  const cyranoPort = base + 1;
  const devicePort = base + 2;

  await win.evaluate(
    async ({ cyranoPort, devicePort }) => {
      localStorage.setItem('bellepoule-cyrano-port', String(cyranoPort));
      const api = window.electronAPI.api;
      const venue = await api.invoke('saveVenue', { name: 'Salle Pilotage', stripCount: 3 });
      if (!venue.ok) throw new Error(JSON.stringify(venue));
      const declared = await api.invoke('setStripDevices', {
        venueId: (venue.data as { id: string }).id,
        devices: [1, 2].map(n => ({
          strip: n,
          device: {
            protocol: 'cyrano',
            ip: `127.0.0.${20 + n}`,
            port: devicePort,
            version: 'EFP1.1',
          },
        })),
      });
      if (!declared.ok) throw new Error(JSON.stringify(declared));
    },
    { cyranoPort, devicePort }
  );

  const devices = [1, 2].map(
    n =>
      new CyranoDevice({
        piste: String(n),
        port: devicePort,
        bind: `127.0.0.${20 + n}`,
        serverPort: cyranoPort,
      })
  );
  await Promise.all(devices.map(d => d.start()));
  const table = win.locator('.strip-control-table');
  const cell = (text: string) => table.getByText(text, { exact: true });
  try {
    await win.getByRole('button', { name: 'Paramètres' }).first().click();
    await win.locator('.settings-nav-item', { hasText: 'Salles et pistes' }).first().click();
    await win
      .getByRole('button', { name: /Pilotage des appareils de la salle Salle Pilotage/ })
      .click();
    // Pilotes de la salle (StripDriversPanel) : le premier « Démarrer » est celui de Cyrano
    await win.locator('.strip-drivers').getByRole('button', { name: 'Démarrer' }).first().click();
    // HELLO du pilote → INFO des appareils : liaison en ligne
    await expect(cell('En ligne')).toHaveCount(2, { timeout: 20_000 });

    await win.getByLabel('Sélectionner la piste 1').check();
    await win.getByLabel('Sélectionner la piste 2').check();
    await win.locator('.strip-control .strip-control-form select').first().selectOption('S');
    await win.getByLabel('Nom à gauche').fill('Dupont Léa');
    await win.getByLabel('Nation ou club à gauche').fill('FRA');
    await win.getByLabel('Nom à droite').fill('Rossi Gia');
    await win.getByLabel('Nation ou club à droite').fill('ITA');
    await win.getByRole('button', { name: 'Envoyer à la sélection (2)' }).click();

    await expect(cell('Envoyé')).toHaveCount(2);
    await expect(cell('Reçu')).toHaveCount(2, { timeout: 15_000 });
    for (const d of devices) {
      expect(d.s.general.weapon).toBe('S');
      expect(d.s.left).toMatchObject({ name: 'DUPONT LEA', nat: 'FRA' });
      expect(d.s.right).toMatchObject({ name: 'ROSSI GIA', nat: 'ITA' });
    }

    // Remise à blanc des deux pistes (toutes les pistes déclarées)
    await win.getByRole('button', { name: 'Remettre à blanc' }).click();
    await expect.poll(() => devices.map(d => d.s.left.name).join('|')).toBe('|');
    await expect(cell('Remise à blanc')).toHaveCount(2);
    await expect(cell('Reçu')).toHaveCount(2, { timeout: 15_000 });
  } finally {
    devices.forEach(d => d.stop());
  }
});
