import { describe, expect, it, vi } from 'vitest';
import {
  Category,
  CompetitionSettings,
  Fencer,
  FencerStatus,
  Pool,
  PoolRanking,
  Weapon,
} from '../../types';

/** Classement de chaque tour fourni par le test (pool.id → classement du tour) */
const rankings = new Map<string, PoolRanking[]>();
vi.mock('../../utils/poolOrchestration', () => ({
  computeOverallRankingFor: (pools: Pool[]) => rankings.get(pools[0]?.id ?? '') ?? [],
}));

import { buildDefaultCompetitionSettings } from '../../utils/defaultCompetitionSettings';
import { applyOperationsV2 } from '../formula/formulaV2Operations';
import { cumulativeRanking, nextRoundPlan } from './roundSeeding';

const fencer = (id: string): Fencer =>
  ({ id, lastName: id, firstName: id, status: FencerStatus.CHECKED_IN }) as Fencer;
const row = (
  id: string,
  rank: number,
  v: number,
  m: number,
  td: number,
  tr: number
): PoolRanking => ({
  fencer: fencer(id),
  rank,
  victories: v,
  defeats: m - v,
  matchesPlayed: m,
  touchesScored: td,
  touchesReceived: tr,
  index: td - tr,
  ratio: v / m,
});
const round = (id: string, rows: PoolRanking[]): Pool[] => {
  rankings.set(id, rows);
  return [{ id } as Pool];
};

// Tour 1 : A domine, B moyen ; tour 2 : B gagne tout, A perd tout
const r1 = round('t1', [
  row('A', 1, 4, 4, 20, 5),
  row('B', 2, 2, 4, 14, 12),
  row('C', 3, 0, 4, 5, 20),
]);
const r2 = round('t2', [
  row('B', 1, 2, 2, 10, 4),
  row('C', 2, 1, 2, 7, 8),
  row('A', 3, 0, 2, 4, 10),
]);

describe('répartition du tour suivant (Q4, ADR-0036)', () => {
  it('cumul des tours : victoires et touches additionnées', () => {
    const r = cumulativeRanking([r1], r2, false);
    expect(r.map(x => [x.fencer.id, x.rank, x.victories, x.matchesPlayed, x.index])).toEqual([
      ['A', 1, 4, 6, 9],
      ['B', 2, 4, 6, 8],
      ['C', 3, 1, 6, -16],
    ]);
  });

  const settings = buildDefaultCompetitionSettings({
    weapon: Weapon.EPEE,
    category: Category.SENIOR,
  }) as CompetitionSettings;
  const plan = (formulaOps: Parameters<typeof applyOperationsV2>[1]) =>
    nextRoundPlan({
      weapon: Weapon.EPEE,
      settings: {
        ...settings,
        formula: applyOperationsV2(
          { weapon: Weapon.EPEE, category: Category.SENIOR, settings },
          formulaOps,
          () => 'x'
        ),
      },
      round: 2,
      pools: r2,
      history: [r1],
      isLaserSabre: false,
    });

  it('défaut : classement du tour terminé', () => {
    const p = plan([
      { op: 'insertPhase', brick: 'pool', at: 1 },
      { op: 'insertPhase', brick: 'pool', at: 2 },
    ]);
    expect(p.seeding).toBe('previous_round');
    expect(p.ranking[0].fencer.id).toBe('B');
  });

  it('cumul choisi sur le tour suivant, qualifiés du tour terminé', () => {
    const p = plan([
      { op: 'insertPhase', brick: 'pool', at: 1 },
      { op: 'insertPhase', brick: 'pool', at: 2 },
      { op: 'setPhase', phase: 'pool-1', settings: { qualifiers: 2 } },
      { op: 'setPhase', phase: 'pool-2', settings: { seeding: 'cumulative' } },
    ]);
    expect(p.seeding).toBe('cumulative');
    expect(p.ranking[0].fencer.id).toBe('A');
    expect(p.qualifierCount).toBe(2);
  });

  it('sans formule enregistrée : comportement historique', () => {
    const p = nextRoundPlan({
      weapon: Weapon.EPEE,
      settings: { ...settings, poolRounds: 3, poolRoundQualifiers: [0, 2] },
      round: 2,
      pools: r2,
      history: [r1],
      isLaserSabre: false,
    });
    expect([p.seeding, p.ranking[0].fencer.id, p.qualifierCount]).toEqual([
      'previous_round',
      'B',
      2,
    ]);
  });
});
