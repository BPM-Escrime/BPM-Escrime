import { describe, expect, it } from 'vitest';
import { MatchStatus } from '../../types';
import type { Pool, PoolRanking } from '../../types';
import type { TableauMatch } from '../tableau/tableauTypes';
import {
  computeEffectiveTableauRanking,
  computeMatchProgress,
  rankingOfDrawnTableau,
  tableauCut,
  tableauRankingOfScreen,
} from './tableauRanking';

const pool = (statuses: MatchStatus[]): Pool =>
  ({
    id: 'p',
    number: 1,
    fencers: [],
    matches: statuses.map((status, i) => ({ id: `m${i}`, status })),
  }) as unknown as Pool;

const rank = (id: string, gender: string, r: number): PoolRanking =>
  ({ fencer: { id, gender }, rank: r }) as unknown as PoolRanking;

const baseOptions = {
  isRapieres: false,
  rapieresTableauMode: undefined,
  poolWinnersOnly: false,
  customFormula: undefined,
  postPoolSplitCriteria: undefined,
  activeSplitGroup: null,
  splitOffCompetitionIds: undefined,
};

describe('computeMatchProgress', () => {
  it('renvoie null sans poule ni tableau', () => {
    expect(computeMatchProgress([], [])).toBeNull();
  });

  it('compte les matchs de poule terminés', () => {
    const pools = [pool([MatchStatus.FINISHED, MatchStatus.NOT_STARTED])];
    expect(computeMatchProgress(pools, [])).toEqual({ done: 1, total: 2, label: 'poules' });
  });

  it('retombe sur le tableau quand il n’y a pas de poule', () => {
    const matches = [
      { id: 'a', fencerA: {}, fencerB: {}, winner: {} },
      { id: 'b', fencerA: {}, fencerB: {}, winner: null },
      { id: 'c', fencerA: {}, fencerB: null, winner: null },
    ] as unknown as TableauMatch[];
    expect(computeMatchProgress([], matches)).toEqual({ done: 1, total: 2, label: 'tableau' });
  });

  it('tableau terminé avec un exempt : pas plus de matchs faits que de matchs à jouer (15/14)', () => {
    const matches = [
      { id: 'bye', fencerA: {}, fencerB: null, winner: {} },
      { id: 'a', fencerA: {}, fencerB: {}, winner: {} },
      { id: 'b', fencerA: {}, fencerB: {}, winner: {} },
    ] as unknown as TableauMatch[];
    expect(computeMatchProgress([], matches)).toEqual({ done: 2, total: 2, label: 'tableau' });
  });

  it('compte les tours suivants dont les tireurs ne sont pas encore connus (#1817)', () => {
    const matches = [
      { id: 'q1', round: 4, fencerA: {}, fencerB: {}, winner: {} },
      { id: 'q2', round: 4, fencerA: {}, fencerB: {}, winner: null },
      { id: 'f', round: 2, fencerA: {}, fencerB: null, winner: null },
    ] as unknown as TableauMatch[];
    expect(computeMatchProgress([], matches)).toEqual({ done: 1, total: 3, label: 'tableau' });
  });
});

describe('computeEffectiveTableauRanking', () => {
  const ranking = [rank('a', 'M', 1), rank('b', 'F', 2), rank('c', 'M', 3)];

  it('garde le classement tel quel sans option', () => {
    expect(computeEffectiveTableauRanking(ranking, [], baseOptions)).toBe(ranking);
  });

  it('ne garde que le groupe actif et renumérote', () => {
    const result = computeEffectiveTableauRanking(ranking, [], {
      ...baseOptions,
      postPoolSplitCriteria: 'gender',
      activeSplitGroup: 'M',
    });
    expect(result.map(r => [r.fencer.id, r.rank])).toEqual([
      ['a', 1],
      ['c', 2],
    ]);
  });

  it('exclut les groupes déjà extraits dans une compétition séparée', () => {
    const result = computeEffectiveTableauRanking(ranking, [], {
      ...baseOptions,
      postPoolSplitCriteria: 'gender',
      splitOffCompetitionIds: { F: 'comp-f' },
    });
    expect(result.map(r => r.fencer.id)).toEqual(['a', 'c']);
  });

  it('formule v2 (épée) : % de qualifiés vers le tableau, égalité à la coupe gardée (#2013 R1)', () => {
    const five = [1, 2, 3, 3, 5].map((r, i) => rank(`f${i}`, 'M', r));
    const result = computeEffectiveTableauRanking(five, [], {
      ...baseOptions,
      tableauQualification: { mode: 'percentage', percentage: 60 },
    });
    expect(result.map(r => r.fencer.id)).toEqual(['f0', 'f1', 'f2', 'f3']);
  });
});

