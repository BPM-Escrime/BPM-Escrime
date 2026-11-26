/**
 * Répartition d'une scission entre ses branches (planSplit, docs/adr/0039) et classement de
 * l'épreuve d'origine après la scission (Q6 ; Q5 d'ADR-0037 amendée le 2026-11-26).
 */
import { describe, expect, it } from 'vitest';
import { Category, Fencer, FencerStatus, Gender, PoolRanking } from '../../types';
import type { SplitPhase } from './formulaV2';
import {
  originFinalRanking,
  planSplit,
  rankingWithoutSplit,
  renumberRanks,
  simulateSplit,
  splitHistoryOf,
} from './splitPlan';
import { rankAfterStages, type TableauStageRecord } from '../tableau/tableauStage';

const fencer = (id: string, patch: Partial<Fencer> = {}): Fencer =>
  ({
    id,
    lastName: id,
    firstName: id,
    status: FencerStatus.QUALIFIED,
    ...patch,
  }) as Fencer;
const row = (f: Fencer, rank: number): PoolRanking => ({
  fencer: f,
  rank,
  victories: 0,
  defeats: 0,
  matchesPlayed: 0,
  touchesScored: 0,
  touchesReceived: 0,
  index: 0,
  ratio: 0,
});
/** Classement de n tireurs, rangs donnés (égalités possibles) */
const ranking = (ranks: number[], patch: (i: number) => Partial<Fencer> = () => ({})) =>
  ranks.map((r, i) => row(fencer(`f${i + 1}`, patch(i)), r));
const split = (s: Partial<SplitPhase>): SplitPhase => ({
  kind: 'split',
  id: 's',
  criterion: 'rank',
  branches: [],
  ...s,
});
const ids = (rows: PoolRanking[]) => rows.map(r => r.fencer.id);

