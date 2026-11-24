/**
 * Fin de match distante sans chemin historique (#2151, étape 3), base SQLite réelle : tablette
 * (fin d'arène, feuille de poule) et appareil de piste Cyrano écrivent par recordScore ; une
 * commande refusée (match absent de la session, règle du score) n'écrit rien, la tablette reçoit
 * 409, l'appareil NAK. Le journal rejoué ne diverge pas de l'état.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('better-sqlite3-multiple-ciphers', async () => ({
  default: (await import('../../database/testing/nodeSqliteDatabase')).NodeSqliteDatabase,
}));
vi.mock('electron', () => ({
  app: { getAppPath: () => '/opt/app', getPath: () => '/tmp', isPackaged: false },
  BrowserWindow: class {},
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn(), showMessageBox: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn() },
  net: { request: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false },
  screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({}) },
  session: { defaultSession: {} },
  shell: { openExternal: vi.fn() },
}));
vi.mock('socket.io', () => ({
  Server: vi.fn().mockImplementation(function () {
    return {
      on: vi.fn(),
      of: vi.fn(() => ({ use: vi.fn(), on: vi.fn(), disconnectSockets: vi.fn() })),
      emit: vi.fn(),
      to: vi.fn().mockReturnThis(),
    };
  }),
}));
vi.mock('../ipc/dbHandlers', async importOriginal => ({
  ...(await importOriginal<typeof import('../ipc/dbHandlers')>()),
  emitCompetitionEvent: vi.fn(),
}));
vi.mock('http', () => ({
  createServer: vi
    .fn()
    .mockReturnValue({ listen: vi.fn(), close: vi.fn(), on: vi.fn(), once: vi.fn() }),
}));

import { DatabaseManager } from '../../database';
import { hasNodeSqlite } from '../../database/testing/nodeSqliteDatabase';
import { Category, FencerStatus, Gender, Weapon } from '../../shared/types';
import { buildDefaultCompetitionSettings } from '../../shared/utils/defaultCompetitionSettings';
import { projectCompetition } from '../../shared/domain/journal/projectCompetition';
import { compareWithState, stateView } from '../../shared/domain/journal/compareWithState';
import { generatePools, listMatches } from '../engine/commands/sport';
import { RemoteScoreServer } from '../remoteScoreServer';
import { CyranoServer } from '../cyrano/server';
import { CyranoPisteDriver } from '../cyrano/driver';
import { buildCyrano, type CyranoMessage } from '../cyrano/codec';
import { PisteHub } from '../piste/pisteHub';
import { makeReq, makeRes } from '../__tests__/remoteServerTestkit';

const d = hasNodeSqlite ? describe : describe.skip;
const DEVICE_IP = '10.0.0.1';

let db: DatabaseManager;
let remote: RemoteScoreServer;
let competitionId: string;

function handler(method: string, path: string) {
  const app = (remote as unknown as { app: { router?: any; _router?: any } }).app;
  const stack = (app.router ?? app._router)?.stack ?? [];
  const layer = stack.find((l: any) => l?.route?.path === path && l.route.methods?.[method]);
  return layer?.route?.stack?.[0]?.handle;
}

/** Matchs de la poule tels que l'écran les envoie au démarrage de la saisie distante */
function rendererMatches() {
  return listMatches({ db }, competitionId).map((m, i) => ({
    id: m.matchId,
    poolId: (m as { poolId?: string }).poolId ?? 'pool-1',
    number: i + 1,
    fencerA: db.getFencer(m.fencerA!.id),
    fencerB: db.getFencer(m.fencerB!.id),
    status: 'not_started',
  }));
}

function divergences() {
  const statuses = Object.fromEntries(
    db.getFencersByCompetition(competitionId).map(f => [f.id, f.status as string])
  );
  return compareWithState(
    projectCompetition(db.eventLog.getSince(competitionId)),
    stateView((db.getSessionState(competitionId) ?? {}) as Record<string, unknown>),
    statuses
  );
}

const revision = () => db.eventLog.getRevision(competitionId);

beforeEach(async () => {
  db = new DatabaseManager(':memory:');
  await db.open(':memory:');
  const comp = db.createCompetition({
    title: 'Test',
    date: new Date('2026-12-06'),
    weapon: Weapon.EPEE,
    gender: Gender.MALE,
    category: Category.SENIOR,
    settings: buildDefaultCompetitionSettings({ weapon: Weapon.EPEE, category: Category.SENIOR }),
  });
  competitionId = comp.id;
  for (let i = 0; i < 4; i++) {
    db.addFencer(comp.id, {
      lastName: `NOM${i}`,
      firstName: `P${i}`,
      club: `C${i}`,
      ranking: i + 1,
      status: FencerStatus.CHECKED_IN,
    });
  }
  generatePools({ db }, comp.id, { poolCount: 1 });
  remote = new RemoteScoreServer(db, 8066);
  vi.spyOn(remote as any, 'hasAnyValidToken').mockReturnValue(true);
  vi.spyOn(remote as any, 'loadSessionReferees').mockReturnValue([]);
});
afterEach(() => db.close());

