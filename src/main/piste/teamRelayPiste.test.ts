/**
 * Relais FIE par équipes sur appareil Cyrano (#1829) — RemoteScoreServer réel, arène équipe
 * `/equipe1` (relais FIE en direct, #1086), trames Cyrano `Type=T` injectées. Base SQLite
 * réelle : rencontre tirée par le moteur (ordre FIE des relais), fins de relais, rappel et
 * remplaçant écrits par les commandes du contrat (docs/adr/0024, lot E4) ; cartons de
 * l'appareil enregistrés par giveRelayCard avant le contrôle de la fin (docs/adr/0028, lot C3).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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
  emitCompetitionEvent: vi.fn(),
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
import { CyranoServer } from '../cyrano/server';
import { CyranoPisteDriver } from '../cyrano/driver';
import { buildCyrano, parseCyrano, type CyranoFencer, type CyranoMessage } from '../cyrano/codec';
import { PisteHub } from './pisteHub';
import { logger } from '../../shared/services/logger';
import { hasNodeSqlite } from '../../database/testing/nodeSqliteDatabase';
import { Weapon } from '../../shared/types';
import { teamRelayFixture, type TeamRelayFixture } from '../__tests__/teamRelayFixture';

const short = (id: string) => id.slice(0, 8);
const DEVICE_IP = '10.0.0.7';
const d = hasNodeSqlite ? describe : describe.skip;

interface Side {
  id: string;
  score: number;
  y?: number;
  red?: number;
  reserve?: boolean;
  status?: CyranoFencer['status'];
}

function info(
  state: CyranoMessage['state'],
  relay: number,
  right: Side,
  left: Side,
  extra: Partial<CyranoMessage> = {}
): string {
  const zone = (f: Side): CyranoFencer => ({
    id: short(f.id),
    name: 'X',
    nat: 'FRA',
    score: f.score,
    status: f.status ?? 'U',
    yellowCards: f.y ?? 0,
    redCards: f.red ?? 0,
    reserve: f.reserve ?? false,
  });
  return buildCyrano({
    protocol: 'EFP1.1',
    command: 'INFO',
    piste: '1',
    compe: '',
    round: String(relay),
    stopwatch: '2:00',
    type: 'T',
    priority: 'N',
    state,
    right: zone(right),
    left: zone(left),
    ...extra,
  });
}

d('PisteHub — relais FIE par équipes (Type=T)', () => {
  let fx: TeamRelayFixture;
  let remote: RemoteScoreServer;
  let cyrano: CyranoServer;
  let hub: PisteHub;
  /** Trames émises vers l'appareil, dans l'ordre (DISP relus, ACK, NAK) */
  let out: (CyranoMessage | 'ACK' | 'NAK')[];
  let notices: [string, unknown][];
  const opened: TeamRelayFixture[] = [];

  const team = () => remote.teamArenaCtx.teamArenaState.get('1')!;
  const device = (frame: string) => cyrano.handle(frame, DEVICE_IP, 50100);
  const disps = () => out.filter((m): m is CyranoMessage => typeof m === 'object');
  const lastDisp = () => disps()[disps().length - 1];
  const count = (k: 'ACK' | 'NAK') => out.filter(m => m === k).length;
  /** Tireurs du relais n : [équipe A, équipe B] */
  const r = (n: number) => fx.relay(n);
  /** Relais n en base (moteur) */
  const bout = (n: number) => fx.db.teams.getTeamMatch(fx.matchId)!.bouts[n - 1];
  const journal = (type: string) =>
    fx.db.eventLog.getSince(fx.competitionId).filter(e => e.type === type);

  /** Rencontre tirée par le moteur, relais déjà joués, assignée à l'arène équipe 1 */
  const start = async (
    played: [number, number][] = [],
    weapon: Weapon = Weapon.SABRE,
    settings: Record<string, unknown> = {}
  ) => {
    fx = await teamRelayFixture({ weapon, settings });
    opened.push(fx);
    fx.play(played);
    remote = new RemoteScoreServer(fx.db, 8066);
    remote.cyranoTeamHook = id => hub.onTeamArenaUpdate(id, remote);
    out = [];
    expect(remote.setTeamArenaMatch('1', fx.matchId, false)).toBe(true);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    cyrano = new CyranoServer();
    cyrano.setPistes([{ piste: '1', ip: DEVICE_IP, arena: 1 }]);
    notices = [];
    hub = new PisteHub(new CyranoPisteDriver(cyrano), () => remote, {
      onNotice: (piste, notice) => notices.push([piste, notice]),
    });
    hub.attach();
    out = [];
    vi.spyOn(cyrano, 'sendDisp').mockImplementation((_p, d) => {
      out.push(
        parseCyrano(
          buildCyrano({ ...d, protocol: 'EFP1.1', command: 'DISP', piste: '1', compe: '' })
        )!
      );
      return true;
    });
    vi.spyOn(cyrano, 'sendAck').mockImplementation(() => (out.push('ACK'), true));
    vi.spyOn(cyrano, 'sendNak').mockImplementation(() => (out.push('NAK'), true));
  });

  afterEach(() => {
    for (const f of opened.splice(0)) f.db.close();
  });

  it('rencontre assignée : DISP Type=T du relais 1, tireurs du relais, nation = équipe', async () => {
    await start();
    expect(lastDisp()).toMatchObject({
      command: 'DISP',
      type: 'T',
      round: '1',
      weapon: 'S',
      // Ordre FIE (o.99.3) : relais 1 = 3e tireur de chaque équipe
      right: { id: short(r(1)[0]), name: 'THOMAS E', nat: 'PAR', score: 0 },
      left: { id: short(r(1)[1]), name: 'ROMANO G', nat: 'ROM', score: 0 },
    });
    // Phase, poule et n° de la rencontre : obligatoires dans un DISP (spéc. § 3)
    expect(lastDisp()).toMatchObject({ phase: '1', poulTab: '1', match: '1' });
  });

  it('rencontre de tableau : phase du tableau, A<tour>, position + 1', async () => {
    await start();
    const at = new Date().toISOString();
    fx.db.teams.insertTeamTableauMatch({
      id: 'tab-1',
      competitionId: fx.competitionId,
      round: 8,
      position: 2,
      teamAId: fx.teamAId,
      teamBId: fx.teamBId,
      createdAt: at,
    });
    fx.db.teams.insertTeamBout({
      id: 'tab-1-r1',
      matchId: 'tab-1',
      order: 1,
      fencerAId: fx.A[0],
      fencerBId: fx.B[0],
      maxScore: 45,
      createdAt: at,
    });
    out = [];
    remote.setTeamArenaMatch('1', 'tab-1', false);
    expect(lastDisp()).toMatchObject({ type: 'T', phase: '2', poulTab: 'A8', match: '3' });
  });

  it('compétition internationale : nation = pays du tireur', async () => {
    hub.setOptions({ international: true });
    await start();
    expect(lastDisp()).toMatchObject({ right: { nat: 'FRA' }, left: { nat: 'ITA' } });
  });

  it('état reçu : score cumulé → score du relais, cartons reportés au relais, chrono, sans écho', async () => {
    await start();
    const n = disps().length;
    device(info('F', 1, { id: r(1)[0], score: 3, y: 1 }, { id: r(1)[1], score: 1 }));
    expect(team()).toMatchObject({ liveScoreA: 3, liveScoreB: 1, elapsedAccumulatedSec: 60 });
    expect(team().timerStartedAt).not.toBeNull();
    expect(team().deviceCards?.[fx.boutId(1)]).toEqual({ cardsA: ['yellow'], cardsB: [] });
    expect(disps()).toHaveLength(n);
    // Touches en cours : état de l'arène, score pas encore écrit en base
    expect(bout(1)).toMatchObject({ status: 'not_started', scoreA: 0, scoreB: 0 });
    // Nouveau jaune montré : enregistré par giveRelayCard (type, sans motif), une seule fois
    device(info('F', 1, { id: r(1)[0], score: 3, y: 1 }, { id: r(1)[1], score: 1 }));
    expect(journal('RelayCardGiven')).toEqual([
      expect.objectContaining({
        source: 'cyrano',
        payload: expect.objectContaining({
          relayId: fx.boutId(1),
          fencerId: r(1)[0],
          type: 'YELLOW',
          reason: null,
        }),
      }),
    ]);
    expect(team().fencerCards).toEqual([
      expect.objectContaining({ fencerId: r(1)[0], type: 'YELLOW', reason: null }),
    ]);
  });

  describe('cartons de l’appareil par giveRelayCard (docs/adr/0028, lot C3)', () => {
    it('END au palier + 1 sans rouge : NAK ; rouge montré → enregistré avant le contrôle, ACK (t.41.1)', async () => {
      await start([[5, 2]]); // relais 2 : palier 10
      device(info('H', 2, { id: r(2)[0], score: 10 }, { id: r(2)[1], score: 4 }));
      out = [];
      device(info('E', 2, { id: r(2)[0], score: 11 }, { id: r(2)[1], score: 4 }));
      expect(out).toContain('NAK');
      expect(count('ACK')).toBe(0);
      expect(bout(2).status).toBe('not_started');
      // Rouge au tireur de l'équipe B montré avec la fin : touche de pénalisation pour A
      out = [];
      device(info('E', 2, { id: r(2)[0], score: 11 }, { id: r(2)[1], score: 4, red: 1 }));
      expect(out[0]).toBe('ACK');
      const [card] = journal('RelayCardGiven');
      const [score] = journal('RelayScoreRecorded').slice(-1);
      expect(card).toMatchObject({
        source: 'cyrano',
        payload: { relayId: fx.boutId(2), fencerId: r(2)[1], type: 'RED', reason: null },
      });
      // Carton enregistré avant le relais : il compte dans le palier du moteur
      expect(card.revision).toBeLessThan(score.revision);
      expect(bout(2)).toMatchObject({ status: 'finished', scoreA: 6, scoreB: 2 });
      expect(fx.divergences()).toEqual([]);
    });

    it('rouge de l’autre côté : pas de dépassement pour l’équipe sanctionnée (NAK)', async () => {
      await start([[5, 2]]);
      out = [];
      device(info('E', 2, { id: r(2)[0], score: 11, red: 1 }, { id: r(2)[1], score: 4 }));
      expect(out).toContain('NAK');
      expect(journal('RelayCardGiven')).toHaveLength(1);
      expect(bout(2).status).toBe('not_started');
    });

    it('carton refusé par le moteur : tracé une fois, fin du relais décidée normalement (ACK)', async () => {
      const warn = vi.spyOn(logger, 'warn');
      await start();
      vi.spyOn(fx.db.teams, 'createTeamBoutCard').mockImplementation(() => {
        throw new Error('disque plein');
      });
      device(info('H', 1, { id: r(1)[0], score: 3, y: 1 }, { id: r(1)[1], score: 1 }));
      device(info('H', 1, { id: r(1)[0], score: 4, y: 1 }, { id: r(1)[1], score: 1 }));
      const refused = warn.mock.calls.filter(c => String(c[1]).includes('YELLOW'));
      expect(refused).toHaveLength(1);
      expect(team().liveScoreA).toBe(4);
      out = [];
      device(info('E', 1, { id: r(1)[0], score: 5, y: 1 }, { id: r(1)[1], score: 1 }));
      expect(out[0]).toBe('ACK');
      expect(journal('RelayCardGiven')).toHaveLength(0);
      expect(bout(1)).toMatchObject({ status: 'finished', scoreA: 5, scoreB: 1 });
      warn.mockRestore();
    });
  });

  it('cartons cumulés sur la rencontre : le DISP d’un relais reprend ceux déjà reçus par chaque tireur', async () => {
    await start([
      [5, 2],
      [5, 5],
      [5, 5],
    ]); // relais 4 : A1 – B3 (A1 au relais 2, B3 au relais 1)
    const [a1, b3] = r(4);
    expect(r(2)[0]).toBe(a1);
    expect(r(1)[1]).toBe(b3);
    team().deviceCards = {
      [fx.boutId(2)]: { cardsA: ['yellow'], cardsB: [] },
      [fx.boutId(1)]: { cardsA: [], cardsB: ['red', 'p-red'] },
      [fx.boutId(3)]: { cardsA: ['red'], cardsB: ['red'] }, // autres tireurs
    };
    team().fencerCards.push({
      id: 'c1',
      boutId: fx.boutId(2),
      fencerId: a1,
      type: 'yellow',
      reason: 'early_start' as never,
    });
    out = [];
    hub.pisteAction('1', 'resync');
    expect(lastDisp()).toMatchObject({
      round: '4',
      right: { id: short(a1), yellowCards: 1 },
      left: { id: short(b3), redCards: 1, pCard: 2 },
    });
    expect(lastDisp().right?.redCards).toBeUndefined();
    // Nouveau carton au relais 4 : le relais suivant de ce tireur repart de ce total
    device(info('H', 4, { id: a1, score: 15, y: 1 }, { id: b3, score: 12 }));
    expect(team().deviceCards?.[fx.boutId(4)]).toEqual({ cardsA: ['yellow'], cardsB: [] });
  });

  it('inversion droite / gauche : équipe A suivie par Id, pas par position', async () => {
    await start();
    device(info('H', 1, { id: r(1)[1], score: 4 }, { id: r(1)[0], score: 2 }));
    expect(team()).toMatchObject({ liveScoreA: 2, liveScoreB: 4 });
  });

  it('fin d’un relais intermédiaire : toujours correcte, ACK puis DISP du relais suivant avec les cumuls', async () => {
    await start();
    device(info('H', 1, { id: r(1)[0], score: 3 }, { id: r(1)[1], score: 3 }));
    out = [];
    // Égalité sans priorité : refusée en individuel, correcte pour un relais intermédiaire
    device(info('E', 1, { id: r(1)[0], score: 5 }, { id: r(1)[1], score: 5 }));
    expect(out[0]).toBe('ACK');
    // Enregistré par le moteur (recordRelayScore, source cyrano)
    expect(bout(1)).toMatchObject({ status: 'finished', scoreA: 5, scoreB: 5 });
    expect(journal('RelayScoreRecorded')).toEqual([
      expect.objectContaining({
        source: 'cyrano',
        payload: expect.objectContaining({ relayId: fx.boutId(1), scoreA: 5, scoreB: 5 }),
      }),
    ]);
    expect(out[1]).toMatchObject({
      type: 'T',
      round: '2',
      right: { id: short(r(2)[0]), score: 5 },
      left: { id: short(r(2)[1]), score: 5 },
    });
    expect(team()).toMatchObject({ currentBoutIndex: 1, liveScoreA: 0, liveScoreB: 0 });
  });

  it('relais intermédiaire avec abandon ou exclusion : fin toujours correcte (spéc. § 4), ACK et DT prévenu', async () => {
    const warn = vi.spyOn(logger, 'warn');
    await start();
    out = [];
    device(info('E', 1, { id: r(1)[0], score: 3, status: 'E' }, { id: r(1)[1], score: 1 }));
    expect(out[0]).toBe('ACK');
    expect(fx.db.getTeamMatchDetail(fx.matchId)!.bouts[0]).toMatchObject({
      status: 'finished',
      scoreA: 3,
      scoreB: 1,
      winnerId: r(1)[0],
    });
    expect(team().currentBoutIndex).toBe(1);
    expect(notices).toEqual([
      ['1', expect.objectContaining({ kind: 'team_out', relay: 1, reason: 'exclusion' })],
    ]);
    expect(warn).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('exclusion'));
    // Relais suivant, abandon
    device(info('E', 2, { id: r(2)[0], score: 4, status: 'A' }, { id: r(2)[1], score: 2 }));
    expect(notices[1]).toEqual(['1', expect.objectContaining({ relay: 2, reason: 'abandon' })]);
    warn.mockRestore();
  });

  it('relais suivant : score du relais = cumul − relais terminés ; END répété (ACK perdu) → nouvel ACK', async () => {
    await start([[5, 2]]);
    device(info('H', 2, { id: r(2)[0], score: 7 }, { id: r(2)[1], score: 6 }));
    expect(team()).toMatchObject({ liveScoreA: 2, liveScoreB: 4 });
    device(info('E', 2, { id: r(2)[0], score: 10 }, { id: r(2)[1], score: 6 }));
    expect(fx.db.getTeamMatchDetail(fx.matchId)!.bouts[1]).toMatchObject({
      status: 'finished',
      scoreA: 5,
      scoreB: 4,
      winnerId: r(2)[0],
    });
    const acks = count('ACK');
    const recorded = journal('RelayScoreRecorded').length;
    device(info('E', 2, { id: r(2)[0], score: 10 }, { id: r(2)[1], score: 6 }));
    expect(count('ACK')).toBe(acks + 1);
    expect(journal('RelayScoreRecorded')).toHaveLength(recorded);
    expect(lastDisp()).toMatchObject({ round: '3', right: { score: 10 }, left: { score: 6 } });
  });

  it('cumul inférieur aux relais terminés : ignoré, cumul de l’arène renvoyé à l’appareil', async () => {
    await start([[5, 2]]);
    out = [];
    device(info('H', 2, { id: r(2)[0], score: 3 }, { id: r(2)[1], score: 2 }));
    expect(team()).toMatchObject({ liveScoreA: 0, liveScoreB: 0 });
    expect(lastDisp()).toMatchObject({ round: '2', right: { score: 5 }, left: { score: 2 } });
  });

  it('cumul au-delà du palier du relais ou de l’objectif : ignoré, tracé, cumul de l’arène renvoyé', async () => {
    const warn = vi.spyOn(logger, 'warn');
    await start([[5, 2]]); // relais 2 : palier 10
    device(info('H', 2, { id: r(2)[0], score: 8 }, { id: r(2)[1], score: 4 }));
    out = [];
    device(info('H', 2, { id: r(2)[0], score: 11 }, { id: r(2)[1], score: 4 }));
    expect(team()).toMatchObject({ liveScoreA: 3, liveScoreB: 2 });
    expect(lastDisp()).toMatchObject({ round: '2', right: { score: 8 }, left: { score: 4 } });
    expect(warn).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('palier'));
    // END au-delà du palier : NAK, rien d'écrit
    device(info('E', 2, { id: r(2)[0], score: 12 }, { id: r(2)[1], score: 4 }));
    expect(out[out.length - 1]).toBe('NAK');
    expect(bout(2).status).toBe('not_started');
    // Dernier relais : objectif 45
    await start(Array.from({ length: 8 }, () => [5, 5] as [number, number]));
    out = [];
    device(info('H', 9, { id: r(9)[0], score: 46 }, { id: r(9)[1], score: 40 }));
    expect(team().liveScoreA).toBe(0);
    expect(lastDisp()).toMatchObject({ round: '9', right: { score: 40 } });
    warn.mockRestore();
  });

  it('BAD MATCH : tireurs d’un autre relais → alerte ; END → NAK', async () => {
    await start([
      [5, 2],
      [5, 5],
    ]);
    device(info('H', 1, { id: r(1)[0], score: 1 }, { id: r(1)[1], score: 0 }));
    expect(hub.getAlerts()['1']).toMatchObject({ kind: 'bad_match', arena: 'equipe1' });
    expect(team().liveScoreA).toBe(0);
    device(info('E', 1, { id: r(1)[0], score: 1 }, { id: r(1)[1], score: 0 }));
    expect(out[out.length - 1]).toBe('NAK');
  });

  it('appareil au repos sans le relais en cours → DISP du relais', async () => {
    await start([[5, 2]]);
    out = [];
    device(info('W', 1, { id: r(1)[0], score: 5 }, { id: r(1)[1], score: 2 }));
    expect(lastDisp()).toMatchObject({ round: '2', right: { id: short(r(2)[0]) } });
  });

  describe('remplaçant (R11 / L11 = R)', () => {
    // Relais 3 : A2 – B1 ; A2 tire aussi les relais 6 et 8 (ordre FIE)
    const twoPlayed: [number, number][] = [
      [5, 2],
      [5, 5],
    ];

    it('accepté : le remplaçant prend la place du tireur dans ses relais suivants', async () => {
      await start(twoPlayed);
      const [a2, b1] = r(3);
      const reserve = fx.A[3];
      // Demande posée pendant le relais : rien n'est encore changé (annulable, spéc. § 4)
      device(info('H', 3, { id: a2, score: 10, reserve: true }, { id: b1, score: 7 }));
      expect(journal('TeamFencerSubstituted')).toHaveLength(0);
      // Fin du relais acquittée avec la demande : substituteTeamFencer sur les relais 6 et 8
      device(info('E', 3, { id: a2, score: 11, reserve: true }, { id: b1, score: 7 }));
      expect(journal('TeamFencerSubstituted')).toEqual([
        expect.objectContaining({
          source: 'cyrano',
          payload: expect.objectContaining({
            outFencerId: a2,
            inFencerId: reserve,
            relayIds: [fx.boutId(6), fx.boutId(8)],
          }),
        }),
      ]);
      // Le relais tiré garde son tireur
      expect(bout(3)).toMatchObject({ fencerAId: a2, status: 'finished', scoreA: 1 });
      expect(team().bouts[5]).toMatchObject({ fencerAId: reserve, fencerAName: 'Petit Hugo' });
      expect(team().bouts[7]).toMatchObject({ fencerAId: reserve });
      // END répété (ACK perdu) : pas de second remplacement
      device(info('E', 3, { id: a2, score: 11, reserve: true }, { id: b1, score: 7 }));
      expect(journal('TeamFencerSubstituted')).toHaveLength(1);
      expect(fx.divergences()).toEqual([]);
    });

    it('annulé pendant le relais : aucun remplacement', async () => {
      await start(twoPlayed);
      const [a2, b1] = r(3);
      device(info('H', 3, { id: a2, score: 10, reserve: true }, { id: b1, score: 7 }));
      device(info('H', 3, { id: a2, score: 10 }, { id: b1, score: 7 }));
      device(info('E', 3, { id: a2, score: 12 }, { id: b1, score: 7 }));
      expect(journal('TeamFencerSubstituted')).toHaveLength(0);
    });

    it('refusé : équipe sans remplaçant, remplaçant déjà utilisé (code du catalogue, tracé)', async () => {
      const warn = vi.spyOn(logger, 'warn');
      await start(twoPlayed);
      const [a2, b1] = r(3);
      // Relais 3 : les deux équipes demandent ; B n'a pas de remplaçant
      device(
        info('E', 3, { id: a2, score: 15, reserve: true }, { id: b1, score: 7, reserve: true })
      );
      expect(warn).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('no_reserve'));
      expect(journal('TeamFencerSubstituted')).toHaveLength(1);
      // Relais 4 : A1 sort ; le remplaçant figure déjà dans la rencontre
      const [a1, b3] = r(4);
      device(info('E', 4, { id: a1, score: 17, reserve: true }, { id: b3, score: 9 }));
      expect(warn).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('reserve_used'));
      expect(journal('TeamFencerSubstituted')).toHaveLength(1);
      warn.mockRestore();
    });
  });

  describe('NEXT / PREV dans la rencontre', () => {
    it('NEXT pendant un relais : refusé, relais en cours renvoyé', async () => {
      await start([[5, 2]]);
      out = [];
      device('|EFP1.1|NEXT|1||%|');
      expect(lastDisp()).toMatchObject({ round: '2' });
      expect(team().currentBoutIndex).toBe(1);
    });

    it('PREV avant le début du relais suivant : relais précédent rouvert par le moteur avec son score', async () => {
      await start([
        [5, 2],
        [5, 5],
      ]);
      device('|EFP1.1|PREV|1||%|');
      expect(bout(2)).toMatchObject({ status: 'in_progress', scoreA: 5, scoreB: 5 });
      expect(journal('RelayReopened')).toEqual([
        expect.objectContaining({ source: 'cyrano', payload: expect.anything() }),
      ]);
      expect(team()).toMatchObject({ currentBoutIndex: 1, liveScoreA: 5, liveScoreB: 5 });
      expect(lastDisp()).toMatchObject({ round: '2', right: { score: 10 }, left: { score: 7 } });
      // Correction puis nouvelle validation
      device(info('E', 2, { id: r(2)[0], score: 9 }, { id: r(2)[1], score: 7 }));
      expect(fx.db.getTeamMatchDetail(fx.matchId)!.bouts[1]).toMatchObject({
        status: 'finished',
        scoreA: 4,
        scoreB: 5,
        winnerId: r(2)[0],
      });
      expect(lastDisp()).toMatchObject({ round: '3', right: { score: 9 }, left: { score: 7 } });
      expect(fx.divergences()).toEqual([]);
    });

    it('PREV après la fin de la rencontre : dernier relais rouvert, rencontre recalculée par le moteur', async () => {
      await start(Array.from({ length: 9 }, () => [5, 4] as [number, number]));
      expect(fx.db.teams.getTeamMatch(fx.matchId)!.status).toBe('finished');
      device('|EFP1.1|PREV|1||%|');
      expect(bout(9).status).toBe('in_progress');
      expect(fx.db.teams.getTeamMatch(fx.matchId)).toMatchObject({
        status: 'in_progress',
        winnerId: null,
      });
      expect(team()).toMatchObject({ currentBoutIndex: 8, liveScoreA: 5, liveScoreB: 4 });
      expect(lastDisp()).toMatchObject({ round: '9', right: { score: 45 }, left: { score: 36 } });
    });

    it('PREV refusé une fois le relais en cours commencé', async () => {
      await start([[5, 2]]);
      device(info('H', 2, { id: r(2)[0], score: 6 }, { id: r(2)[1], score: 2 }));
      out = [];
      device('|EFP1.1|PREV|1||%|');
      expect(team().currentBoutIndex).toBe(1);
      expect(journal('RelayReopened')).toHaveLength(0);
      expect(lastDisp()).toMatchObject({ round: '2', right: { score: 6 } });
    });

    it('afficheur : NEXT / PREV ignorés, END → NAK', async () => {
      cyrano.setPistes([{ piste: '1', ip: DEVICE_IP, arena: 1, mode: 'display' }]);
      await start([[5, 2]]);
      out = [];
      device('|EFP1.1|PREV|1||%|');
      device(info('E', 2, { id: r(2)[0], score: 10 }, { id: r(2)[1], score: 2 }));
      expect(out).toEqual(['NAK']);
      expect(team().currentBoutIndex).toBe(1);
    });
  });

  describe('dernier relais : règles de fin individuelles', () => {
    const eight: [number, number][] = Array.from({ length: 8 }, () => [5, 5]);

    it('END après une rencontre terminée hors de ce poste (aucun ACK donné) : NAK', async () => {
      await start(Array.from({ length: 9 }, () => [5, 4] as [number, number]));
      out = [];
      device(info('E', 9, { id: r(9)[0], score: 45 }, { id: r(9)[1], score: 36 }));
      expect(out).toEqual(['NAK']);
    });

    it('égalité sans priorité : NAK', async () => {
      await start(eight);
      device(info('E', 9, { id: r(9)[0], score: 45 }, { id: r(9)[1], score: 45 }));
      expect(out[out.length - 1]).toBe('NAK');
      expect(bout(9).status).toBe('not_started');
    });

    it('priorité à égalité (t.41.5) : ACK, rencontre décidée pour le prioritaire', async () => {
      await start(eight);
      // Priorité à gauche : tireur de l'équipe B (A est affiché à droite)
      device(
        info('E', 9, { id: r(9)[0], score: 45 }, { id: r(9)[1], score: 45 }, { priority: 'L' })
      );
      expect(out[out.length - 2]).toBe('ACK');
      expect(count('NAK')).toBe(0);
      expect(bout(9)).toMatchObject({ status: 'finished', scoreA: 5, scoreB: 5 });
      expect(fx.db.teams.getTeamMatch(fx.matchId)).toMatchObject({
        status: 'finished',
        winnerId: fx.teamBId,
      });
      expect(journal('TeamMatchDecided')).toHaveLength(1);
      expect(journal('TeamMatchDecided')[0]).toMatchObject({ source: 'cyrano' });
      expect(fx.divergences()).toEqual([]);
    });

    it('victoire / défaite imposée à égalité, sans priorité : NAK, rien d’enregistré', async () => {
      await start(eight);
      device(
        info(
          'E',
          9,
          { id: r(9)[0], score: 45, status: 'V' },
          { id: r(9)[1], score: 45, status: 'D' }
        )
      );
      expect(out[out.length - 1]).toBe('NAK');
      expect(bout(9).status).toBe('not_started');
      expect(journal('TeamMatchDecided')).toHaveLength(0);
    });

    it('priorité sans égalité : ignorée, vainqueur au cumul', async () => {
      await start(eight);
      device(
        info('E', 9, { id: r(9)[0], score: 45 }, { id: r(9)[1], score: 43 }, { priority: 'L' })
      );
      expect(out[out.length - 2]).toBe('ACK');
      expect(fx.db.teams.getTeamMatch(fx.matchId)).toMatchObject({ winnerId: fx.teamAId });
    });

    it('victoire au cumul : ACK, rencontre terminée par le moteur, affichage vide', async () => {
      await start(eight);
      device(info('E', 9, { id: r(9)[0], score: 45 }, { id: r(9)[1], score: 43 }));
      expect(out[out.length - 2]).toBe('ACK');
      expect(fx.db.getTeamMatchDetail(fx.matchId)!.bouts[8]).toMatchObject({
        status: 'finished',
        scoreA: 5,
        scoreB: 3,
        winnerId: r(9)[0],
      });
      expect(fx.db.teams.getTeamMatch(fx.matchId)).toMatchObject({
        status: 'finished',
        winnerId: fx.teamAId,
      });
      expect(journal('TeamMatchDecided')).toHaveLength(1);
      expect(out[out.length - 1]).toMatchObject({ command: 'DISP' });
      expect((out[out.length - 1] as CyranoMessage).right).toBeUndefined();
      // END répété après la fin : ACK de nouveau
      device(info('E', 9, { id: r(9)[0], score: 45 }, { id: r(9)[1], score: 43 }));
      expect(out[out.length - 1]).toBe('ACK');
      // END qui n'est pas une répétition (autres tireurs) : NAK, jamais de silence
      device(info('E', 8, { id: r(8)[0], score: 45 }, { id: r(8)[1], score: 43 }));
      expect(out[out.length - 1]).toBe('NAK');
      expect(fx.divergences()).toEqual([]);
    });
  });

  it('arme laser : affichage seul (END → NAK) ; format arène laser : non raccordé', async () => {
    await start([], Weapon.LASER, { teamFormat: 'fie-relay' });
    expect(lastDisp()).toMatchObject({ type: 'T', round: '1' });
    expect(lastDisp().weapon).toBeUndefined();
    device(info('E', 1, { id: r(1)[0], score: 5 }, { id: r(1)[1], score: 1 }));
    expect(out[out.length - 1]).toBe('NAK');
    // Arène laser à la place : le relais disparaît de l'appareil, rien d'autre n'est affiché
    const comp = fx.db.getCompetition(fx.competitionId)!;
    fx.db.updateCompetition(fx.competitionId, {
      settings: { ...comp.settings, teamFormat: 'laser-arena' },
    } as never);
    remote.setTeamArenaMatch('1', fx.matchId, false);
    expect(disps().every(d => !d.right || d.round === '1')).toBe(true);
    expect(lastDisp().right).toBeUndefined();
    out = [];
    device(info('E', 1, { id: r(1)[0], score: 5 }, { id: r(1)[1], score: 1 }));
    expect(out).toEqual([]);
  });

  it('rencontre terminée encore assignée : l’arène individuelle N reçoit les entrées', async () => {
    await start(Array.from({ length: 9 }, () => [5, 4] as [number, number]));
    const withReferees = remote as unknown as { loadSessionReferees: () => unknown[] };
    vi.spyOn(withReferees, 'loadSessionReferees').mockReturnValue([]);
    const I = ['c1c1c1c1-0000-4000-8000-000000000001', 'd2d2d2d2-0000-4000-8000-000000000002'];
    const fencer = (id: string) => ({ id, firstName: 'I', lastName: id.slice(0, 2) });
    await remote.startSession(fx.competitionId, 1, [
      { __poolFencers: true, poolId: 'pool-i', poolNumber: 1, strip: 1, fencers: [] },
      {
        id: 'mi-0000-4000-8000-000000000000',
        poolId: 'pool-i',
        number: 1,
        fencerA: fencer(I[0]),
        fencerB: fencer(I[1]),
        status: 'not_started',
      },
    ] as never);
    expect(remote.getArena('arena1')?.currentMatch?.fencerA.id).toBe(I[0]);
    device(info('H', 1, { id: I[0], score: 2 }, { id: I[1], score: 1 }));
    expect(remote.getArena('arena1')?.currentMatch).toMatchObject({ scoreA: 2, scoreB: 1 });
    // PREV pour la rencontre terminée : sans effet sur l'arène équipe
    device('|EFP1.1|PREV|1||%|');
    expect(journal('RelayReopened')).toHaveLength(0);
  });

  describe('verrou appareil maître sur la tablette équipe', () => {
    type Handler = (data: Record<string, unknown>) => void;
    const tablet = () => {
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
      return { handlers, socket };
    };

    it('maître et en ligne : ajout de touche, cartons, relais suivant, remise à zéro refusés ; retrait permis', async () => {
      await start();
      device(info('H', 1, { id: r(1)[0], score: 3 }, { id: r(1)[1], score: 1 }));
      expect(team().cyrano).toEqual({ piste: '1', mode: 'master', online: true });
      const { handlers, socket } = tablet();
      const arenaId = '1';
      handlers.team_touch({ arenaId, side: 'A', points: 1 });
      handlers.team_advance_bout({ arenaId });
      handlers.team_reset_bout({ arenaId });
      handlers.team_card({ arenaId, teamId: fx.teamAId, type: 'yellow' });
      handlers.team_fencer_card({ arenaId, side: 'A', reason: 'early_start' });
      expect(team()).toMatchObject({ liveScoreA: 3, liveScoreB: 1, currentBoutIndex: 0 });
      expect(team().cards).toHaveLength(0);
      expect(team().fencerCards).toHaveLength(0);
      expect(bout(1).status).toBe('not_started');
      expect(journal('RelayScoreRecorded')).toHaveLength(0);
      expect(socket.emit).toHaveBeenCalledWith('team_arena_state', expect.anything());
      // Retrait : correction toujours permise, renvoyée à l'appareil
      out = [];
      handlers.team_touch({ arenaId, side: 'A', points: -1 });
      expect(team().liveScoreA).toBe(2);
      expect(lastDisp()).toMatchObject({ right: { score: 2 } });
    });

    it('afficheur ou appareil absent : tablette libre', async () => {
      await start();
      const { handlers } = tablet();
      handlers.team_touch({ arenaId: '1', side: 'B', points: 1 });
      expect(team().liveScoreB).toBe(1); // jamais vu : pas de verrou
      device(info('H', 1, { id: r(1)[0], score: 0 }, { id: r(1)[1], score: 1 }));
      cyrano.setPistes([{ piste: '1', ip: DEVICE_IP, arena: 1, mode: 'display' }]);
      hub.syncPisteModes();
      expect(team().cyrano).toMatchObject({ mode: 'display', online: true });
      handlers.team_touch({ arenaId: '1', side: 'B', points: 1 });
      expect(team().liveScoreB).toBe(2);
    });
  });

  it('rencontre retirée de l’arène : affichage vide', async () => {
    await start();
    remote.clearTeamArenaMatch('1');
    expect(lastDisp().right).toBeUndefined();
  });
});
