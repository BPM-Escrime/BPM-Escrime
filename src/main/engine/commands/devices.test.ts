/**
 * Appareils de piste par le contrat (#2117, docs/adr/0023), base SQLite réelle : déclaration
 * sur la salle, salle d'une épreuve (la sienne → sa journée → par défaut), appareils effectifs
 * et pistes manuelles (`manualStrips` par updateCompetitionSettings), pilotes par le port
 * `ctx.devices` (rechargés après chaque déclaration), refus « unavailable » sans pilote.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '../../../database';
import { hasNodeSqlite } from '../../../database/testing/nodeSqliteDatabase';
import type { OperationName } from '../../../shared/api/contract';
import { ApiError } from '../../../shared/api/client';
import { Category, Gender, Weapon } from '../../../shared/types';
import { buildDefaultCompetitionSettings } from '../../../shared/utils/defaultCompetitionSettings';
import type { CommandContext, DevicesPort } from './context';
import { invoke } from '../api/engine';

vi.mock('better-sqlite3-multiple-ciphers', async () => ({
  default: (await import('../../../database/testing/nodeSqliteDatabase')).NodeSqliteDatabase,
}));

const d = hasNodeSqlite ? describe : describe.skip;

let db: DatabaseManager;
let ctx: CommandContext;
let port: DevicesPort & { reload: ReturnType<typeof vi.fn> };

function fakePort() {
  let cyrano = false;
  return {
    reload: vi.fn(),
    cyrano: {
      running: () => cyrano,
      start: vi.fn(async ({ port: p }: { port?: number }) => {
        if (p === 1) throw new Error('EADDRINUSE');
        cyrano = true;
        return p ?? 50100;
      }),
      stop: vi.fn(async () => {
        cyrano = false;
      }),
      status: () => ({ running: cyrano, port: 50100, pistes: [] }),
      log: () =>
        [1, 2, 3].map(ts => ({
          ts,
          dir: 'in' as const,
          ip: '10.0.0.1',
          port: 50100,
          piste: '1',
          raw: '',
        })),
    },
    opp2: {
      running: () => false,
      start: vi.fn(async () => 1883),
      stop: vi.fn(async () => {}),
      status: () => ({ running: false, port: 1883, clients: 0, unknownPistes: [], pistes: [] }),
    },
    routes: () => ({ '1': 'c1' }),
    setOptions: vi.fn(),
    action: vi.fn(() => true),
    control: {
      watchVenue: vi.fn(),
      activeArenas: vi.fn((): { competitionId: string; arenas: number[] }[] => []),
      link: vi.fn((): string | null => 'online'),
      send: vi.fn(() => true),
      last: vi.fn(() => null),
    },
  };
}

beforeEach(async () => {
  db = new DatabaseManager(':memory:');
  await db.open(':memory:');
  port = fakePort() as typeof port;
  ctx = { db, devices: port };
});
afterEach(() => db.close());

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

function competition(title: string) {
  return db.createCompetition({
    title,
    date: new Date('2026-12-06'),
    weapon: Weapon.EPEE,
    gender: Gender.MALE,
    category: Category.SENIOR,
    settings: buildDefaultCompetitionSettings({ weapon: Weapon.EPEE, category: Category.SENIOR }),
  });
}

const CYRANO = { protocol: 'cyrano', ip: '10.0.0.1', port: 50101, version: 'EFP1.1' };

d('appareils déclarés sur la salle', () => {
  it('setStripDevice : piste créée au besoin, appareil relu, retiré par null ; pilotes rechargés', async () => {
    const venue = await op('saveVenue', { name: 'Gymnase', stripCount: 2 });
    await op('setStripDevice', { venueId: venue.id, strip: 2, device: CYRANO });
    await op('setStripDevice', {
      venueId: venue.id,
      strip: 5,
      device: { protocol: 'opp2', opp2Id: 'rouge' },
    });
    expect(await op('listStripDevices', { venueId: venue.id })).toEqual([
      { strip: 1, device: null },
      { strip: 2, device: CYRANO },
      { strip: 5, device: { protocol: 'opp2', opp2Id: 'rouge' } },
    ]);
    expect(port.reload).toHaveBeenCalledTimes(3);
    await op('setStripDevice', { venueId: venue.id, strip: 2, device: null });
    expect((await op('listStripDevices', { venueId: venue.id }))[1]).toEqual({
      strip: 2,
      device: null,
    });
  });

  it('salle inconnue : venue_not_found ; Cyrano sans adresse refusé par le schéma', async () => {
    expect((await refusal(op('listStripDevices', { venueId: 'x' }))).code).toBe('venue_not_found');
    const venue = await op('saveVenue', { name: 'Gymnase', stripCount: 1 });
    expect(
      (
        await refusal(
          op('setStripDevice', { venueId: venue.id, strip: 1, device: { protocol: 'cyrano' } })
        )
      ).code
    ).toBe('invalid_input');
  });

  it('saveVenue garde les appareils des pistes envoyées sans deviceConfig', async () => {
    const venue = await op('saveVenue', { name: 'Gymnase', stripCount: 2 });
    await op('setStripDevice', { venueId: venue.id, strip: 1, device: CYRANO });
    // Agent (MCP) ou ancien écran : nombre de pistes seulement
    await op('saveVenue', { id: venue.id, name: 'Gymnase', stripCount: 3 });
    expect((await op('listStripDevices', { venueId: venue.id }))[0].device).toEqual(CYRANO);
    await op('saveVenue', {
      id: venue.id,
      name: 'Gymnase',
      strips: [{ number: 1, deviceConfig: null }],
    });
    expect((await op('listStripDevices', { venueId: venue.id }))[0].device).toBeNull();
  });
});

d('salle d’une épreuve et appareils effectifs', () => {
  it('salle propre → salle de la journée → salle par défaut', async () => {
    const main = await op('saveVenue', { name: 'Principale', stripCount: 2 });
    const hall = await op('saveVenue', { name: 'Halle', stripCount: 3 });
    const annex = await op('saveVenue', { name: 'Annexe', stripCount: 1 });
    await op('setStripDevice', { venueId: main.id, strip: 1, device: CYRANO });
    await op('setStripDevice', { venueId: hall.id, strip: 3, device: { protocol: 'opp2' } });
    const comp = competition('Épée');

    let res = await op('getCompetitionStripDevices', { competitionId: comp.id });
    expect(res).toMatchObject({ venueId: main.id, source: 'default', competitionVenueId: null });
    expect(res.devices.map((x: { strip: number }) => x.strip)).toEqual([1]);

    const day = db.eventDays.createDay({ name: 'Samedi', date: '2026-12-06', venueId: hall.id });
    db.eventDays.setCompetitionDay(comp.id, day.id);
    res = await op('getCompetitionStripDevices', { competitionId: comp.id });
    expect(res).toMatchObject({ venueId: hall.id, venueName: 'Halle', source: 'day' });
    expect(res.devices).toEqual([
      { strip: 3, device: { protocol: 'opp2' }, arena: 3, piste: '3', manual: false },
    ]);

    res = await op('setCompetitionVenue', { competitionId: comp.id, venueId: annex.id });
    expect(res).toMatchObject({
      venueId: annex.id,
      source: 'competition',
      competitionVenueId: annex.id,
      devices: [],
    });
    expect(port.reload).toHaveBeenLastCalledWith(comp.id);

    // Salle supprimée : l'épreuve retombe sur sa journée
    await op('deleteVenue', { venueId: annex.id });
    res = await op('getCompetitionStripDevices', { competitionId: comp.id });
    expect(res).toMatchObject({ source: 'day', competitionVenueId: null });

    await op('setCompetitionVenue', { competitionId: comp.id, venueId: null });
    expect(
      (await refusal(op('setCompetitionVenue', { competitionId: comp.id, venueId: 'x' }))).code
    ).toBe('venue_not_found');
    expect(
      (await refusal(op('getCompetitionStripDevices', { competitionId: 'inconnue' }))).code
    ).toBe('competition_not_found');
  });

  it('manualStrips par updateCompetitionSettings : pistes marquées pour cette épreuve seulement', async () => {
    const venue = await op('saveVenue', { name: 'Principale', stripCount: 2 });
    await op('setStripDevice', { venueId: venue.id, strip: 1, device: CYRANO });
    await op('setStripDevice', { venueId: venue.id, strip: 2, device: CYRANO });
    const a = competition('A');
    const b = competition('B');
    await op('updateCompetitionSettings', {
      competitionId: a.id,
      settings: { manualStrips: [2] },
    });
    const flags = async (id: string) =>
      (await op('getCompetitionStripDevices', { competitionId: id })).devices.map(
        (x: { manual: boolean }) => x.manual
      );
    expect(await flags(a.id)).toEqual([false, true]);
    expect(await flags(b.id)).toEqual([false, false]);
    expect((await op('getCompetitionStripDevices', { competitionId: a.id })).manualStrips).toEqual([
      2,
    ]);
    // Clé vérifiée par le schéma strict des réglages
    expect(
      (
        await refusal(
          op('updateCompetitionSettings', {
            competitionId: a.id,
            settings: { manualStrips: [0] },
          })
        )
      ).code
    ).toBe('invalid_input');
  });
});

d('pilotes Cyrano et OPP2', () => {
  it('démarrage : port renvoyé, appareils rechargés pour l’épreuve ; déjà démarré : même port', async () => {
    const comp = competition('Épée');
    expect(
      await op('startCyranoServer', { port: 50102, host: '', competitionId: comp.id })
    ).toEqual({ port: 50102 });
    expect(port.reload).toHaveBeenLastCalledWith(comp.id);
    expect(await op('startCyranoServer', {})).toEqual({ port: 50100 });
    expect(port.cyrano.start).toHaveBeenCalledTimes(1);
    await op('stopCyranoServer');
    expect(port.cyrano.stop).toHaveBeenCalled();
    expect(await op('startOpp2Broker', { competitionId: comp.id })).toEqual({ port: 1883 });
    await op('stopOpp2Broker');
    expect(port.opp2.stop).toHaveBeenCalled();
  });

  it('refus du pilote : device_refused (message pour l’opérateur)', async () => {
    const e = await refusal(op('startCyranoServer', { port: 1 }));
    expect(e.code).toBe('device_refused');
    expect(e.message).toBe('EADDRINUSE');
  });

  it('état, routes, options, secours', async () => {
    expect(await op('getCyranoStatus')).toMatchObject({ running: false, pistes: [] });
    expect(await op('getOpp2Status')).toMatchObject({ clients: 0 });
    expect(await op('listCyranoLog')).toHaveLength(3);
    expect(await op('listCyranoLog', { limit: 2 })).toMatchObject([{ ts: 2 }, { ts: 3 }]);
    expect(await op('listStripDeviceRoutes')).toEqual({ '1': 'c1' });
    await op('setStripDeviceOptions', { nameLength: 15, natSource: 'club' });
    expect(port.setOptions).toHaveBeenCalledWith({ nameLength: 15, natSource: 'club' });
    expect(await op('runStripDeviceAction', { piste: '1', action: 'resync' })).toEqual({
      done: true,
    });
    expect(port.action).toHaveBeenCalledWith('1', 'resync');
  });

  it('sans pilote (tests, MCP) : unavailable ; la déclaration reste possible', async () => {
    const bare = { db };
    expect((await refusal(op('getCyranoStatus', {}, bare))).code).toBe('unavailable');
    const venue = await op('saveVenue', { name: 'Gymnase', stripCount: 1 }, bare);
    await op('setStripDevice', { venueId: venue.id, strip: 1, device: CYRANO }, bare);
  });
});
