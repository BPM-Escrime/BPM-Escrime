import { describe, expect, it } from 'vitest';
import type { Fencer } from '../../types';
import type { TableauMatch } from './tableauTypes';
import { closeStage, isStageDone, stageMatches } from './tableauStage';

const f = (id: string) => ({ id, lastName: id, firstName: id }) as Fencer;
let n = 0;
const m = (
  round: number,
  a: Fencer | null,
  b: Fencer | null,
  winner: Fencer | null,
  seeds: [number | null, number | null] = [null, null]
): TableauMatch => ({
  id: `m${++n}`,
  round,
  position: n,
  fencerA: a,
  fencerB: b,
  scoreA: null,
  scoreB: null,
  winner,
  isBye: !a || !b,
  seedA: seeds[0],
  seedB: seeds[1],
});

// Tableau de 8 arrêté à 2 : quarts (8) et demies (4) se jouent, la finale (2) non
const [s1, s2, s3, s4, s5, s6, s7, s8] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map(f);
const quarters = [
  m(8, s1, s8, s1, [1, 8]),
  m(8, s4, s5, s5, [4, 5]),
  m(8, s3, s6, s6, [3, 6]),
  m(8, s2, s7, s2, [2, 7]),
];
const semis = [m(4, s1, s5, s5), m(4, s6, s2, s2)];
const final = m(2, s5, s2, null);

describe('tableau arrêté à N (ADR-0037)', () => {
  it('seuls les tours où il reste plus de N tireurs se jouent', () => {
    expect(stageMatches([...quarters, ...semis, final], 2)).toHaveLength(6);
    expect(isStageDone([...quarters, ...semis, final], 2)).toBe(true);
    expect(isStageDone([...quarters, { ...semis[0], winner: null }, semis[1]], 2)).toBe(false);
  });

  it('restants par rang d’entrée ; éliminés par tour atteint puis rang d’entrée (Q5)', () => {
    const out = closeStage([...quarters, ...semis, final], 2)!;
    // E (5) et B (2) restent : B entre en premier
    expect(out.qualified.map(x => x.id)).toEqual(['B', 'E']);
    // Demi-finalistes battus d'abord (A rang 1, F rang 6), puis quarts (C 3, D 4, G 7, H 8)
    expect(out.eliminated.map(e => [e.fencer.id, e.round])).toEqual([
      ['A', 4],
      ['F', 4],
      ['C', 8],
      ['D', 8],
      ['G', 8],
      ['H', 8],
    ]);
  });

  it('étape non terminée : pas de clôture', () => {
    expect(closeStage([...quarters, { ...semis[0], winner: null }, semis[1]], 2)).toBeNull();
  });
});
