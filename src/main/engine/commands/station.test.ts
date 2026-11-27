/**
 * Fonctions du poste par le contrat (#1981 lot 2, docs/adr/0022), base SQLite réelle : réglages
 * et salles, thèmes, journée multi-épreuves et arbitres, RGPD, agent MCP ; refus des dépôts
 * rendus en « station_refused », services du poste absents rendus en « unavailable ».
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseManager } from '../../../database';
import { hasNodeSqlite } from '../../../database/testing/nodeSqliteDatabase';
import { contract, type OperationName } from '../../../shared/api/contract';
import { fileOperations } from '../../../shared/api/contractFiles';
import { ApiError } from '../../../shared/api/client';
import { Category, FencerStatus, Gender, Weapon } from '../../../shared/types';
import type { McpStatus } from '../../../shared/types/mcp';
import type { CustomTheme } from '../../../shared/types/remote';
import { buildDefaultCompetitionSettings } from '../../../shared/utils/defaultCompetitionSettings';
import { createDayStripService } from '../../remote/dayStripService';
import { createThemesStore } from '../../themesStore';
import {
  readPrivacySettings,
  sanitizePrivacySettings,
  writePrivacySettings,
} from '../../privacySettings';
import {
  competitionBackupDir,
  readBackupSettings,
  resolveBackupDir,
  setCompetitionBackupDir,
  updateBackupSettings,
  writeBackupSettings,
} from '../../backupSettings';
import { createLogoLibraryStore, importLegacyLogoFile } from '../../logoLibraryStore';
import { readProxySettings, sanitizeProxySettings, writeProxySettings } from '../../proxySettings';
import type { CommandContext, StationPort } from './context';
import { handlers, invoke, subscribe } from '../api/engine';
import { publishCompetitionEvent } from '../api/events';

vi.mock('better-sqlite3-multiple-ciphers', async () => ({
  default: (await import('../../../database/testing/nodeSqliteDatabase')).NodeSqliteDatabase,
}));

const d = hasNodeSqlite ? describe : describe.skip;

let db: DatabaseManager;
let ctx: CommandContext;
let dir: string;
let busy: Set<string>;
const mcpStatus: McpStatus = {
  enabled: false,
  allowWrite: false,
  running: false,
  port: 8067,
  url: null,
  token: 'jeton',
};

function stationPort(): StationPort {
  return {
    defaultAgentFolders: () => ['/home/dt/Documents'],
    // Même branchement que stationPort.ts, fichier réel du profil de test
    backup: {
      info: () => resolveBackupDir(dir, path.join(dir, 'Documents')),
      set: backupDir => {
        updateBackupSettings(dir, current => ({ ...current, dir: backupDir }));
        return resolveBackupDir(dir, path.join(dir, 'Documents'));
      },
      reset: () => {
        updateBackupSettings(dir, ({ dir: _dir, ...rest }) => rest);
        return resolveBackupDir(dir, path.join(dir, 'Documents'));
      },
      competitionDir: id => competitionBackupDir(dir, id),
      setCompetitionDir: (id, compDir) => setCompetitionBackupDir(dir, id, compDir),
    },
    themes: createThemesStore(() => dir),
    privacy: {
      settings: () => readPrivacySettings(dir),
      update: input => {
        const settings = sanitizePrivacySettings(input, readPrivacySettings(dir));
        writePrivacySettings(dir, settings);
        return settings;
      },
      isCompetitionBusy: id => busy.has(id),
    },
    mcp: {
      status: async () => mcpStatus,
      update: async input => ({ ...mcpStatus, ...input }),
      regenerateToken: async () => ({ ...mcpStatus, token: 'nouveau' }),
      log: () => [{ at: '2026-12-06T09:00:00Z', method: 'tools/call', ok: true, ms: 3 }],
    },
    places: {
      search: async (query, language) => ({
        suggestions: [
          {
            name: `${query} (${language})`,
            address: '',
            city: 'Vitré',
            postcode: '35500',
            lat: 48.12,
            lon: -1.2,
            source: 'osm',
          },
        ],
        unavailable: false,
      }),
    },
    logos: createLogoLibraryStore(() => dir),
    // Proxy : fichier réel, sans session Electron (appliqué par proxySession.ts)
    proxy: {
      settings: () => readProxySettings(dir),
      update: async input => {
        const settings = sanitizeProxySettings(input);
        if (settings) writeProxySettings(dir, settings);
        return settings;
      },
      test: async () => ({ ok: true, resolved: 'PROXY proxy.club.fr:3128' }),
    },
    diagnostics: () => ({
      appVersion: '3.0.0',
      build: 2096,
      channel: 'dev',
      platform: 'linux',
      arch: 'x64',
      osRelease: '6.8.0',
      locale: 'fr',
      electronVersion: '45.0.0',
      chromeVersion: '140',
      nodeVersion: '24.0.0',
      uptimeSeconds: 12,
      memoryRssMb: 200,
      activeRemoteServers: 0,
      generatedAt: new Date('2026-11-24T10:00:00.000Z'),
    }),
    dayStrips: createDayStripService({ db, getServer: () => undefined }),
  };
}

beforeEach(async () => {
  db = new DatabaseManager(':memory:');
  await db.open(':memory:');
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'station-'));
  busy = new Set();
  ctx = { db, station: stationPort() };
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const op = (name: OperationName, input: Record<string, unknown> = {}, c = ctx) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invoke(c, name, input) as Promise<any>;

const refusal = async (promise: Promise<unknown>) => {
  const e = await promise.then(
    () => null,
    (err: unknown) => err
  );
  expect(e).toBeInstanceOf(ApiError);
  return e as ApiError;
};

function competition(title: string, weapon = Weapon.EPEE) {
  return db.createCompetition({
    title,
    date: new Date('2026-12-06'),
    weapon,
    gender: Gender.MALE,
    category: Category.SENIOR,
    settings: buildDefaultCompetitionSettings({ weapon, category: Category.SENIOR }),
  });
}

d('Poste : réglages', () => {
  it('lit les valeurs par défaut, modifie puis relit', async () => {
    expect(await op('getStationSettings')).toMatchObject({ language: 'fr', inkSaving: false });
    const updated = await op('updateStationSettings', { language: 'en', inkSaving: true });
    expect(updated).toMatchObject({ language: 'en', inkSaving: true });
    expect(await op('getStationSettings')).toMatchObject({ language: 'en', inkSaving: true });
  });

  it('mode expert de l’éditeur de formule : éteint par défaut, préférence du poste (ADR-0041)', async () => {
    expect((await op('getStationSettings')).formulaExpert).toBe(false);
    expect(await op('getResolvedSetting', { key: 'formulaExpert' })).toBe(false);
    expect(await op('updateStationSettings', { formulaExpert: true })).toMatchObject({
      formulaExpert: true,
    });
    expect(await op('getResolvedSetting', { key: 'formulaExpert' })).toBe(true);
    // Réglage d'épreuve `expertMode` (pistes, arbitres) : distinct
    expect((await refusal(op('updateStationSettings', { formulaExpert: 'oui' }))).code).toBe(
      'invalid_input'
    );
  });

  it('refuse une clé inconnue ou les dossiers de l’agent (schéma), une valeur invalide (dépôt)', async () => {
    expect((await refusal(op('updateStationSettings', { color: 'red' }))).code).toBe(
      'invalid_input'
    );
    expect((await refusal(op('updateStationSettings', { agentFolders: ['/tmp'] }))).code).toBe(
      'invalid_input'
    );
    const e = await refusal(op('updateStationSettings', { language: 'FRANCE' }));
    expect(e.code).toBe('station_refused');
    expect(e.message).toMatch(/language/);
    // Tout ou rien : rien n'a été écrit
    expect((await op('getStationSettings')).language).toBe('fr');
  });

  it('résout le nombre de pistes : journée, sinon salle par défaut', async () => {
    expect(await op('getResolvedSetting', { key: 'stripCount' })).toBe(0);
    await op('saveVenue', { name: 'Gymnase', stripCount: 6 });
    expect(await op('getResolvedSetting', { key: 'stripCount' })).toBe(6);
    const c = competition('M15');
    const day = await op('createEventDay', { name: 'Journée', date: '2026-12-06', stripCount: 3 });
    await op('assignCompetitionToDay', { competitionId: c.id, dayId: day.id });
    expect(await op('getResolvedSetting', { key: 'stripCount', competitionId: c.id })).toBe(3);
    expect(await op('getResolvedSetting', { key: 'language' })).toBe('fr');
    expect((await refusal(op('getResolvedSetting', { key: 'inconnue' }))).code).toBe(
      'invalid_input'
    );
  });

  it('reprise des réglages localStorage : « missing » ne remplace pas, « write » écrit', async () => {
    await op('updateStationSettings', { language: 'de' });
    const missing = await op('importLegacySettings', {
      values: { 'bellepoule-language': 'en', 'bellepoule-remote-https': 'false' },
      mode: 'missing',
    });
    expect(missing).toEqual(['remoteHttps']);
    expect(await op('getStationSettings')).toMatchObject({ language: 'de', remoteHttps: false });
    const written = await op('importLegacySettings', {
      values: { 'bellepoule-language': 'en', 'bellepoule-theme': null, autre: 'x' },
      mode: 'write',
    });
    expect(written).toEqual(['language']);
    expect((await op('getStationSettings')).language).toBe('en');
  });

  it('dossiers de l’agent : défauts du poste, retrait', async () => {
    expect(await op('listAgentFolders')).toEqual({
      folders: [],
      defaults: ['/home/dt/Documents'],
    });
    db.settings.updateSettings({ agentFolders: ['/media/usb', '/srv/exports'] });
    expect(await op('removeAgentFolder', { folder: '/media/usb' })).toEqual({
      folders: ['/srv/exports'],
      defaults: ['/home/dt/Documents'],
    });
    // Sans port (MCP, tests) : pas de dossiers par défaut, rien d'inventé
    expect(await op('listAgentFolders', {}, { db })).toEqual({
      folders: ['/srv/exports'],
      defaults: [],
    });
  });

  it('dossier de sauvegarde : lu, puis remis au défaut (#2134)', async () => {
    const custom = path.join(dir, 'Sauvegardes');
    writeBackupSettings(dir, { dir: custom });
    expect(await op('getBackupDir')).toEqual({ dir: custom, isDefault: false });
    const reset = (await op('resetBackupDir')) as { dir: string; isDefault: boolean };
    expect(reset.isDefault).toBe(true);
    expect(await op('getBackupDir')).toEqual(reset);
    // Sans port du poste : refus explicite, pas de chemin inventé
    await expect(op('getBackupDir', {}, { db })).rejects.toBeInstanceOf(ApiError);
  });

  it('setBackupDir (docs/adr/0030) : dossier existant enregistré ; absent ou relatif refusé', async () => {
    const chosen = fs.mkdirSync(path.join(dir, 'Choisi'), { recursive: true })!;
    expect(await op('setBackupDir', { path: chosen })).toEqual({ dir: chosen, isDefault: false });
    expect(readBackupSettings(dir).dir).toBe(chosen);
    for (const bad of [path.join(dir, 'absent'), 'relatif/dossier', path.join(dir, 'f.txt')]) {
      if (bad.endsWith('.txt')) fs.writeFileSync(bad, 'x');
      expect((await refusal(op('setBackupDir', { path: bad }))).code).toBe('dir_not_found');
    }
    expect(readBackupSettings(dir).dir).toBe(chosen);
    expect((await refusal(op('setBackupDir', { path: chosen }, { db }))).code).toBe('unavailable');
  });

  it('setBackupDir : dossier en lecture seule refusé', async () => {
    if (process.platform === 'win32' || process.getuid?.() === 0) return;
    const ro = fs.mkdirSync(path.join(dir, 'LectureSeule'), { recursive: true })!;
    fs.chmodSync(ro, 0o555);
    try {
      expect((await refusal(op('setBackupDir', { path: ro }))).code).toBe('station_refused');
    } finally {
      fs.chmodSync(ro, 0o755);
    }
  });

  it('dossier propre d’une épreuve : réglage du poste, lu, fixé, retiré (docs/adr/0030)', async () => {
    const c = competition('Open');
    const own = fs.mkdirSync(path.join(dir, 'Open'), { recursive: true })!;
    expect(await op('getCompetitionBackupDir', { competitionId: c.id })).toEqual({ dir: null });
    expect(await op('setCompetitionBackupDir', { competitionId: c.id, path: own })).toEqual({
      dir: own,
    });
    expect(await op('getCompetitionBackupDir', { competitionId: c.id })).toEqual({ dir: own });
    expect(readBackupSettings(dir).competitions).toEqual({ [c.id]: own });
    // Le dossier du poste et son retour au défaut ne touchent pas celui de l'épreuve
    await op('resetBackupDir');
    expect(competitionBackupDir(dir, c.id)).toBe(own);
    // Rien n'est écrit dans l'épreuve
    expect(JSON.stringify(db.getCompetition(c.id)?.settings)).not.toContain(own);
    expect(await op('resetCompetitionBackupDir', { competitionId: c.id })).toEqual({ dir: null });
    expect(await op('getCompetitionBackupDir', { competitionId: c.id })).toEqual({ dir: null });
  });

  it('dossier propre d’une épreuve : refus dir_not_found, competition_not_found', async () => {
    const c = competition('Open');
    expect(
      (await refusal(op('setCompetitionBackupDir', { competitionId: c.id, path: '/nulle/part' })))
        .code
    ).toBe('dir_not_found');
    expect(
      (await refusal(op('setCompetitionBackupDir', { competitionId: 'inconnue', path: dir }))).code
    ).toBe('competition_not_found');
    expect((await refusal(op('getCompetitionBackupDir', { competitionId: 'inconnue' }))).code).toBe(
      'competition_not_found'
    );
    expect(competitionBackupDir(dir, c.id)).toBeNull();
  });

  it('le champ settings.backupDir sort de updateCompetitionSettings (schéma)', async () => {
    const c = competition('Open');
    const e = await refusal(
      op('updateCompetitionSettings', { competitionId: c.id, settings: { backupDir: dir } })
    );
    expect(e.code).toBe('invalid_input');
  });

  it('addAgentFolder (docs/adr/0030) : dossier existant ajouté une fois ; absent refusé', async () => {
    const usb = fs.mkdirSync(path.join(dir, 'usb'), { recursive: true })!;
    const expected = { folders: [usb], defaults: ['/home/dt/Documents'] };
    expect(await op('addAgentFolder', { path: usb })).toEqual(expected);
    expect(await op('addAgentFolder', { path: usb })).toEqual(expected);
    expect((await refusal(op('addAgentFolder', { path: path.join(dir, 'absent') }))).code).toBe(
      'dir_not_found'
    );
    expect((await refusal(op('addAgentFolder', { path: 'relatif' }))).code).toBe('dir_not_found');
    expect(db.settings.getSetting('agentFolders')).toEqual([usb]);
  });

  it('onStationSettingsChanged : relaie les changements de paramètres, pas les autres', () => {
    const seen: unknown[] = [];
    const off = subscribe(ctx, 'onStationSettingsChanged', {}, e => seen.push(e));
    publishCompetitionEvent({ type: 'matches:changed', competitionId: 'c1' });
    publishCompetitionEvent({ type: 'settings:changed' });
    off();
    publishCompetitionEvent({ type: 'settings:changed' });
    expect(seen).toEqual([{}]);
  });
});

d('Poste : salles', () => {
  it('crée, renomme, désigne par défaut et supprime', async () => {
    const a = await op('saveVenue', { name: 'Salle A', stripCount: 4 });
    expect(a).toMatchObject({ name: 'Salle A', isDefault: true });
    expect(a.strips).toHaveLength(4);
    const b = await op('saveVenue', {
      name: 'Salle B',
      strips: [{ number: 1, label: 'Piste bleue' }, { number: 2 }],
    });
    expect(b.isDefault).toBe(false);
    await op('setDefaultVenue', { venueId: b.id });
    const venues = await op('listVenues');
    expect(venues.find((v: { id: string }) => v.id === b.id).isDefault).toBe(true);
    const renamed = await op('saveVenue', { id: b.id, name: 'Gymnase', stripCount: 3 });
    expect(renamed).toMatchObject({ name: 'Gymnase' });
    await op('deleteVenue', { venueId: a.id });
    expect(await op('listVenues')).toHaveLength(1);
  });

  it('refus du dépôt rendus en station_refused, message gardé', async () => {
    const noName = await refusal(op('saveVenue', { name: '   ' }));
    expect(noName).toMatchObject({ code: 'station_refused', message: 'Nom de salle obligatoire' });
    const unknown = await refusal(op('setDefaultVenue', { venueId: 'inconnue' }));
    expect(unknown).toMatchObject({ code: 'station_refused' });
    expect(unknown.message).toMatch(/introuvable/);
    expect((await refusal(op('saveVenue', { name: 'X', stripCount: 5000 }))).code).toBe(
      'invalid_input'
    );
  });
});

d('Poste : thèmes d’écrans', () => {
  const theme = (id: string, name = id): CustomTheme => ({
    id,
    name,
    targetType: 'arena',
    variables: { '--bg': '#000' },
  });

  it('enregistre, remplace par identifiant, supprime', async () => {
    expect(await op('listScreenThemes')).toEqual([]);
    await op('saveScreenTheme', { theme: theme('t1', 'Nuit') });
    await op('saveScreenTheme', { theme: theme('t2') });
    await op('saveScreenTheme', { theme: theme('t1', 'Nuit bleue') });
    const list = await op('listScreenThemes');
    expect(list.map((t: CustomTheme) => [t.id, t.name])).toEqual([
      ['t1', 'Nuit bleue'],
      ['t2', 't2'],
    ]);
    await op('deleteScreenTheme', { themeId: 't1' });
    expect((await op('listScreenThemes')).map((t: CustomTheme) => t.id)).toEqual(['t2']);
    // Fichier du poste, sous le dossier de données
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'themes.json'), 'utf8'))).toHaveLength(1);
  });

  it('deux sauvegardes concurrentes ne s’écrasent pas ; thème invalide refusé', async () => {
    await Promise.all(['a', 'b', 'c', 'd'].map(id => op('saveScreenTheme', { theme: theme(id) })));
    expect(await op('listScreenThemes')).toHaveLength(4);
    expect((await refusal(op('saveScreenTheme', { theme: { id: 'x' } }))).code).toBe(
      'invalid_input'
    );
  });

  it('sans port du poste : unavailable', async () => {
    expect((await refusal(op('listScreenThemes', {}, { db }))).code).toBe('unavailable');
  });
});

d('Poste : journée multi-épreuves', () => {
  it('crée, modifie, rattache des épreuves, supprime', async () => {
    await op('saveVenue', { name: 'Gymnase', stripCount: 8 });
    const day = await op('createEventDay', { name: 'Open', date: '2026-12-06' });
    // Sans pistes : celles de la salle par défaut
    expect(day).toMatchObject({ name: 'Open', stripCount: 8, competitionIds: [] });
    expect(await op('listEventDays')).toHaveLength(1);
    const updated = await op('updateEventDayDetails', {
      dayId: day.id,
      details: { name: 'Open 2026', stripCount: 10 },
    });
    expect(updated).toMatchObject({ name: 'Open 2026', stripCount: 10 });

    const c = competition('M15');
    const sync = await op('assignCompetitionToDay', { competitionId: c.id, dayId: day.id });
    expect(sync).toMatchObject({ added: 0, updated: 0, imported: 0 });
    expect((await op('listEventDays'))[0].competitionIds).toEqual([c.id]);
    expect(await op('assignCompetitionToDay', { competitionId: c.id, dayId: null })).toEqual({
      added: 0,
      updated: 0,
    });
    expect((await op('listEventDays'))[0].competitionIds).toEqual([]);

    await op('deleteEventDay', { dayId: day.id });
    expect(await op('listEventDays')).toEqual([]);
  });

  it('arbitres de la journée : inscription, armes, vue d’ensemble, report dans les épreuves', async () => {
    const day = await op('createEventDay', { name: 'Open', date: '2026-12-06', stripCount: 4 });
    const epee = competition('Épée', Weapon.EPEE);
    const foil = competition('Fleuret', Weapon.FOIL);
    await op('assignCompetitionToDay', { competitionId: epee.id, dayId: day.id });
    await op('assignCompetitionToDay', { competitionId: foil.id, dayId: day.id });

    const ref = await op('registerEventDayReferee', {
      dayId: day.id,
      details: { firstName: 'Ada', lastName: 'Lovelace', weapons: [Weapon.EPEE] },
    });
    expect(ref).toMatchObject({ lastName: 'Lovelace', weapons: ['E'] });
    await op('updateEventDayRefereeDetails', {
      refereeId: ref.id,
      details: { club: 'CE', weapons: [Weapon.EPEE, Weapon.FOIL] },
    });
    const listed = await op('listEventDayReferees', { dayId: day.id });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ club: 'CE', weapons: ['E', 'F'] });

    const sync = await op('syncEventDayReferees', { dayId: day.id });
    expect(sync.added).toBe(2);
    expect(db.getRefereesByCompetition(epee.id).map(r => r.lastName)).toContain('Lovelace');
    expect(db.getRefereesByCompetition(foil.id).map(r => r.lastName)).toContain('Lovelace');
    // Deuxième passe : rien de plus à reporter
    expect((await op('syncEventDayReferees', { dayId: day.id })).added).toBe(0);

    expect(await op('getEventDayOverview', { dayId: day.id })).toEqual({
      statuses: [{ dayRefereeId: ref.id, state: 'free', assignments: [] }],
      conflicts: [],
    });
    // Personne d'occupé : rien à signaler dans les autres épreuves
    expect(await op('listBusyElsewhere', { competitionId: epee.id })).toEqual({});
    expect(await op('listBusyElsewhere', { competitionId: 'hors-journee' })).toEqual({});

    await op('removeEventDayReferee', { refereeId: ref.id });
    expect(await op('listEventDayReferees', { dayId: day.id })).toEqual([]);
  });

  it('occupation des pistes : une entrée par piste de la salle, toutes libres au départ', async () => {
    const day = await op('createEventDay', { name: 'Open', date: '2026-12-06', stripCount: 4 });
    const a = competition('A');
    const b = competition('B');
    for (const c of [a, b]) {
      await op('assignCompetitionToDay', { competitionId: c.id, dayId: day.id });
      for (let i = 0; i < 4; i++) {
        db.addFencer(c.id, {
          lastName: `${c.title}${i}`,
          firstName: 'P',
          club: 'X',
          nationality: 'FRA',
          ranking: i + 1,
          status: FencerStatus.CHECKED_IN,
        });
      }
    }
    const occupation = await op('getDayStripOccupation', { dayId: day.id });
    expect(occupation).toHaveLength(4);
    expect(occupation.every((s: { free: boolean }) => s.free)).toBe(true);
  });

  it('pistes en temps réel : tableau sans serveur ouvert, réservation, affectation automatique', async () => {
    const day = await op('createEventDay', { name: 'Open', date: '2026-12-06', stripCount: 3 });
    const board = await op('getDayStripBoard', { dayId: day.id });
    expect(board).toMatchObject({ live: false, autoAssign: false });
    expect(board.strips).toHaveLength(3);
    expect(await op('getDayStripBoard', { dayId: 'inconnue' })).toBeNull();

    expect(
      await op('setDayStripRule', {
        dayId: day.id,
        strip: 2,
        rule: { pools: false, tableauMax: 8 },
      })
    ).toBe(true);
    expect((await op('getDayStripBoard', { dayId: day.id })).strips[1].rule).toEqual({
      competitions: null,
      pools: false,
      tableau: true,
      tableauMax: 8,
    });
    // Piste hors de la salle : refusée sans erreur
    expect(await op('setDayStripRule', { dayId: day.id, strip: 9, rule: null })).toBe(false);
    expect(await op('setDayStripRule', { dayId: day.id, strip: 2, rule: null })).toBe(true);
    expect(await op('assignDayStrip', { dayId: day.id, strip: 1, key: 'pool:inconnue' })).toBe(
      false
    );
    expect(await op('setDayAutoAssign', { dayId: day.id, on: true })).toBe(true);
    expect((await op('getDayStripBoard', { dayId: day.id })).autoAssign).toBe(true);
    expect(await op('setDayAutoAssign', { dayId: 'inconnue', on: true })).toBe(false);
  });
});

d('Poste : RGPD', () => {
  function seed() {
    const c = competition('Open');
    for (const [lastName, license] of [
      ['LEFEVRE', '777'],
      ['MARTIN', '888'],
    ]) {
      db.addFencer(c.id, {
        lastName,
        firstName: 'Zoé',
        club: 'CE',
        license,
        nationality: 'FRA',
        status: FencerStatus.CHECKED_IN,
      });
    }
    return c;
  }

  it('retrouve une personne par nom ou licence, exporte ses données', async () => {
    const c = seed();
    const found = await op('listPrivacyPersons', { query: 'lefevre' });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ lastName: 'LEFEVRE', license: '777' });
    expect(found[0].fencers[0].competitionId).toBe(c.id);
    expect(await op('listPrivacyPersons', { query: '888' })).toHaveLength(1);
    const data = await op('getPersonData', {
      fencerIds: found[0].fencers.map((f: { fencerId: string }) => f.fencerId),
    });
    expect(data).toMatchObject({
      format: 'bellepoule-modern/personal-data',
      subject: { lastName: 'LEFEVRE' },
    });
    expect(data.competitions).toHaveLength(1);
  });

  it('anonymise : la personne n’est plus retrouvée, l’autre reste', async () => {
    seed();
    const [person] = await op('listPrivacyPersons', { query: 'lefevre' });
    const ref = {
      fencerIds: person.fencers.map((f: { fencerId: string }) => f.fencerId),
      memberIds: [],
    };
    const r = await op('anonymizePerson', ref);
    expect(r).toMatchObject({ fencers: 1, members: 0 });
    expect(r.pseudonym).toBeTruthy();
    expect(await op('listPrivacyPersons', { query: 'lefevre' })).toEqual([]);
    expect(await op('listPrivacyPersons', { query: 'martin' })).toHaveLength(1);
  });

  it('efface ; une épreuve ouverte ou servie refuse l’anonymisation et l’effacement', async () => {
    const c = seed();
    const [person] = await op('listPrivacyPersons', { query: 'martin' });
    const ref = {
      fencerIds: person.fencers.map((f: { fencerId: string }) => f.fencerId),
    };
    busy.add(c.id);
    expect((await refusal(op('anonymizePerson', ref))).code).toBe('competition_open');
    expect((await refusal(op('erasePerson', ref))).code).toBe('competition_open');
    expect(await op('listPrivacyPersons', { query: 'martin' })).toHaveLength(1);
    busy.clear();
    expect(await op('erasePerson', ref)).toEqual({ fencers: 1, members: 0 });
    expect(await op('listPrivacyPersons', { query: 'martin' })).toEqual([]);
  });

  it('réglages : enregistrés dans le dossier du poste, assainis', async () => {
    expect(await op('getPrivacySettings')).toMatchObject({
      nameMasking: 'full',
      competitionRetentionMonths: 0,
    });
    const s = await op('updatePrivacySettings', {
      nameMasking: 'initials',
      competitionRetentionMonths: 24,
    });
    expect(s).toMatchObject({ nameMasking: 'initials', competitionRetentionMonths: 24 });
    expect(readPrivacySettings(dir)).toMatchObject({ nameMasking: 'initials' });
    expect(
      (await refusal(op('updatePrivacySettings', { competitionRetentionMonths: 9999 }))).code
    ).toBe('invalid_input');
  });

  it('conservation : candidats échus, application aux seuls identifiants listés', async () => {
    const old = db.createCompetition({
      title: 'Ancienne',
      date: new Date('2019-01-01'),
      weapon: Weapon.EPEE,
      gender: Gender.MALE,
      category: Category.SENIOR,
      settings: buildDefaultCompetitionSettings({ weapon: Weapon.EPEE, category: Category.SENIOR }),
    });
    db.addFencer(old.id, {
      lastName: 'ANCIEN',
      firstName: 'Léo',
      nationality: 'FRA',
      status: FencerStatus.CHECKED_IN,
    });
    expect((await op('listRetentionCandidates')).competitions).toEqual([]);
    await op('updatePrivacySettings', { competitionRetentionMonths: 12 });
    const candidates = await op('listRetentionCandidates');
    expect(candidates.competitions.map((x: { id: string }) => x.id)).toEqual([old.id]);
    // Rien de listé : rien de traité
    expect(await op('applyRetention', {})).toEqual({ competitions: 0, members: 0 });
    busy.add(old.id);
    expect(await op('applyRetention', { competitionIds: [old.id] })).toEqual({
      competitions: 0,
      members: 0,
    });
    busy.clear();
    expect(await op('applyRetention', { competitionIds: [old.id] })).toEqual({
      competitions: 1,
      members: 0,
    });
    expect(await op('listPrivacyPersons', { query: 'ancien' })).toEqual([]);
  });

  it('sans port du poste : réglages indisponibles, droits des personnes fonctionnent', async () => {
    seed();
    expect((await refusal(op('getPrivacySettings', {}, { db }))).code).toBe('unavailable');
    expect(await op('listPrivacyPersons', { query: 'lefevre' }, { db })).toHaveLength(1);
  });
});

d('Poste : agent MCP', () => {
  it('état, réglages, jeton, journal : par le port du serveur', async () => {
    expect(await op('getMcpStatus')).toMatchObject({ enabled: false, token: 'jeton' });
    expect(await op('updateMcpSettings', { enabled: true, port: 9000 })).toMatchObject({
      enabled: true,
      port: 9000,
    });
    expect((await op('regenerateMcpToken')).token).toBe('nouveau');
    expect(await op('listMcpLog')).toHaveLength(1);
    expect((await refusal(op('updateMcpSettings', { port: 70_000 }))).code).toBe('invalid_input');
    expect((await refusal(op('getMcpStatus', {}, { db }))).code).toBe('unavailable');
  });
});

describe('contrat du poste', () => {
  // Fichiers de données (contractFiles.ts) : dataFiles.test.ts
  const ops = (Object.keys(contract) as OperationName[]).filter(
    n => contract[n].permission === 'station:admin' && !(n in fileOperations)
  );

  it('64 opérations, chacune avec son gestionnaire', () => {
    expect(ops).toHaveLength(64);
    for (const name of ops) expect(typeof handlers[name], name).toBe('function');
  });
});

describe('listPlaceSuggestions (docs/adr/0026)', () => {
  it('texte nettoyé transmis au port, langue par défaut fr', async () => {
    const r = await op('listPlaceSuggestions', { query: '  salle   omnisports ' });
    expect(r.unavailable).toBe(false);
    expect(r.suggestions[0].name).toBe('salle omnisports (fr)');
  });

  it('texte trop court : refus du contrat ; poste sans service : indisponible', async () => {
    await refusal(op('listPlaceSuggestions', { query: 'ab' }));
    expect(await op('listPlaceSuggestions', { query: 'gymnase' }, { db })).toEqual({
      suggestions: [],
      unavailable: true,
    });
  });
});

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

d('Poste : logos (docs/adr/0022)', () => {
  it('bibliothèque : vide, puis enregistrée dans logos.json sans doublon d’id', async () => {
    expect(await op('getLogoLibrary')).toEqual([]);
    const saved = await op('updateLogoLibrary', {
      logos: [
        { id: 'a', name: 'Club', data: PNG },
        { id: 'a', name: 'Doublon', data: PNG },
        { id: 'b', name: 'Ligue', data: PNG },
      ],
    });
    expect(saved.map((l: { id: string }) => l.id)).toEqual(['a', 'b']);
    expect(await op('getLogoLibrary')).toEqual(saved);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'logos.json'), 'utf-8'))).toEqual(saved);
  });

  it('logo qui n’est pas une image, ou plus de 20 logos : invalid_input', async () => {
    const bad = { id: 'x', name: 'x', data: 'javascript:alert(1)' };
    expect((await refusal(op('updateLogoLibrary', { logos: [bad] }))).code).toBe('invalid_input');
    const many = Array.from({ length: 21 }, (_, i) => ({ id: `l${i}`, name: 'L', data: PNG }));
    expect((await refusal(op('updateLogoLibrary', { logos: many }))).code).toBe('invalid_input');
    expect((await refusal(op('getLogoLibrary', {}, { db }))).code).toBe('unavailable');
  });

  it('logo actif : ancien logo.dat repris en base une fois, puis supprimé', async () => {
    fs.writeFileSync(path.join(dir, 'logo.dat'), PNG, 'utf-8');
    importLegacyLogoFile(db, dir);
    expect((await op('getStationSettings')).logo).toBe(PNG);
    expect(fs.existsSync(path.join(dir, 'logo.dat'))).toBe(false);
    // Logo retiré depuis : un ancien fichier ne le ramène pas
    await op('updateStationSettings', { logo: null });
    fs.writeFileSync(path.join(dir, 'logo.dat'), PNG, 'utf-8');
    importLegacyLogoFile(db, dir);
    expect((await op('getStationSettings')).logo).toBeNull();
  });
});

d('Poste : proxy réseau', () => {
  it('système par défaut, manuel normalisé et enregistré, essai par le port', async () => {
    expect(await op('getProxySettings')).toEqual({ mode: 'system' });
    expect(
      await op('updateProxySettings', {
        mode: 'manual',
        server: 'proxy.club.fr:3128',
        bypass: '*.local; 192.168.0.0/16',
      })
    ).toEqual({
      mode: 'manual',
      server: 'http://proxy.club.fr:3128',
      bypass: '*.local,192.168.0.0/16',
    });
    expect((await op('getProxySettings')).server).toBe('http://proxy.club.fr:3128');
    expect(await op('testProxy')).toEqual({ ok: true, resolved: 'PROXY proxy.club.fr:3128' });
  });

  it('adresse invalide ou avec identifiants : station_refused, réglage inchangé', async () => {
    for (const server of ['nope', 'http://dt:secret@proxy.club.fr:3128']) {
      const e = await refusal(op('updateProxySettings', { mode: 'manual', server }));
      expect(e.code).toBe('station_refused');
    }
    expect(await op('getProxySettings')).toEqual({ mode: 'system' });
    expect((await refusal(op('updateProxySettings', { mode: 'pac' }))).code).toBe('invalid_input');
    expect((await refusal(op('testProxy', {}, { db }))).code).toBe('unavailable');
  });
});

d('Poste : rapport de diagnostic', () => {
  it('contenu JSON en base64, nom horodaté, liste blanche de champs', async () => {
    const file = await op('getDiagnosticReport');
    expect(file.fileName).toBe('bpm-escrime-diagnostic-20261124T100000.json');
    const report = JSON.parse(Buffer.from(file.content, 'base64').toString('utf-8'));
    expect(report.app).toEqual({ version: '3.0.0', build: 2096, channel: 'dev' });
    expect(Object.keys(report).sort()).toEqual([
      'app',
      'generatedAt',
      'runtime',
      'schemaVersion',
      'system',
    ]);
    expect((await refusal(op('getDiagnosticReport', {}, { db }))).code).toBe('unavailable');
  });
});
