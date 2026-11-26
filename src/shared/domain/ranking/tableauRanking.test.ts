import { describe, expect, it } from 'vitest';
import { MatchStatus } from '../../types';
import type { Pool, PoolRanking } from '../../types';
import type { TableauMatch } from '../tableau/tableauTypes';
import {
  computeEffectiveTableauRanking,
  computeMatchProgress,
  rankingOfDrawnTableau,
  tableauCut,
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
