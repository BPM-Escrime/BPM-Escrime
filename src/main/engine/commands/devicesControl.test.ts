/**
 * Pilotage de la salle hors compétition et déclaration en masse par le contrat (#2117,
 * docs/adr/0023), base SQLite réelle : grille (liaison, occupation, dernier envoi), envoi en
 * masse avec refus par piste (occupée sauf piste manuelle, hors ligne, non déclarée, pilote
 * arrêté), fusion de l'affichage, aucun journal ; ajout en lot, export puis import (rapport
 * ligne par ligne, essai à blanc, rien d'écrit sur erreur).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '../../../database';
import { hasNodeSqlite } from '../../../database/testing/nodeSqliteDatabase';
import type { OperationName } from '../../../shared/api/contract';
import { ApiError } from '../../../shared/api/client';
import { Category, Gender, Weapon } from '../../../shared/types';
import type {
  EffectiveStripDevice,
  StripDeviceAlert,
  StripDeviceLink,
  StripLastSend,
  StripPanel,
} from '../../../shared/types/stripDevice';
import { buildDefaultCompetitionSettings } from '../../../shared/utils/defaultCompetitionSettings';
import type { CommandContext, DevicesPort } from './context';
import { invoke } from '../api/engine';

vi.mock('better-sqlite3-multiple-ciphers', async () => ({
  default: (await import('../../../database/testing/nodeSqliteDatabase')).NodeSqliteDatabase,
}));

const d = hasNodeSqlite ? describe : describe.skip;

let db: DatabaseManager;
let ctx: CommandContext;
let links: Record<string, StripDeviceLink | null>;
let alerts: Record<string, StripDeviceAlert>;
let arenas: { competitionId: string; arenas: number[] }[];
let sent: { piste: string; panel: StripPanel }[];
let last: Map<string, StripLastSend & { venueId: string; strip: number }>;
let watch: ReturnType<typeof vi.fn>;

function fakePort(): DevicesPort {
  return {
    reload: vi.fn(),
    cyrano: {
      running: () => true,
      start: vi.fn(),
      stop: vi.fn(),
      status: () => ({ running: true, port: 50100, hello: 'device' as const, pistes: [] }),
      log: () => [],
    },
    opp2: {
      running: () => false,
      start: vi.fn(),
      stop: vi.fn(),
      status: () => ({ running: false, port: 1883, clients: 0, unknownPistes: [], pistes: [] }),
    },
    routes: () => ({}),
    setOptions: vi.fn(),
    action: vi.fn(() => true),
    control: {
      watchVenue: watch,
      activeArenas: () => arenas,
      link: (dev: EffectiveStripDevice) => links[dev.piste] ?? null,
      alert: (piste: string) => alerts[piste] ?? null,
      send: (target, panel) => {
        if (target.piste === 'perdue') return false;
        sent.push({ piste: target.piste, panel });
        last.set(target.piste, {
          at: 1,
          ack: 'pending',
          clear: false,
          panel,
          venueId: target.venueId,
          strip: target.strip,
        });
        return true;
      },
      last: (piste, match) => {
        const l = last.get(piste);
        if (!l || (match && (l.venueId !== match.venueId || l.strip !== match.strip))) return null;
        const { venueId: _v, strip: _s, ...view } = l;
        return view;
      },
    },
  } as DevicesPort;
}

beforeEach(async () => {
  db = new DatabaseManager(':memory:');
  await db.open(':memory:');
  links = {};
  alerts = {};
  arenas = [];
  sent = [];
  last = new Map();
  watch = vi.fn();
  ctx = { db, devices: fakePort() };
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

const cyrano = (n: number) => ({ protocol: 'cyrano', ip: `10.0.0.${n}`, port: 50101 });

/** Salle de 5 pistes : 1 à 3 Cyrano, 4 OPP2, 5 sans appareil */
async function hall() {
  const venue = db.settings.upsertVenue({ name: 'Halle Nord', stripCount: 5 });
  await op('setStripDevices', {
    venueId: venue.id,
    devices: [
      { strip: 1, device: cyrano(1), label: 'Podium' },
      { strip: 2, device: cyrano(2) },
      { strip: 3, device: cyrano(3) },
      { strip: 4, device: { protocol: 'opp2', opp2Id: 'bleue' } },
    ],
  });
  return venue;
}

