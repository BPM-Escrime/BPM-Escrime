/**
 * Arène équipe des tablettes (`/equipe{N}/arbitre`) par les commandes du moteur
 * (docs/adr/0024, lot E4) — RemoteScoreServer réel, sockets simulées, base SQLite réelle :
 * relais FIE complet (9 relais) par `team_advance_bout` (recordRelayScore, source tablet),
 * refus du moteur rendu à la tablette (`team_arena_error`, code du catalogue) sans rien
 * écrire, égalité au tableau refusée, journal rejoué sans écart. Cartons (docs/adr/0028, lot
 * C3) : `team_card` → giveTeamCard, `team_fencer_card` → giveRelayCard, source tablet.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

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
vi.mock('fs', async importOriginal => ({
  ...(await importOriginal<typeof import('fs')>()),
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue(''),
  readdirSync: vi.fn().mockReturnValue([]),
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
const emitted: Array<[string, string | undefined]> = [];
vi.mock('../ipc/dbHandlers', async importOriginal => ({
  ...(await importOriginal<typeof import('../ipc/dbHandlers')>()),
  emitCompetitionEvent: (type: string, id?: string) => emitted.push([type, id]),
}));
vi.mock('http', () => ({
  createServer: vi
    .fn()
    .mockReturnValue({ listen: vi.fn(), close: vi.fn(), on: vi.fn(), once: vi.fn() }),
}));
vi.mock('better-sqlite3-multiple-ciphers', async () => ({
  default: (await import('../../database/testing/nodeSqliteDatabase')).NodeSqliteDatabase,
}));

import { RemoteScoreServer } from '../remoteScoreServer';
import { FencerStatus } from '../../shared/types';
import { hasNodeSqlite } from '../../database/testing/nodeSqliteDatabase';
import { invokeCommandSync } from '../engine/api/engine';
import { getPublicTeamArenaState } from './teamArena';
import { teamRelayFixture, type TeamRelayFixture } from '../__tests__/teamRelayFixture';

const d = hasNodeSqlite ? describe : describe.skip;
type Handler = (data: Record<string, unknown>) => void;

d('Arène équipe des tablettes par les commandes (docs/adr/0024, lot E4)', () => {
  let fx: TeamRelayFixture;
  let remote: RemoteScoreServer;
  const team = () => remote.teamArenaCtx.teamArenaState.get('1')!;
  const journal = (type: string) =>
    fx.db.eventLog.getSince(fx.competitionId).filter(e => e.type === type);

  afterEach(() => fx?.db.close());

  async function setup(
    arenaMatch?: (f: TeamRelayFixture) => string,
    options?: Parameters<typeof teamRelayFixture>[0]
  ) {
    fx = await teamRelayFixture(options);
    remote = new RemoteScoreServer(fx.db, 8066);
    expect(remote.setTeamArenaMatch('1', arenaMatch?.(fx) ?? fx.matchId, false)).toBe(true);
    const io = (remote as unknown as { io: { on: { mock: { calls: unknown[][] } } } }).io;
    const onConnection = io.on.mock.calls.find(c => c[0] === 'connection')?.[1] as (
      s: unknown
    ) => void;
    const handlers: Record<string, Handler> = {};
    const socket = {
      id: 'tablet-1',
      handshake: { headers: {}, address: '192.168.1.60' },
      on: vi.fn((ev: string, cb: Handler) => {
        handlers[ev] = cb;
      }),
      use: vi.fn(),
      emit: vi.fn(),
      join: vi.fn(),
      disconnect: vi.fn(),
    };
    onConnection(socket);
    /** Touches du relais en cours puis fin de relais à la tablette */
    const relay = (a: number, b: number) => {
      for (let i = 0; i < a; i++) handlers.team_touch({ arenaId: '1', side: 'A', points: 1 });
      for (let i = 0; i < b; i++) handlers.team_touch({ arenaId: '1', side: 'B', points: 1 });
      handlers.team_advance_bout({ arenaId: '1' });
    };
    const errors = () => socket.emit.mock.calls.filter(c => c[0] === 'team_arena_error');
    return { handlers, socket, relay, errors };
  }

  it('relais FIE complet : 9 relais par la tablette, rencontre terminée, rejeu sans écart', async () => {
    const { relay, errors } = await setup();
    for (let n = 1; n <= 9; n++) {
      relay(5, 3);
      expect(errors()).toEqual([]);
      expect(team()).toMatchObject({ liveScoreA: 0, liveScoreB: 0 });
    }
    const recorded = journal('RelayScoreRecorded');
    expect(recorded).toHaveLength(9);
    expect(recorded.every(e => e.source === 'tablet')).toBe(true);
    expect(fx.db.teams.getTeamMatch(fx.matchId)).toMatchObject({
      status: 'finished',
      winnerId: fx.teamAId,
    });
    expect(fx.db.getTeamMatchesByCompetition(fx.competitionId)[0]).toMatchObject({
      scoreBoutsA: 45,
      scoreBoutsB: 27,
    });
    expect(team().currentBoutIndex).toBe(-1);
    expect(journal('TeamMatchDecided')).toHaveLength(1);
    // L'écran relit l'état de l'épreuve sur signal du moteur
    expect(emitted).toContainEqual(['session:changed', fx.competitionId]);
    expect(fx.divergences()).toEqual([]);
  });

  it('relais au-delà du palier : refusé par le moteur, motif rendu à la tablette, rien d’écrit', async () => {
    const { handlers, relay, errors } = await setup();
    relay(7, 2); // relais 1 : palier 5, au-delà seulement d'autant que de rouges (t.41.1)
    expect(errors()).toEqual([
      [
        'team_arena_error',
        expect.objectContaining({ error: 'score_refused', code: 'score_above_max' }),
      ],
    ]);
    expect(journal('RelayScoreRecorded')).toHaveLength(0);
    expect(fx.db.teams.getTeamMatch(fx.matchId)!.bouts[0].status).toBe('not_started');
    // L'arène garde le relais et son score en direct : correction puis nouvelle fin
    expect(team()).toMatchObject({ currentBoutIndex: 0, liveScoreA: 7, liveScoreB: 2 });
    handlers.team_touch({ arenaId: '1', side: 'A', points: -1 });
    handlers.team_touch({ arenaId: '1', side: 'A', points: -1 });
    handlers.team_advance_bout({ arenaId: '1' });
    expect(errors()).toHaveLength(1);
    expect(fx.db.teams.getTeamMatch(fx.matchId)!.bouts[0]).toMatchObject({
      status: 'finished',
      scoreA: 5,
      scoreB: 2,
    });
    expect(team().currentBoutIndex).toBe(1);
  });

  it('égalité au tableau à la fin du dernier relais : draw_needs_winner, rencontre non décidée', async () => {
    const { relay, errors } = await setup(f => {
      f.play(Array.from({ length: 9 }, () => [5, 4] as [number, number]));
      const out = invokeCommandSync(f.ctx, 'generateTeamTableau', {
        competitionId: f.competitionId,
      });
      return out.matchIds[0];
    });
    for (let n = 1; n <= 8; n++) relay(5, 5);
    expect(errors()).toEqual([]);
    relay(5, 5);
    expect(errors()).toEqual([
      [
        'team_arena_error',
        expect.objectContaining({ error: 'score_refused', code: 'draw_needs_winner' }),
      ],
    ]);
    expect(team()).toMatchObject({ currentBoutIndex: 8, liveScoreA: 5, liveScoreB: 5 });
    expect(journal('TeamMatchDecided')).toHaveLength(1); // poule seulement
    expect(fx.divergences()).toEqual([]);
  });

  it('égalité au tableau au dernier relais : priorité choisie à la tablette (t.41.5), rencontre décidée', async () => {
    let tableauMatch = '';
    const { handlers, relay, errors } = await setup(f => {
      f.play(Array.from({ length: 9 }, () => [5, 4] as [number, number]));
      tableauMatch = invokeCommandSync(f.ctx, 'generateTeamTableau', {
        competitionId: f.competitionId,
      }).matchIds[0];
      return tableauMatch;
    });
    const publicState = () =>
      getPublicTeamArenaState(remote.teamArenaCtx, '1') as { tieNeedsWinner: boolean };
    for (let n = 1; n <= 7; n++) relay(5, 5);
    // Relais intermédiaire à égalité : aucun vainqueur demandé
    expect(publicState().tieNeedsWinner).toBe(false);
    relay(5, 5);
    // Dernier relais : vainqueur demandé tant que le cumul est à égalité
    expect(publicState().tieNeedsWinner).toBe(true);
    for (let i = 0; i < 5; i++) handlers.team_touch({ arenaId: '1', side: 'A', points: 1 });
    expect(publicState().tieNeedsWinner).toBe(false);
    for (let i = 0; i < 5; i++) handlers.team_touch({ arenaId: '1', side: 'B', points: 1 });
    expect(publicState().tieNeedsWinner).toBe(true);
    // Côté invalide ignoré : égalité refusée comme sans priorité
    handlers.team_advance_bout({ arenaId: '1', winner: 'X' });
    expect(errors()).toEqual([
      [
        'team_arena_error',
        expect.objectContaining({ error: 'score_refused', code: 'draw_needs_winner' }),
      ],
    ]);
    handlers.team_advance_bout({ arenaId: '1', winner: 'B' });
    expect(errors()).toHaveLength(1);
    const m = fx.db.teams.getTeamMatch(tableauMatch)!;
    expect(m).toMatchObject({ status: 'finished', winnerId: m.teamBId });
    expect(m.bouts[8]).toMatchObject({ status: 'finished', scoreA: 5, scoreB: 5 });
    const decided = journal('TeamMatchDecided');
    expect(decided).toHaveLength(2);
    expect(decided[1]).toMatchObject({ source: 'tablet' });
    expect(team().currentBoutIndex).toBe(-1);
    expect(fx.divergences()).toEqual([]);
  });

  // ── Cartons par les commandes (docs/adr/0028, lot C3) ─────────────────────

  it('carton de relais : escalade par giveRelayCard, palier dépassé d’un rouge, rejeu sans écart', async () => {
    const { handlers, relay, errors } = await setup();
    const [fencerA] = fx.relay(1);
    // Motif inconnu, motif du Sabre Laser au sabre (#2207) : refusés, rien d'écrit
    handlers.team_fencer_card({ arenaId: '1', side: 'A', reason: 'not_a_reason' });
    handlers.team_fencer_card({ arenaId: '1', side: 'A', reason: 'early_start' });
    expect(errors()).toHaveLength(2);
    expect(errors()[1]).toEqual([
      'team_arena_error',
      expect.objectContaining({ error: 'card_refused', code: 'invalid_input' }),
    ]);
    expect(journal('RelayCardGiven')).toHaveLength(0);
    // 1er groupe FIE (t.165) : jaune, puis rouge (cumul sur la rencontre)
    handlers.team_fencer_card({ arenaId: '1', side: 'A', reason: 'fie_body_contact' });
    handlers.team_fencer_card({ arenaId: '1', side: 'A', reason: 'fie_body_contact' });
    expect(errors()).toHaveLength(2);
    const given = journal('RelayCardGiven');
    const pay = (e: (typeof given)[number]) => e.payload as Record<string, unknown>;
    expect(given.map(e => [e.source, pay(e).type, pay(e).fencerId])).toEqual([
      ['tablet', 'YELLOW', fencerA],
      ['tablet', 'RED', fencerA],
    ]);
    // L'arène relit la rencontre : cartons copiés de la table
    expect(team().fencerCards.map(c => [c.type, c.boutId, c.reason])).toEqual([
      ['YELLOW', fx.boutId(1), 'fie_body_contact'],
      ['RED', fx.boutId(1), 'fie_body_contact'],
    ]);
    // t.41.1 : rouge à A → B peut finir le relais à palier + 1
    relay(2, 6);
    expect(errors()).toHaveLength(2);
    expect(fx.db.teams.getTeamMatch(fx.matchId)!.bouts[0]).toMatchObject({
      status: 'finished',
      scoreA: 2,
      scoreB: 6,
    });
    expect(fx.divergences()).toEqual([]);
  });

  it('carton noir de relais (escrime olympique) : tireur retiré, équipe exclue, rencontre décidée', async () => {
    const { handlers, errors } = await setup();
    handlers.team_touch({ arenaId: '1', side: 'A', points: 1 });
    // blackCardEnabled absent : le noir n'est pas refusé par le serveur (#2186)
    handlers.team_fencer_card({ arenaId: '1', side: 'A', reason: 'fie_refusal_to_fence' });
    expect(errors()).toEqual([]);
    const [fencerA] = fx.relay(1);
    const black = journal('RelayCardGiven');
    expect(black).toHaveLength(1);
    const commandId = black[0].commandId;
    for (const type of ['FencerWithdrawn', 'TeamMatchDecided', 'TeamWithdrawn']) {
      expect(journal(type).filter(e => e.commandId === commandId)).toHaveLength(1);
    }
    expect(fx.db.getFencer(fencerA)?.status).toBe(FencerStatus.EXCLUDED);
    expect(fx.db.teams.getTeamMatch(fx.matchId)).toMatchObject({
      status: 'finished',
      winnerId: fx.teamBId,
    });
    // La tablette affiche l'issue : rencontre terminée, équipe exclue
    expect(team().currentBoutIndex).toBe(-1);
    const pub = getPublicTeamArenaState(remote.teamArenaCtx, '1') as {
      matchComplete: boolean;
      withdrawnTeams: unknown[];
    };
    expect(pub.matchComplete).toBe(true);
    expect(pub.withdrawnTeams).toEqual([{ teamId: fx.teamAId, reason: 'exclusion' }]);
    // Plus de carton ni de relais pour l'équipe exclue
    handlers.team_fencer_card({ arenaId: '1', side: 'A', reason: 'fie_body_contact' });
    expect(errors()).toEqual([
      ['team_arena_error', expect.objectContaining({ error: 'card_refused' })],
    ]);
    expect(fx.divergences()).toEqual([]);
  });

  it('carton E (arène Sabre Laser) : giveTeamCard, équipe étrangère refusée (#2183), noir accepté (#2186)', async () => {
    // Arène Sabre Laser : calendrier figé pour 8 équipes
    const teams = 'ABCDEFGH'.split('').map(l => ({
      name: `Équipe ${l}`,
      fencers: [1, 2, 3].map(k => ({ lastName: `${l}${k}`, firstName: 'Tireur' })),
    }));
    const { handlers, errors } = await setup(undefined, {
      weapon: 'L' as never,
      settings: { teamFormat: 'laser-arena', blackCardEnabled: false },
      teams,
    });
    const stranger = fx.db
      .getTeamMatchesByCompetition(fx.competitionId)
      .flatMap(m => [m.teamAId, m.teamBId])
      .find(t => t !== fx.teamAId && t !== fx.teamBId)!;
    handlers.team_card({ arenaId: '1', teamId: fx.teamAId, type: 'white' });
    handlers.team_card({ arenaId: '1', teamId: stranger, type: 'yellow' });
    expect(errors()).toEqual([
      [
        'team_arena_error',
        expect.objectContaining({ error: 'card_refused', code: 'team_not_in_match' }),
      ],
    ]);
    handlers.team_card({ arenaId: '1', teamId: fx.teamBId, type: 'black' });
    expect(errors()).toHaveLength(1);
    const given = journal('TeamCardGiven');
    const pay = (e: (typeof given)[number]) => e.payload as Record<string, unknown>;
    expect(given.map(e => [e.source, pay(e).teamId, pay(e).type])).toEqual([
      ['tablet', fx.teamAId, 'white'],
      ['tablet', fx.teamBId, 'black'],
    ]);
    expect(team().cards.map(c => [c.teamId, c.type])).toEqual([
      [fx.teamAId, 'white'],
      [fx.teamBId, 'black'],
    ]);
    expect(fx.db.teams.getTeamMatchCards(fx.matchId)).toHaveLength(2);
    expect(fx.divergences()).toEqual([]);
  });
});