d('fin de match distante par le moteur, sans repli (#2151)', () => {
  it('tablette, fin d’arène : score écrit par recordScore, journal sans écart', async () => {
    await remote.startSession(competitionId, 1, rendererMatches() as never);
    const current = remote.getArena('arena1')!.currentMatch!;
    const before = revision();
    const res = makeRes();
    await handler('post', '/api/matches/:matchId/finish')(
      makeReq({ method: 'POST', params: { matchId: current.id }, body: { scoreA: 5, scoreB: 3 } }),
      res,
      vi.fn()
    );
    expect(res.status).not.toHaveBeenCalledWith(409);
    expect(db.eventLog.getSince(competitionId, before).map(e => e.type)).toEqual(['ScoreRecorded']);
    expect(listMatches({ db }, competitionId).find(m => m.matchId === current.id)?.state).toBe(
      'done'
    );
    expect(divergences()).toEqual([]);
  });

  it('feuille de poule, match absent de la session : 409 match_not_found, rien d’écrit', async () => {
    await remote.startSession(competitionId, 1, rendererMatches() as never);
    const before = revision();
    const res = makeRes();
    await handler('post', '/api/pools/:poolId/matches/:matchId/score')(
      makeReq({
        method: 'POST',
        params: { poolId: 'pool-1', matchId: 'inconnu' },
        body: { scoreA: 5, scoreB: 2 },
      }),
      res,
      vi.fn()
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      error: 'score_refused',
      code: 'match_not_found',
    });
    expect(revision()).toBe(before);
    expect(db.getMatch('inconnu')).toBeFalsy();
  });

  it('tablette, fin d’arène refusée par une règle : 409, match non terminé, rien d’écrit', async () => {
    await remote.startSession(competitionId, 1, rendererMatches() as never);
    const current = remote.getArena('arena1')!.currentMatch!;
    const before = revision();
    const res = makeRes();
    await handler('post', '/api/matches/:matchId/finish')(
      makeReq({ method: 'POST', params: { matchId: current.id }, body: { scoreA: 9, scoreB: 3 } }),
      res,
      vi.fn()
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0]).toMatchObject({ code: 'score_above_max' });
    expect(revision()).toBe(before);
    expect(remote.getArena('arena1')!.status).not.toBe('finished');
  });

  describe('appareil de piste Cyrano (maître)', () => {
    let acks: number;
    let naks: number;
    let cyrano: CyranoServer;

    const frame = (state: CyranoMessage['state'], a: string, b: string, sA: number, sB: number) =>
      buildCyrano({
        protocol: 'EFP1.1',
        command: 'INFO',
        piste: '1',
        compe: '',
        stopwatch: '3:00',
        priority: 'N',
        state,
        right: { id: a.slice(0, 8), name: 'X', nat: 'FRA', score: sA, status: 'U' },
        left: { id: b.slice(0, 8), name: 'X', nat: 'FRA', score: sB, status: 'U' },
      });

    async function start(matches: unknown[]) {
      cyrano = new CyranoServer({ now: () => 1_000_000 });
      cyrano.setPistes([{ piste: '1', ip: DEVICE_IP, port: 50101, arena: 1, mode: 'master' }]);
      const hub = new PisteHub(new CyranoPisteDriver(cyrano), () => remote);
      hub.attach();
      acks = 0;
      naks = 0;
      vi.spyOn(cyrano, 'sendDisp').mockReturnValue(true);
      vi.spyOn(cyrano, 'sendAck').mockImplementation(() => (++acks, true));
      vi.spyOn(cyrano, 'sendNak').mockImplementation(() => (++naks, true));
      remote.cyranoHook = (arenaId, u) => hub.onArenaUpdate(arenaId, u);
      await remote.startSession(competitionId, 1, matches as never);
      return remote.getArena('arena1')!.currentMatch!;
    }
    const device = (f: string) => cyrano.handle(f, DEVICE_IP, 50101);

    it('END valide : ACK, score écrit par le moteur (source cyrano), journal sans écart', async () => {
      const m = await start(rendererMatches());
      const before = revision();
      device(frame('H', m.fencerA!.id, m.fencerB!.id, 5, 2));
      device(frame('E', m.fencerA!.id, m.fencerB!.id, 5, 2));
      expect(acks).toBe(1);
      expect(naks).toBe(0);
      const events = db.eventLog.getSince(competitionId, before);
      expect(events.map(e => e.type)).toEqual(['ScoreRecorded']);
      expect(events[0].source).toBe('cyrano');
      expect(divergences()).toEqual([]);
    });

    it('END d’un match absent de la session : NAK, rien d’écrit, match non terminé', async () => {
      const [first, ...rest] = rendererMatches();
      const m = await start([{ ...first, id: 'hors-session' }, ...rest]);
      expect(m.id).toBe('hors-session');
      const before = revision();
      device(frame('H', m.fencerA!.id, m.fencerB!.id, 5, 2));
      device(frame('E', m.fencerA!.id, m.fencerB!.id, 5, 2));
      expect(naks).toBe(1);
      expect(acks).toBe(0);
      expect(remote.getArena('arena1')!.status).not.toBe('finished');
      expect(revision()).toBe(before);
      expect(db.getMatch('hors-session')).toBeFalsy();
    });
  });
});
