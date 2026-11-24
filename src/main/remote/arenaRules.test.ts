/**
 * Règles du match d'arène envoyées à la tablette (#2214) : score limite (pas de carton P à
 * 14:14) et rangs du tableau en cours pour le noir P à égalité (FFE dès M15).
 */
import { describe, expect, it } from 'vitest';
import type { ArenaMatch } from '../../shared/types/remote';
import { arenaMatchRules, type ArenaRulesContext } from './arenaRules';
import type { SessionMatch } from './types';

const fencer = (id: string) => ({ id }) as ArenaMatch['fencerA'];
const arenaMatch = (id: string, a: string, b: string, isTableau = true): ArenaMatch =>
  ({
    id,
    fencerA: fencer(a),
    fencerB: fencer(b),
    scoreA: 0,
    scoreB: 0,
    status: 'in_progress',
    startTime: null,
    endTime: null,
    ...(isTableau ? { isTableau: true } : { poolId: 'p1' }),
  }) as ArenaMatch;

// Tableau de 4 : 1er tour (rangs du tirage), demi-finale formée sans rang
const sessionMatches: SessionMatch[] = [
  {
    id: 't1',
    status: 'finished',
    isTableau: true,
    tableId: 'main',
    fencerA: fencer('a'),
    fencerB: fencer('d'),
    seedA: 1,
    seedB: 4,
  },
  {
    id: 't2',
    status: 'finished',
    isTableau: true,
    tableId: 'main',
    fencerA: fencer('b'),
    fencerB: fencer('c'),
    seedA: 2,
    seedB: 3,
  },
  {
    id: 'f',
    status: 'not_started',
    isTableau: true,
    tableId: 'main',
    fencerA: fencer('a'),
    fencerB: fencer('c'),
  },
] as SessionMatch[];

const ctx = (over: Partial<ArenaRulesContext> = {}): ArenaRulesContext => ({
  sessionMatches,
  sessionWeapon: 'E',
  sessionPoolMaxScore: 5,
  sessionTableMaxScore: 15,
  sessionCategory: 'SEN',
  ...over,
});

describe('arenaMatchRules', () => {
  it('sans match : rien', () => {
    expect(arenaMatchRules(ctx(), null)).toEqual({});
  });

  it('score limite : tableau 15, poule 5, sans limite = 0 (JSON)', () => {
    expect(arenaMatchRules(ctx(), arenaMatch('f', 'a', 'c')).scoreLimit).toBe(15);
    expect(arenaMatchRules(ctx(), arenaMatch('x', 'a', 'c', false)).scoreLimit).toBe(5);
    expect(
      arenaMatchRules(ctx({ sessionTableMaxScore: 0 }), arenaMatch('f', 'a', 'c')).scoreLimit
    ).toBe(0);
  });

  it('noir P : rangs du tirage du tableau en cours dès M15, au tableau seulement', () => {
    expect(arenaMatchRules(ctx(), arenaMatch('f', 'a', 'c')).passivityRanks).toEqual({
      A: 1,
      B: 3,
    });
    expect(
      arenaMatchRules(ctx({ sessionCategory: 'U13' }), arenaMatch('f', 'a', 'c')).passivityRanks
    ).toBeNull();
    expect(arenaMatchRules(ctx(), arenaMatch('x', 'a', 'c', false)).passivityRanks).toBeNull();
    // Tableau tiré sans rangs enregistrés : classement initial (null)
    const noSeeds = sessionMatches.map(m => ({ ...m, seedA: null, seedB: null }));
    expect(
      arenaMatchRules(ctx({ sessionMatches: noSeeds }), arenaMatch('f', 'a', 'c')).passivityRanks
    ).toBeNull();
  });
});
