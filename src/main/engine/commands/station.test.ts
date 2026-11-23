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

  it('43 opérations, chacune avec son gestionnaire', () => {
    expect(ops).toHaveLength(43);
    for (const name of ops) expect(typeof handlers[name], name).toBe('function');
  });
});