d('pilotage de la salle hors compétition', () => {
  it('grille : protocole, liaison, BAD MATCH, piste occupée, dernier envoi ; salle chargée dans les pilotes', async () => {
    const venue = await hall();
    const comp = competition('Open Sabre');
    db.settings.setCompetitionVenue(comp.id, venue.id);
    arenas = [{ competitionId: comp.id, arenas: [2] }];
    links = { '1': 'online', '2': 'online', '3': 'offline' };
    alerts = {
      '2': { kind: 'bad_match', since: 1, arena: 'arena2', device: 'DUVAL J – MOREL L' },
    };
    const grid = await op('listVenueStripControl', { venueId: venue.id });
    expect(watch).toHaveBeenCalledWith(venue.id);
    expect(grid).toMatchObject({
      venueName: 'Halle Nord',
      cyranoRunning: true,
      opp2Running: false,
    });
    expect(grid.strips).toEqual([
      {
        strip: 1,
        label: 'Podium',
        protocol: 'cyrano',
        piste: '1',
        link: 'online',
        alert: null,
        busy: null,
        last: null,
      },
      {
        strip: 2,
        protocol: 'cyrano',
        piste: '2',
        link: 'online',
        alert: { kind: 'bad_match', since: 1, arena: 'arena2', device: 'DUVAL J – MOREL L' },
        busy: { competitionId: comp.id, title: 'Open Sabre' },
        last: null,
      },
      {
        strip: 3,
        protocol: 'cyrano',
        piste: '3',
        link: 'offline',
        alert: null,
        busy: null,
        last: null,
      },
      {
        strip: 4,
        protocol: 'opp2',
        piste: 'bleue',
        link: null,
        alert: null,
        busy: null,
        last: null,
      },
      { strip: 5, protocol: null, piste: null, link: null, alert: null, busy: null, last: null },
    ]);
    expect((await refusal(op('listVenueStripControl', { venueId: 'x' }))).code).toBe(
      'venue_not_found'
    );
  });

  it('envoi en masse : verdict par piste, piste manuelle de l’épreuve libre, aucun journal', async () => {
    const venue = await hall();
    const comp = competition('Open Sabre');
    db.settings.setCompetitionVenue(comp.id, venue.id);
    // Épreuve d'une autre salle sur l'arène 1 : ne bloque pas la piste 1 de cette salle
    const other = competition('Ailleurs');
    db.settings.setCompetitionVenue(
      other.id,
      db.settings.upsertVenue({ name: 'B', stripCount: 1 }).id
    );
    arenas = [
      { competitionId: comp.id, arenas: [1, 2] },
      { competitionId: other.id, arenas: [1] },
    ];
    db.updateCompetition(comp.id, { settings: { ...comp.settings, manualStrips: [1] } });
    links = { '1': 'online', '2': 'online', '3': 'offline' };
    const results = await op('sendStripDisplay', {
      venueId: venue.id,
      strips: [1, 2, 3, 4, 5, 9],
      weapon: 'S',
      left: { name: 'Dupont Léa', nat: 'FRA' },
      right: { name: 'Rossi Gia', nat: 'ITA' },
    });
    expect(results).toEqual([
      { strip: 1, outcome: 'sent' },
      { strip: 2, outcome: 'busy', competitionId: comp.id },
      { strip: 3, outcome: 'offline' },
      { strip: 4, outcome: 'unavailable' },
      { strip: 5, outcome: 'not_declared' },
      { strip: 9, outcome: 'not_declared' },
    ]);
    expect(sent).toEqual([
      {
        piste: '1',
        panel: {
          weapon: 'S',
          left: { name: 'Dupont Léa', nat: 'FRA' },
          right: { name: 'Rossi Gia', nat: 'ITA' },
        },
      },
    ]);
    // Ordre d'affichage : ni fait d'épreuve, ni journal
    expect(db.eventLog.getRevision(comp.id)).toBe(0);
  });

  it('« toutes » les pistes déclarées ; arme seule fusionnée ; remise à blanc ; rien à envoyer refusé', async () => {
    const venue = await hall();
    links = { '1': 'never', '2': 'stale', '3': 'online', bleue: 'online' };
    await op('sendStripDisplay', { venueId: venue.id, strips: [1], left: { name: 'A' } });
    const all = await op('sendStripDisplay', { venueId: venue.id, strips: 'all', weapon: 'F' });
    expect(all.map((r: { strip: number }) => r.strip)).toEqual([1, 2, 3, 4]);
    expect(sent.filter(s => s.piste === '1').map(s => s.panel)).toEqual([
      { left: { name: 'A' } },
      { weapon: 'F', left: { name: 'A' } },
    ]);
    await op('sendStripDisplay', { venueId: venue.id, strips: [1], clear: true });
    expect(sent[sent.length - 1]).toEqual({ piste: '1', panel: {} });
    expect((await refusal(op('sendStripDisplay', { venueId: venue.id, strips: [1] }))).code).toBe(
      'invalid_input'
    );
    expect(
      (await refusal(op('sendStripDisplay', { venueId: venue.id, strips: [1], weapon: 'L' }))).code
    ).toBe('invalid_input');
    // Sans pilote (MCP, tests) : indisponible
    expect(
      (
        await refusal(
          op('sendStripDisplay', { venueId: venue.id, strips: [1], weapon: 'E' }, { db })
        )
      ).code
    ).toBe('unavailable');
  });

  it('piste inconnue du pilote au moment de l’envoi : indisponible', async () => {
    const venue = db.settings.upsertVenue({ name: 'C', stripCount: 1 });
    await op('setStripDevices', {
      venueId: venue.id,
      devices: [{ strip: 1, device: { protocol: 'opp2', opp2Id: 'perdue' } }],
    });
    links = { perdue: 'online' };
    expect(await op('sendStripDisplay', { venueId: venue.id, strips: 'all', weapon: 'E' })).toEqual(
      [{ strip: 1, outcome: 'unavailable' }]
    );
  });
});

