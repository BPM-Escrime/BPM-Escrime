/**
 * Port des appareils de piste (docs/adr/0023), base SQLite réelle : les pilotes chargent
 * eux-mêmes les appareils des salles des épreuves suivies (panneau, saisie distante), sinon de
 * la salle par défaut ; démarrage, arrêt et PisteHub branché tant qu'un pilote tourne.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '../database';
import { hasNodeSqlite } from '../database/testing/nodeSqliteDatabase';
import { Category, Gender, Weapon } from '../shared/types';
import { buildDefaultCompetitionSettings } from '../shared/utils/defaultCompetitionSettings';
import { createDevicesPort, manualStripsOf } from './devicesPort';
import type { CyranoServer } from './cyrano/server';
import type { MqttBroker } from './opp2/mqttBroker';
import type { Opp2PisteDriver } from './opp2/driver';
import type { PisteHub } from './piste/pisteHub';

vi.mock('better-sqlite3-multiple-ciphers', async () => ({
  default: (await import('../database/testing/nodeSqliteDatabase')).NodeSqliteDatabase,
}));

const d = hasNodeSqlite ? describe : describe.skip;

let db: DatabaseManager;
let active: string[];
const cyrano = {
  running: false,
  port: 50100,
  setPistes: vi.fn(),
  sendHelloAll: vi.fn(),
  setHost: vi.fn((h: string) => h !== 'x'),
  helloMode: 'device',
  setHelloMode: vi.fn((m: string) => {
    cyrano.helloMode = m;
  }),
  start: vi.fn(async (p?: number) => {
    cyrano.running = true;
    return p ?? 50100;
  }),
  stop: vi.fn(async () => {
    cyrano.running = false;
  }),
  getStatuses: vi.fn((): { piste: string; ip: string; status: string }[] => []),
  getLog: () => [],
};
const broker = {
  running: false,
  port: 1883,
  start: vi.fn(async (p: number) => {
    broker.running = true;
    return p;
  }),
  stop: vi.fn(async () => {
    broker.running = false;
  }),
  getClients: () => [],
};
const driver = {
  setPistes: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  getStatuses: () => [],
  getUnknownPistes: () => [],
  findPiste: vi.fn((): { status: string } | undefined => undefined),
};
const control = { send: vi.fn(() => true), lastFor: vi.fn(() => null) };
const hub = {
  setStripNumbers: vi.fn(),
  refreshManualStrips: vi.fn(),
  attach: vi.fn(),
  detach: vi.fn(),
  getAlerts: vi.fn((): Record<string, unknown> => ({})),
  getRoutes: () => ({}),
  setOptions: vi.fn(),
  clearDispCache: vi.fn(),
  pisteAction: vi.fn(() => true),
};

const port = () =>
  createDevicesPort({
    db,
    cyranoServer: cyrano as unknown as CyranoServer,
    broker: broker as unknown as MqttBroker,
    opp2Driver: driver as unknown as Opp2PisteDriver,
    pisteHub: hub as unknown as PisteHub,
    activeCompetitions: () => active,
    stripControl: control as never,
    activeArenas: () => [{ competitionId: 'c1', arenas: [1] }],
  });

const competition = (title: string) =>
  db.createCompetition({
    title,
    date: new Date('2026-12-06'),
    weapon: Weapon.EPEE,
    gender: Gender.MALE,
    category: Category.SENIOR,
    settings: buildDefaultCompetitionSettings({ weapon: Weapon.EPEE, category: Category.SENIOR }),
  });

beforeEach(async () => {
  vi.clearAllMocks();
  cyrano.running = false;
  broker.running = false;
  active = [];
  db = new DatabaseManager(':memory:');
  await db.open(':memory:');
});
afterEach(() => db.close());

d('createDevicesPort', () => {
  it('sans épreuve suivie : appareils de la salle par défaut, tables par protocole', () => {
    const venue = db.settings.upsertVenue({ name: 'Principale', stripCount: 2 });
    db.settings.setStripDevice(venue.id, 1, { protocol: 'cyrano', ip: '10.0.0.1', mode: 'master' });
    db.settings.setStripDevice(venue.id, 2, { protocol: 'opp2', opp2Id: 'rouge' });
    port().reload();
    expect(cyrano.setPistes).toHaveBeenCalledWith([
      { piste: '1', ip: '10.0.0.1', arena: 1, mode: 'master' },
    ]);
    expect(driver.setPistes).toHaveBeenCalledWith([{ piste: 'rouge', arena: 2 }]);
    expect(hub.setStripNumbers).toHaveBeenCalledWith({ '1': 1, rouge: 2 });
    expect(hub.refreshManualStrips).toHaveBeenCalled();
    expect(cyrano.sendHelloAll).not.toHaveBeenCalled();
  });

  it('épreuves suivies : salles de l’épreuve du panneau puis des épreuves en saisie distante', () => {
    const main = db.settings.upsertVenue({ name: 'Principale', stripCount: 1 });
    const hall = db.settings.upsertVenue({ name: 'Halle', stripCount: 2 });
    db.settings.setStripDevice(main.id, 1, { protocol: 'cyrano', ip: '10.0.0.1' });
    db.settings.setStripDevice(hall.id, 1, { protocol: 'cyrano', ip: '10.9.9.1' });
    db.settings.setStripDevice(hall.id, 2, { protocol: 'cyrano', ip: '10.9.9.2' });
    const a = competition('A');
    const b = competition('B');
    db.settings.setCompetitionVenue(b.id, hall.id);
    active = [a.id];
    const devices = port();
    devices.reload(b.id);
    // Piste 1 déclarée dans les deux salles : celle de l'épreuve du panneau l'emporte
    expect(cyrano.setPistes).toHaveBeenLastCalledWith([
      { piste: '1', ip: '10.9.9.1', arena: 1 },
      { piste: '2', ip: '10.9.9.2', arena: 2 },
    ]);
    // L'épreuve du panneau reste suivie aux rechargements suivants
    devices.reload();
    expect(cyrano.setPistes).toHaveBeenLastCalledWith([
      { piste: '1', ip: '10.9.9.1', arena: 1 },
      { piste: '2', ip: '10.9.9.2', arena: 2 },
    ]);
  });

  it('démarrage et arrêt : PisteHub branché tant qu’un pilote tourne ; interface invalide refusée', async () => {
    const devices = port();
    await expect(devices.cyrano.start({ host: 'x' })).rejects.toMatchObject({
      code: 'device_refused',
    });
    expect(await devices.cyrano.start({ port: 50105, host: '', hello: 'never' })).toBe(50105);
    // Envoi des HELLO choisi au démarrage (ADR-0038), relu dans l'état du pilote
    expect(cyrano.setHelloMode).toHaveBeenLastCalledWith('never');
    expect(devices.cyrano.status().hello).toBe('never');
    expect(await devices.opp2.start({})).toBe(1883);
    expect(driver.start).toHaveBeenCalled();
    expect(hub.attach).toHaveBeenCalledTimes(2);
    await devices.cyrano.stop();
    expect(hub.detach).not.toHaveBeenCalled();
    await devices.opp2.stop();
    expect(hub.detach).toHaveBeenCalledTimes(1);
    devices.reload();
    expect(cyrano.sendHelloAll).not.toHaveBeenCalled();
  });

  it('manualStripsOf : réglage de l’épreuve normalisé', () => {
    const comp = competition('A');
    db.updateCompetition(comp.id, {
      settings: { ...comp.settings, manualStrips: [3, 1, 3] },
    });
    expect(manualStripsOf(db, comp.id)).toEqual([1, 3]);
    expect(manualStripsOf(db, 'inconnue')).toEqual([]);
  });

  it('pilotage de la salle : salle pilotée chargée après les épreuves, liaison par protocole', async () => {
    const main = db.settings.upsertVenue({ name: 'Principale', stripCount: 1 });
    const hall = db.settings.upsertVenue({ name: 'Halle', stripCount: 2 });
    db.settings.setStripDevice(main.id, 1, { protocol: 'cyrano', ip: '10.0.0.1' });
    db.settings.setStripDevice(hall.id, 1, { protocol: 'cyrano', ip: '10.9.9.1' });
    db.settings.setStripDevice(hall.id, 2, { protocol: 'opp2', opp2Id: 'b' });
    const devices = port();
    devices.control.watchVenue(hall.id);
    // Salle par défaut d'abord (piste 1 en commun : la sienne l'emporte), puis la salle pilotée
    expect(cyrano.setPistes).toHaveBeenLastCalledWith([{ piste: '1', ip: '10.0.0.1', arena: 1 }]);
    expect(driver.setPistes).toHaveBeenLastCalledWith([{ piste: 'b', arena: 2 }]);
    // Même salle : pas de rechargement
    const calls = cyrano.setPistes.mock.calls.length;
    devices.control.watchVenue(hall.id);
    expect(cyrano.setPistes.mock.calls.length).toBe(calls);

    const cyr = {
      strip: 1,
      device: { protocol: 'cyrano' as const, ip: '10.9.9.1' },
      arena: 1,
      piste: '1',
      manual: false,
    };
    const opp = {
      strip: 2,
      device: { protocol: 'opp2' as const },
      arena: 2,
      piste: 'b',
      manual: false,
    };
    // Pilotes arrêtés : liaison inconnue
    expect(devices.control.link(cyr)).toBeNull();
    expect(devices.control.link(opp)).toBeNull();
    cyrano.running = true;
    broker.running = true;
    // Piste 1 chargée avec l'adresse d'une autre salle : non chargée pour celle-ci
    cyrano.getStatuses.mockReturnValue([{ piste: '1', ip: '10.0.0.1', status: 'online' }]);
    expect(devices.control.link(cyr)).toBeNull();
    cyrano.getStatuses.mockReturnValue([{ piste: '1', ip: '10.9.9.1', status: 'stale' }]);
    expect(devices.control.link(cyr)).toBe('stale');
    driver.findPiste.mockReturnValue({ status: 'online' });
    expect(devices.control.link(opp)).toBe('online');
    // Alerte BAD MATCH de la piste (grille de la salle)
    const bad = { kind: 'bad_match', since: 1, arena: 'arena1', device: 'X – Y' };
    hub.getAlerts.mockReturnValue({ '1': bad });
    expect(devices.control.alert('1')).toEqual(bad);
    expect(devices.control.alert('b')).toBeNull();
    hub.getAlerts.mockReturnValue({});
    expect(devices.control.activeArenas()).toEqual([{ competitionId: 'c1', arenas: [1] }]);
    const target = { venueId: hall.id, strip: 1, piste: '1', protocol: 'cyrano' as const };
    expect(devices.control.send(target, { weapon: 'S' })).toBe(true);
    expect(control.send).toHaveBeenCalledWith(target, { weapon: 'S' });
    devices.control.last('1', { venueId: hall.id, strip: 1 });
    expect(control.lastFor).toHaveBeenCalledWith('1', { venueId: hall.id, strip: 1 });
    cyrano.running = false;
    broker.running = false;
  });
});