describe('planSplit par rang (ADR-0039)', () => {
  it('nombre : chaque branche prend son nombre, la dernière le reste ; rangs depuis 1', () => {
    const plan = planSplit(
      ranking([1, 2, 3, 4, 5, 6]),
      split({
        branches: [
          { label: 'A', phases: [], take: { mode: 'fixed_count', count: 2 } },
          { label: 'B', phases: [], take: { mode: 'fixed_count', count: 3 } },
          { label: 'C', phases: [] },
        ],
      })
    );
    expect(plan.branches.map(b => ids(b.rows))).toEqual([['f1', 'f2'], ['f3', 'f4', 'f5'], ['f6']]);
    expect(plan.branches[1].rows.map(r => r.rank)).toEqual([1, 2, 3]);
    expect(plan.missing).toEqual([]);
  });

  it('ex aequo à la borne : gardés dans la branche, comme la qualification', () => {
    const plan = planSplit(
      ranking([1, 2, 3, 3, 5, 6]),
      split({
        branches: [
          { label: 'A', phases: [], take: { mode: 'fixed_count', count: 3 } },
          { label: 'B', phases: [] },
        ],
      })
    );
    expect(plan.branches.map(b => ids(b.rows))).toEqual([
      ['f1', 'f2', 'f3', 'f4'],
      ['f5', 'f6'],
    ]);
    // Égalités gardées après renumérotation
    expect(plan.branches[0].rows.map(r => r.rank)).toEqual([1, 2, 3, 3]);
  });

  it('ex aequo à la borne, « initial_ranking » (ADR-0040) : départagés au rang d’entrée', () => {
    // f3 et f4 ex aequo à la 3e place ; rang d'entrée : f4 (1) avant f3 (9)
    const r = ranking([1, 2, 3, 3, 5, 6], i => ({ ranking: [4, 5, 9, 1, 6, 7][i] }));
    const branches = [
      {
        label: 'A',
        phases: [],
        take: { mode: 'fixed_count' as const, count: 3, ties: 'initial_ranking' as const },
      },
      { label: 'B', phases: [] },
    ];
    const plan = planSplit(r, split({ branches }));
    expect(plan.branches.map(b => ids(b.rows))).toEqual([
      ['f1', 'f2', 'f4'],
      ['f3', 'f5', 'f6'],
    ]);
    expect(plan.tiedAtBar).toEqual([{ rank: 3, fencerIds: ['f3', 'f4'], places: 1 }]);
    // « ties » de la commande prime sur la formule
    expect(ids(planSplit(r, split({ branches }), [], 'all').branches[0].rows)).toEqual([
      'f1',
      'f2',
      'f3',
      'f4',
    ]);
  });

  it('pourcentage de l’effectif entrant (arrondi comme la qualification)', () => {
    const plan = planSplit(
      ranking([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
      split({
        branches: [
          { label: 'A', phases: [], take: { mode: 'percentage', percentage: 30 } },
          { label: 'B', phases: [], take: { mode: 'percentage', percentage: 50 } },
          { label: 'C', phases: [] },
        ],
      })
    );
    // 30 % de 10 = 3 ; 50 % de 10 = 5 (de l'effectif entrant, pas du reste) ; reste 2
    expect(plan.branches.map(b => b.rows.length)).toEqual([3, 5, 2]);
  });

  it('pourcentage avec ex aequo à la borne', () => {
    const plan = planSplit(
      ranking([1, 2, 2, 4]),
      split({
        branches: [
          { label: 'A', phases: [], take: { mode: 'percentage', percentage: 50 } },
          { label: 'B', phases: [] },
        ],
      })
    );
    expect(plan.branches.map(b => ids(b.rows))).toEqual([['f1', 'f2', 'f3'], ['f4']]);
  });
});

describe('planSplit par sexe, catégorie, manuel (ADR-0039)', () => {
  it('sexe : champ du tireur ; sans sexe (ou mixte) : manquant', () => {
    const genders = [Gender.FEMALE, Gender.MALE, undefined, Gender.FEMALE, Gender.MIXED];
    const plan = planSplit(
      ranking([1, 2, 3, 4, 5], i => ({ gender: genders[i] as Gender })),
      split({
        criterion: 'gender',
        branches: [
          { label: 'Dames', phases: [], gender: Gender.FEMALE },
          { label: 'Hommes', phases: [], gender: Gender.MALE },
        ],
      })
    );
    expect(plan.branches.map(b => ids(b.rows))).toEqual([['f1', 'f4'], ['f2']]);
    expect(plan.branches[0].rows.map(r => r.rank)).toEqual([1, 2]);
    expect(plan.missing).toEqual(['f3', 'f5']);
  });

  it('catégorie : une ou plusieurs par branche ; sans catégorie : manquant', () => {
    const cats = [Category.V1, Category.V3, Category.V4, undefined, Category.V2];
    const plan = planSplit(
      ranking([1, 2, 3, 4, 5], i => ({ category: cats[i] })),
      split({
        criterion: 'category',
        branches: [
          { label: 'V1-V2', phases: [], categories: [Category.V1, Category.V2] },
          { label: 'V3-V4', phases: [], categories: [Category.V3, Category.V4] },
        ],
      })
    );
    expect(plan.branches.map(b => ids(b.rows))).toEqual([
      ['f1', 'f5'],
      ['f2', 'f3'],
    ]);
    expect(plan.missing).toEqual(['f4']);
  });

  it('manuel : affectations de l’écran ; tireur non affecté : manquant', () => {
    const plan = planSplit(
      ranking([1, 2, 3]),
      split({
        criterion: 'manual',
        branches: [
          { label: 'N1', phases: [] },
          { label: 'N2', phases: [] },
        ],
      }),
      [
        { fencerId: 'f3', branch: 'N1' },
        { fencerId: 'f1', branch: 'N2' },
      ]
    );
    expect(plan.branches.map(b => ids(b.rows))).toEqual([['f3'], ['f1']]);
    expect(plan.branches[0].rows[0].rank).toBe(1);
    expect(plan.missing).toEqual(['f2']);
  });
});

describe('classement de l’épreuve d’origine après la scission (Q6, Q5 amendée)', () => {
  it('rangs renumérotés, égalités gardées', () => {
    expect(renumberRanks(ranking([3, 4, 4, 6])).map(r => r.rank)).toEqual([1, 2, 2, 4]);
  });

  it('les restants partis dans les filles ; éliminés du tableau, puis des poules', () => {
    // f1..f4 au tableau arrêté à 2 : f1, f2 restants (partis en scission), f3, f4 éliminés ;
    // f5 éliminé des poules
    const all = ranking([1, 2, 3, 4, 5]);
    const stage: TableauStageRecord = {
      kind: 'tableau',
      stopAt: 2,
      matches: [
        {
          id: 'm1',
          round: 4,
          position: 1,
          fencerA: all[0].fencer,
          fencerB: all[3].fencer,
          scoreA: null,
          scoreB: null,
          winner: all[0].fencer,
          isBye: false,
          seedA: 1,
          seedB: 4,
        },
        {
          id: 'm2',
          round: 4,
          position: 2,
          fencerA: all[1].fencer,
          fencerB: all[2].fencer,
          scoreA: null,
          scoreB: null,
          winner: all[1].fencer,
          isBye: false,
          seedA: 2,
          seedB: 3,
        },
      ],
      eliminated: [
        { fencerId: 'f3', round: 4, seed: 3 },
        { fencerId: 'f4', round: 4, seed: 4 },
      ],
    };
    const history = splitHistoryOf([
      { label: 'A', competitionId: 'c-a', fencerIds: ['f1'] },
      { label: 'B', competitionId: 'c-b', fencerIds: ['f2'] },
    ]);
    const { ranking: origin } = rankAfterStages(rankingWithoutSplit(all, history), [stage]);
    expect(ids(origin)).toEqual(['f3', 'f4', 'f5']);
    expect(origin.map(r => r.rank)).toEqual([1, 2, 3]);
    expect(rankingWithoutSplit(all, [])).toBe(all);
    expect(splitHistoryOf('x')).toEqual([]);
  });
});

describe('classement final de l’épreuve d’origine (ADR-0039, Q5 d’ADR-0037)', () => {
  it('sans les tireurs partis, puis éliminés du tableau arrêté avant ceux des poules', () => {
    const f = (id: string) => ({ id, lastName: id, firstName: id }) as never;
    const row = (id: string, rank: number) => ({ fencer: f(id), rank }) as unknown as PoolRanking;
    const ranking = ['A', 'B', 'C', 'D', 'E'].map((id, i) => row(id, i + 1));
    // A et B partis en fille ; D éliminé au tableau arrêté ; C et E éliminés des poules
    const stage: TableauStageRecord = {
      kind: 'tableau',
      stopAt: 2,
      matches: [
        {
          id: 'm1',
          round: 4,
          position: 1,
          fencerA: f('A'),
          fencerB: f('D'),
          scoreA: 15,
          scoreB: 3,
          winner: f('A'),
          isBye: false,
          seedA: 1,
          seedB: 4,
        },
        {
          id: 'm2',
          round: 4,
          position: 2,
          fencerA: f('B'),
          fencerB: null,
          scoreA: null,
          scoreB: null,
          winner: f('B'),
          isBye: true,
          seedA: 2,
          seedB: null,
        },
      ],
      eliminated: [{ fencerId: 'D', round: 4, seed: 4 }],
    };
    const out = originFinalRanking(
      ranking,
      [stage],
      [{ label: 'Tableau A', competitionId: 'c-a', fencerIds: ['A', 'B'] }]
    );
    expect(out.ranking.map(r => [r.fencer.id, r.rank])).toEqual([
      ['D', 1],
      ['C', 2],
      ['E', 3],
    ]);
    expect(out.eliminatedAt.get('D')).toBe('Tableau de 4');
  });
});

describe('simulation de la scission (éditeur de formule)', () => {
  const branch = (label: string, take?: SplitPhase['branches'][number]['take']) =>
    ({ label, phases: [], ...(take ? { take } : {}) }) as SplitPhase['branches'][number];
  it('par rang : nombre, pourcentage, puis le reste', () => {
    const split = {
      kind: 'split',
      id: 's',
      criterion: 'rank',
      branches: [
        branch('A', { mode: 'fixed_count', count: 8 }),
        branch('B', { mode: 'percentage', percentage: 25 }),
        branch('C'),
      ],
    } as SplitPhase;
    expect(simulateSplit(split, 32)).toEqual([
      { label: 'A', fencers: 8 },
      { label: 'B', fencers: 8 },
      { label: 'C', fencers: 16 },
    ]);
    // Effectif plus petit que la première branche : la suite est vide
    expect(simulateSplit(split, 6).map(b => b.fencers)).toEqual([6, 0, 0]);
  });
  it('sexe, catégorie, manuelle : effectif inconnu avant l’épreuve', () => {
    const split = {
      kind: 'split',
      id: 's',
      criterion: 'category',
      branches: [branch('V1-V2'), branch('V3-V4')],
    } as SplitPhase;
    expect(simulateSplit(split, 20)).toEqual([
      { label: 'V1-V2', fencers: null },
      { label: 'V3-V4', fencers: null },
    ]);
  });
});
