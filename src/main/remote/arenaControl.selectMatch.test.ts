/**
 * select_match (#1882) : la tablette renvoie les noms abrégés qu'elle a reçus (masquage
 * RGPD) ; l'arène garde les tireurs de la session, pas ceux de la tablette.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Socket } from 'socket.io';
import { handleArenaControl, type ArenaControlContext } from './arenaControl';

describe('arena_control select_match (#1882)', () => {
  it('reprend fencerA / fencerB / referee de la session', () => {
    const real = {
      fencerA: { id: 'a', lastName: 'DUPONT', firstName: 'Léa' },
      fencerB: { id: 'b', lastName: 'DURAND', firstName: 'Léo' },
      referee: { id: 'r', name: 'MARTIN Paul' },
    };
    const assignMatchToArena = vi.fn();
    const ctx = {
      getArena: () => ({ id: '1' }),
      sessionMatches: [{ id: 'm1', isTableau: false, ...real }],
      assignMatchToArena,
      logDiag: () => {},
      arenaCards: new Map(),
      arenaTouches: new Map(),
      arenaExits: new Map(),
      arenaEventTimes: new Map(),
      arenas: new Map(),
    } as unknown as ArenaControlContext;
    handleArenaControl(ctx, { id: 's1', emit: vi.fn() } as unknown as Socket, {
      arenaId: '1',
      action: 'select_match',
      match: {
        id: 'm1',
        fencerA: { id: 'a', lastName: 'D.', firstName: 'L.' },
        fencerB: { id: 'b', lastName: 'D.', firstName: 'L.' },
        referee: { id: 'r', name: 'M. P.' },
        scoreA: 0,
        scoreB: 0,
      } as never,
    });
    const assigned = assignMatchToArena.mock.calls[0][1];
    expect(assigned.fencerA).toEqual(real.fencerA);
    expect(assigned.fencerB).toEqual(real.fencerB);
    expect(assigned.referee).toEqual(real.referee);
  });
});

describe('arena_control select_match, appareil maître (#1999)', () => {
  const setup = (cyrano: { mode: string; online: boolean } | null, status = 'in_progress') => {
    const current = { id: 'm1', scoreA: 3, scoreB: 1, status: 'in_progress' };
    const arena = { id: '1', status, currentMatch: current, cyrano };
    const assignMatchToArena = vi.fn();
    const arenaCards = new Map([['1', { cardsA: ['yellow'], cardsB: [] }]]);
    const ctx = {
      getArena: () => arena,
      sessionMatches: [],
      assignMatchToArena,
      logDiag: () => {},
      arenaCards,
      arenaTouches: new Map(),
      arenaExits: new Map(),
      arenaEventTimes: new Map(),
      arenaRefereeSelected: new Map(),
      arenas: new Map(),
    } as unknown as ArenaControlContext;
    const emit = vi.fn();
    handleArenaControl(ctx, { id: 's1', emit } as unknown as Socket, {
      arenaId: '1',
      action: 'select_match',
      // Liste de la tablette restée à 0-0 (repos de l'appareil)
      match: { id: 'm1', scoreA: 0, scoreB: 0 } as never,
    });
    return { arena, assignMatchToArena, arenaCards, emit };
  };

  it('rouvrir le match en cours garde score et cartons, et recale la tablette', () => {
    const { arena, assignMatchToArena, arenaCards, emit } = setup({ mode: 'master', online: true });
    expect(assignMatchToArena).not.toHaveBeenCalled();
    expect(arena.currentMatch).toMatchObject({ scoreA: 3, scoreB: 1 });
    expect(arenaCards.get('1')).toEqual({ cardsA: ['yellow'], cardsB: [] });
    expect(emit).toHaveBeenCalledWith(
      'arena:1:update',
      expect.objectContaining({ scoreA: 3, scoreB: 1, cardsA: ['yellow'], source: 'device' })
    );
  });

  it('mode manuel ou appareil hors ligne : sélection habituelle', () => {
    expect(setup({ mode: 'manual', online: true }).assignMatchToArena).toHaveBeenCalled();
    expect(setup({ mode: 'master', online: false }).assignMatchToArena).toHaveBeenCalled();
    expect(setup(null).assignMatchToArena).toHaveBeenCalled();
  });
});

describe('arena_control select_match, sous-pistes (#2300)', () => {
  const setup = (baseStatus: string, opened = false) => {
    const m1 = { id: 'm1', poolId: 'p1', status: 'not_started', startTime: null };
    const arenas = new Map<string, unknown>([
      ['arena1', { id: 'arena1', status: baseStatus, currentMatch: { ...m1 } }],
      ['arena1s2', { id: 'arena1s2', status: 'idle', currentMatch: null }],
      ['arena2', { id: 'arena2', status: 'ready', currentMatch: { ...m1 } }],
    ]);
    const loadNextMatch = vi.fn();
    const ctx = {
      getArena: (id: string) => arenas.get(id),
      sessionMatches: [],
      assignMatchToArena: vi.fn(),
      loadNextMatch,
      logDiag: () => {},
      arenaCards: new Map(),
      arenaTouches: new Map(),
      arenaExits: new Map(),
      arenaEventTimes: new Map(),
      arenaRefereeSelected: new Map([['arena1', opened]]),
      arenas,
    } as unknown as ArenaControlContext;
    handleArenaControl(ctx, { id: 's2', emit: vi.fn() } as unknown as Socket, {
      arenaId: 'arena1s2',
      action: 'select_match',
      match: { id: 'm1', scoreA: 0, scoreB: 0 } as never,
    });
    return loadNextMatch;
  };

  it('match préchargé sur la piste : la piste passe au suivant, pas les autres pistes', () => {
    const loadNextMatch = setup('ready');
    expect(loadNextMatch).toHaveBeenCalledTimes(1);
    expect(loadNextMatch).toHaveBeenCalledWith('arena1');
  });

  it('match ouvert ou lancé sur la piste : jamais remplacé', () => {
    expect(setup('ready', true)).not.toHaveBeenCalled();
    expect(setup('in_progress')).not.toHaveBeenCalled();
  });
});
