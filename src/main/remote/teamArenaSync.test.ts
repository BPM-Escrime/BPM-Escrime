/**
 * Arène équipe suivie sur le journal (#2267) — RemoteScoreServer réel, sockets simulées, base
 * SQLite réelle : une commande d'équipe passée par le contrat hors arène (écran, MCP : carton E,
 * carton de relais, carton P, relais enregistré) rediffuse l'état de l'arène qui affiche la
 * rencontre ; rencontre non affichée → rien ; commande venue de la tablette → une seule
 * diffusion (celle de l'arène elle-même).
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
vi.mock('../ipc/dbHandlers', async importOriginal => ({
  ...(await importOriginal<typeof import('../ipc/dbHandlers')>()),
  emitCompetitionEvent: () => {},
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
import { hasNodeSqlite } from '../../database/testing/nodeSqliteDatabase';
import { invokeCommandSync } from '../engine/api/engine';
import { watchTeamArenas } from './teamArenaSync';
import { teamRelayFixture, type TeamRelayFixture } from '../__tests__/teamRelayFixture';

const d = hasNodeSqlite ? describe : describe.skip;
type Handler = (data: Record<string, unknown>) => void;
type Emit = { mock: { calls: unknown[][] } };
type PublicState = {
  matchId: string;
  currentBoutIndex: number;
  liveScoreA: number;
  fencerCards: Array<{ reason: string | null }>;
  cards: Array<{ teamId: string; type: string }>;
  passivityCards: Array<{ type: string }>;
  matchComplete: boolean;
};

/** Huit équipes de l'arène Sabre Laser : plusieurs rencontres dans la poule */
const LASER_TEAMS = 'ABCDEFGH'.split('').map(l => ({
  name: `Équipe ${l}`,
  fencers: [1, 2, 3].map(k => ({ lastName: `${l}${k}`, firstName: 'Tireur' })),
}));

d('Arène équipe rafraîchie après une commande d’ailleurs (#2267)', () => {
  let fx: TeamRelayFixture;
  let remote: RemoteScoreServer;
  let off: (() => void) | undefined;

  afterEach(() => {
    off?.();
    off = undefined;
    fx?.db.close();
  });

  async function setup(options?: Parameters<typeof teamRelayFixture>[0]) {
    fx = await teamRelayFixture(options);
    remote = new RemoteScoreServer(fx.db, 8066);
    expect(remote.setTeamArenaMatch('1', fx.matchId, false)).toBe(true);
    const io = (remote as unknown as { io: { on: Emit; emit: Emit } }).io;
    const onConnection = io.on.mock.calls.find(c => c[0] === 'connection')?.[1] as (
      s: unknown
    ) => void;
    const handlers: Record<string, Handler> = {};
    onConnection({
      id: 'tablet-1',
      handshake: { headers: {}, address: '192.168.1.60' },
      on: vi.fn((ev: string, cb: Handler) => {
        handlers[ev] = cb;
      }),
      use: vi.fn(),
      emit: vi.fn(),
      join: vi.fn(),
      disconnect: vi.fn(),
    });
    off = watchTeamArenas(id => (id === fx.competitionId ? remote.teamArenaCtx : undefined));
    const seen = io.emit.mock.calls.length;
    /** États de l'arène diffusés depuis la mise en place */
    const states = () =>
      io.emit.mock.calls
        .slice(seen)
        .filter(c => c[0] === 'team_arena_state')
        .map(c => c[1] as PublicState);
    return { handlers, states };
  }

  /** Commande passée par le contrat comme l'écran (source screen), signal traité ensuite */
  async function screen(name: string, input: Record<string, unknown>) {
    invokeCommandSync(
      { ...fx.ctx, actor: { source: 'screen' } },
      name as never,
      {
        competitionId: fx.competitionId,
        matchId: fx.matchId,
        ...input,
      } as never
    );
    await Promise.resolve();
  }

  it('carton de relais donné à l’écran : arène relue et diffusée', async () => {
    const { states } = await setup();
    await screen('giveRelayCard', { relayId: fx.boutId(1), side: 'A', reason: 'fie_body_contact' });
    expect(states()).toHaveLength(1);
    expect(states()[0].fencerCards).toMatchObject([{ reason: 'fie_body_contact' }]);
  });

  it('relais enregistré à l’écran : relais suivant, score en direct remis à zéro', async () => {
    const { handlers, states } = await setup();
    handlers.team_touch({ arenaId: '1', side: 'A', points: 1 });
    const live = states().length;
    await screen('recordRelayScore', { relay: 1, scoreA: 5, scoreB: 2 });
    expect(states()).toHaveLength(live + 1);
    expect(states()[live]).toMatchObject({ currentBoutIndex: 1, liveScoreA: 0 });
  });

  it('carton P donné à l’écran, noir P compris : rencontre décidée sur l’arène', async () => {
    const { states } = await setup();
    fx.play([[5, 3]]);
    await Promise.resolve();
    const before = states().length;
    for (let k = 0; k < 3; k++) await screen('givePassivityCard', {});
    const after = states().slice(before);
    expect(after.map(s => s.passivityCards.length)).toEqual([1, 2, 3]);
    expect(after[2]).toMatchObject({ matchComplete: true });
  });

  it('carton E donné à l’écran (Sabre Laser) ; rencontre non affichée : rien de diffusé', async () => {
    const { states } = await setup({
      weapon: 'L' as never,
      settings: { teamFormat: 'laser-arena' },
      teams: LASER_TEAMS,
    });
    await screen('giveTeamCard', { teamId: fx.teamAId, type: 'white' });
    expect(states()).toHaveLength(1);
    expect(states()[0].cards).toMatchObject([{ teamId: fx.teamAId, type: 'white' }]);
    // Autre rencontre de la poule : l'arène avance sa révision sans rien diffuser
    const other = fx.db
      .getTeamMatchesByCompetition(fx.competitionId)
      .find(m => m.id !== fx.matchId)!;
    await screen('giveTeamCard', { matchId: other.id, teamId: other.teamAId, type: 'white' });
    expect(states()).toHaveLength(1);
    expect(remote.teamArenaCtx.teamArenaState.get('1')!.revision).toBe(
      fx.db.eventLog.getRevision(fx.competitionId)
    );
  });

  it('commande venue de la tablette : une seule diffusion, pas de doublon après le signal', async () => {
    const { handlers, states } = await setup();
    handlers.team_fencer_card({ arenaId: '1', side: 'A', reason: 'fie_body_contact' });
    expect(states()).toHaveLength(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(states()).toHaveLength(1);
  });
});