describe('tableauCut : ex aequo à la barre du tableau (docs/adr/0040)', () => {
  // Après deux tours : rang d'entrée = place au tour précédent (fencer.ranking)
  const tied = (id: string, entry: number): PoolRanking =>
    ({ fencer: { id, ranking: entry, status: 'Q' }, rank: 2 }) as unknown as PoolRanking;
  const ranking = [
    { fencer: { id: 'a', ranking: 3, status: 'Q' }, rank: 1 } as unknown as PoolRanking,
    tied('b', 4),
    tied('c', 2),
    tied('d', 1),
  ];
  const rule = { mode: 'fixed_count' as const, count: 2 };

  it('réglage de la formule par défaut : tous les ex aequo ; simulation des ex aequo', () => {
    const cut = tableauCut(ranking, [], { ...baseOptions, tableauQualification: rule });
    expect(cut.ranking.map(r => r.fencer.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(cut.tiedAtBar).toEqual({ rank: 2, fencerIds: ['b', 'c', 'd'], places: 1 });
  });

  it('« ties » de l’écran ou de la commande : prime sur la formule', () => {
    const ids = (ties?: 'all' | 'initial_ranking') =>
      computeEffectiveTableauRanking(ranking, [], {
        ...baseOptions,
        tableauQualification: { ...rule, ties: 'all' },
        ties,
      }).map(r => r.fencer.id);
    expect(ids('initial_ranking')).toEqual(['a', 'd']);
    expect(ids()).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('rankingOfDrawnTableau : coupe figée par le tableau tiré (docs/adr/0040)', () => {
  const r = (id: string, rank: number) =>
    ({ fencer: { id, status: 'Q' }, rank }) as unknown as PoolRanking;
  const all = [r('a', 1), r('b', 2), r('c', 2), r('d', 2), r('x', 5)];
  const tiedAtBar = { rank: 2, fencerIds: ['b', 'c', 'd'], places: 1 };
  const match = (a: string, b: string) =>
    ({ fencerA: { id: a }, fencerB: { id: b } }) as unknown as TableauMatch;

  it('ex aequo absents du tableau retirés ; les autres tireurs gardés', () => {
    const out = rankingOfDrawnTableau({ ranking: all, tiedAtBar }, [match('a', 'd')]);
    expect(out.map(x => x.fencer.id)).toEqual(['a', 'd', 'x']);
  });

  it('sans ex aequo à la barre ou sans tableau : classement inchangé', () => {
    expect(rankingOfDrawnTableau({ ranking: all, tiedAtBar: null }, [match('a', 'd')])).toBe(all);
    expect(rankingOfDrawnTableau({ ranking: all, tiedAtBar }, [])).toBe(all);
  });
});

describe('tableauRankingOfScreen : classement, PDF et résultats de l’écran (docs/adr/0040)', () => {
  const r = (id: string, rank: number, entry: number) =>
    ({ fencer: { id, ranking: entry, status: 'Q' }, rank }) as unknown as PoolRanking;
  const overall = [r('a', 1, 4), r('b', 2, 3), r('c', 2, 1), r('d', 2, 2)];
  const options = {
    ...baseOptions,
    tableauQualification: { mode: 'fixed_count' as const, count: 2 },
  };
  const ids = (x: PoolRanking[]) => x.map(y => y.fencer.id);

  it('avant le tirage : choix de l’écran, sinon la formule', () => {
    expect(ids(tableauRankingOfScreen(overall, [], options, []))).toEqual(['a', 'b', 'c', 'd']);
    expect(
      ids(tableauRankingOfScreen(overall, [], { ...options, ties: 'initial_ranking' }, []))
    ).toEqual(['a', 'c']);
  });

  it('tableau tiré : coupe figée par le tableau, même si le choix est perdu (rechargement)', () => {
    const drawn = [{ fencerA: { id: 'a' }, fencerB: { id: 'c' } }] as unknown as TableauMatch[];
    // Choix oublié (formule « all ») : le tableau tiré garde a et c
    expect(ids(tableauRankingOfScreen(overall, [], options, drawn))).toEqual(['a', 'c']);
  });
});

describe('tableauCut : têtes de poule (pool_heads, docs/adr/0043, F4b)', () => {
  const t = (id: string): PoolRanking['fencer'] => ({ id, lastName: id }) as PoolRanking['fencer'];
  const poolOf = (n: number, list: string[]): Pool =>
    ({
      number: n,
      fencers: list.map(t),
      matches: [],
      ranking: list.map((id, i) => ({ fencer: t(id), rank: i + 1 })),
    }) as unknown as Pool;
  const overall = (list: string[]): PoolRanking[] =>
    list.map((id, i) => ({ fencer: t(id), rank: i + 1 })) as unknown as PoolRanking[];
  const pools = [poolOf(1, ['a1', 'a2', 'a3']), poolOf(2, ['b1', 'b2', 'b3'])];
  const general = overall(['a1', 'b1', 'a2', 'b2', 'a3', 'b3']);
  const heads = { mode: 'pool_heads' as const, count: 4 };
  const ids = (x: PoolRanking[]) => x.map(y => y.fencer.id);

  it('épreuve non rapières : règle de la formule v2, 4 qualifiés croisés', () => {
    const cut = tableauCut(general, pools, { ...baseOptions, tableauQualification: heads });
    expect(ids(cut.ranking)).toEqual(['a1', 'b1', 'a2', 'b2']);
    expect(cut.tiedAtBar).toBeNull();
  });

  it('épreuve du mode spécial : la formule « têtes de poule » donne les demi-finales', () => {
    const cut = tableauCut(general, pools, {
      ...baseOptions,
      legacyRapieres: { mode: undefined },
      tableauQualification: heads,
    });
    expect(ids(cut.ranking)).toEqual(['a1', 'b1', 'a2', 'b2']);
  });

  it('épreuve du mode spécial : sans « têtes de poule », mode hérité « semis » (valeur par défaut) ou toutes les équipes', () => {
    const rapieres = { ...baseOptions, legacyRapieres: { mode: undefined } };
    expect(
      ids(tableauCut(general, pools, { ...rapieres, legacyRapieres: { mode: 'semis' } }).ranking)
    ).toEqual(['a1', 'b1', 'a2', 'b2']);
    expect(ids(tableauCut(general, pools, rapieres).ranking)).toHaveLength(6);
  });

  it('épreuve du mode spécial : la formule prime sur le mode hérité', () => {
    const cut = tableauCut(general, pools, {
      ...baseOptions,
      legacyRapieres: { mode: 'normal' as const },
      tableauQualification: { mode: 'pool_heads', count: 2 },
    });
    expect(ids(cut.ranking)).toEqual(['a1', 'b1']);
  });

  it('ex aequo à la barre : proposés, choix de l’écran appliqué', () => {
    const tied = [poolOf(1, ['a1', 'a2']), poolOf(2, ['b1', 'b2']), poolOf(3, ['c1', 'c2'])];
    const rows = (['a1', 'b1', 'c1', 'a2', 'b2', 'c2'] as const).map((id, i) => ({
      fencer: { id, lastName: id, ranking: id === 'a2' ? 9 : 1 },
      rank: [1, 2, 3, 4, 4, 6][i],
    })) as unknown as PoolRanking[];
    const options = { ...baseOptions, tableauQualification: heads };
    const all = tableauCut(rows, tied, options);
    expect(all.tiedAtBar).toEqual({ rank: 4, fencerIds: ['a2', 'b2'], places: 1 });
    expect(ids(all.ranking)).toHaveLength(5);
    const kept = tableauCut(rows, tied, { ...options, ties: 'initial_ranking' });
    expect(ids(kept.ranking)).toEqual(['a1', 'b1', 'c1', 'b2']);
  });
});
