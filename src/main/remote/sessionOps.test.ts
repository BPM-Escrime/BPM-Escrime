/**
 * updateMatchScore (#1500, #2175) : match d'entraînement porté par l'arène seule ; score en
 * cours en mémoire seulement, jamais écrit en base ni « terminé » par ce chemin.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../ipc/dbHandlers', () => ({ emitCompetitionEvent: vi.fn() }));

import { updateMatchScore, type SessionOpsContext } from './sessionOps';
import type { RemoteScoreUpdate } from '../../shared/types/remote';

const update = { matchId: 'tm1', scoreA: 3, scoreB: 1, status: 'in_progress' } as RemoteScoreUpdate;

const ctx = (arenaMatchId: string | null) => {
  const updateArenaScore = vi.fn();
  const c = {
    db: { getMatch: () => null },
    sessionMatches: [],
    sessionMatchScores: new Map(),
    arenas: new Map([['arena1', { currentMatch: arenaMatchId ? { id: arenaMatchId } : null }]]),
    updateArenaScore,
  } as unknown as SessionOpsContext;
  return { c, updateArenaScore };
};

describe('updateMatchScore', () => {
  it('match d’entraînement sur une arène : score appliqué, pas d’erreur', async () => {
    const { c, updateArenaScore } = ctx('tm1');
    await expect(updateMatchScore(c, 'tm1', update)).resolves.toBeUndefined();
    expect(updateArenaScore).toHaveBeenCalledWith('arena1', 3, 1);
  });
  it('match introuvable partout : erreur « Match non trouvé »', async () => {
    const { c } = ctx(null);
    await expect(updateMatchScore(c, 'tm1', update)).rejects.toThrow('Match non trouvé');
  });

  it('match en base : mémoire seulement, jamais terminé par ce chemin (#2175)', async () => {
    const updateMatch = vi.fn();
    const updateArenaScore = vi.fn();
    const sessionMatchScores = new Map<string, { status: string }>();
    const c = {
      db: { getMatch: () => ({ id: 'm1' }), updateMatch },
      sessionMatches: [],
      sessionMatchScores,
      arenas: new Map([['arena1', { currentMatch: { id: 'm1', status: 'in_progress' } }]]),
      updateArenaScore,
    } as unknown as SessionOpsContext;
    await updateMatchScore(c, 'm1', { ...update, matchId: 'm1', status: 'finished' });
    expect(updateMatch).not.toHaveBeenCalled();
    expect(updateArenaScore).toHaveBeenCalledWith('arena1', 3, 1);
    expect(sessionMatchScores.get('m1')?.status).toBe('in_progress');
  });

  it('match déjà terminé (hors arène) : file hors-ligne rejouée sans effet (#2175)', async () => {
    const updateArenaScore = vi.fn();
    const sessionMatchScores = new Map([['m1', { status: 'finished', scoreA: 5, scoreB: 2 }]]);
    const c = {
      db: { getMatch: () => ({ id: 'm1' }), updateMatch: vi.fn() },
      sessionMatches: [],
      sessionMatchScores,
      arenas: new Map(),
      updateArenaScore,
    } as unknown as SessionOpsContext;
    await updateMatchScore(c, 'm1', { ...update, matchId: 'm1' });
    expect(updateArenaScore).not.toHaveBeenCalled();
    expect(sessionMatchScores.get('m1')).toMatchObject({ status: 'finished', scoreA: 5 });
  });
});