d('déclaration en masse, export et import', () => {
  it('setStripDevices : pistes citées seulement, libellé gardé si absent, pistes créées', async () => {
    const venue = await hall();
    const after = await op('setStripDevices', {
      venueId: venue.id,
      devices: [
        { strip: 2, device: null },
        { strip: 7, device: cyrano(7) },
      ],
    });
    const byNumber = Object.fromEntries(after.strips.map((s: { number: number }) => [s.number, s]));
    expect(byNumber[1]).toMatchObject({ label: 'Podium', deviceConfig: { ip: '10.0.0.1' } });
    expect(byNumber[2].deviceConfig ?? null).toBeNull();
    expect(byNumber[7].deviceConfig).toMatchObject({ protocol: 'cyrano', ip: '10.0.0.7' });
    expect(ctx.devices!.reload).toHaveBeenCalled();
    expect(
      (
        await refusal(
          op('setStripDevices', { venueId: 'x', devices: [{ strip: 1, device: null }] })
        )
      ).code
    ).toBe('venue_not_found');
  });

  it('export puis import dans une autre salle ; essai à blanc ; erreurs ligne par ligne', async () => {
    const venue = await hall();
    const file = await op('getStripDevicesFile', { venueId: venue.id });
    expect(file.fileName).toBe('appareils-halle-nord.json');
    const parsed = JSON.parse(file.content);
    expect(parsed).toMatchObject({ format: 'bellepoule-strip-devices', version: 1 });
    expect(parsed.strips).toHaveLength(4);

    const target = db.settings.upsertVenue({ name: 'Copie', stripCount: 1 });
    const dry = await op('importStripDevices', {
      venueId: target.id,
      content: file.content,
      dryRun: true,
    });
    expect(dry).toEqual({ applied: false, strips: 4, errors: [] });
    expect(db.settings.getVenue(target.id)!.strips).toHaveLength(1);
    const done = await op('importStripDevices', { venueId: target.id, content: file.content });
    expect(done).toEqual({ applied: true, strips: 4, errors: [] });
    expect(
      db.settings.getVenue(target.id)!.strips.find(s => s.number === 4)?.deviceConfig
    ).toMatchObject({ protocol: 'opp2', opp2Id: 'bleue' });

    const bad = JSON.stringify({
      format: 'bellepoule-strip-devices',
      strips: [
        { strip: 1, device: cyrano(1) },
        { strip: 2, device: { protocol: 'cyrano' } },
        { strip: 1, device: null },
        { strip: 500, device: null },
      ],
    });
    const report = await op('importStripDevices', { venueId: target.id, content: bad });
    expect(report.applied).toBe(false);
    expect(report.errors.map((e: { line: number }) => e.line)).toEqual([2, 3, 4]);
    expect(report.errors[1].message).toContain('piste 1');
    expect(
      (await refusal(op('importStripDevices', { venueId: target.id, content: '{' }))).code
    ).toBe('device_refused');
  });

  it('import de l’ancien export du panneau Cyrano', async () => {
    const venue = db.settings.upsertVenue({ name: 'D', stripCount: 1 });
    const legacy = JSON.stringify({
      format: 'bellepoule-cyrano-pistes',
      version: 1,
      pistes: [{ piste: '3', ip: '192.168.1.103', port: 50101, arena: 3, protocol: 'EFP1.1' }],
    });
    expect(await op('importStripDevices', { venueId: venue.id, content: legacy })).toEqual({
      applied: true,
      strips: 1,
      errors: [],
    });
    expect(db.settings.getVenue(venue.id)!.strips.find(s => s.number === 3)?.deviceConfig).toEqual({
      protocol: 'cyrano',
      ip: '192.168.1.103',
      port: 50101,
      version: 'EFP1.1',
    });
  });
});
