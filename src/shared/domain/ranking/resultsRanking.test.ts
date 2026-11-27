/**
 * Tests : classement des poules du classement final de l'écran (docs/adr/0043 amendée, F4d) :
 * le classement complet, pas la coupe du tableau ; groupe affiché, épreuve scindée, tableau arrêté
 * Licensed under GPL-3.0
 */
import { describe, it, expect } from 'vitest';
import { FencerStatus, Gender } from '../../types';
import type { Fencer, PoolRanking } from '../../types';
import type { TableauStageRecord } from '../tableau/tableauStage';
import { finalRanking } from './finalRanking';
import { resultsRanking } from './resultsRanking';

const f = (id: string, gender = Gender.MALE, status = FencerStatus.CHECKED_IN): Fencer =>
  ({ id, lastName: id, firstName: '', gender, status }) as Fencer;
const ranking = (...fencers: Fencer[]): PoolRanking[] =>
  fencers.map((x, i) => ({ fencer: x, rank: i + 1 }) as PoolRanking);
const input = (overallRanking: PoolRanking[], extra = {}) => ({
  overallRanking,
  activeSplitGroup: null,
  stageHistory: [],
  splitHistory: [],
  ...extra,
});
const ids = (rows: { fencer: Fencer; rank: number | null }[]) =>
  rows.map(r => `${r.fencer.id}:${r.rank}`);

describe('resultsRanking', () => {
  const [a, b, c, d, e] = ['a', 'b', 'c', 'd', 'e'].map(id => f(id));

  it('classement complet : le tableau, puis les non-qualifiés dans l’ordre des poules', () => {
    const { ranking: poolRanking } = resultsRanking(input(ranking(a, b, c, d, e)));
    expect(poolRanking).toHaveLength(5);
    const rows = finalRanking({
      // Tableau de 2 : c et a ; b, d, e non qualifiés
      finalResults: [
        { rank: 1, fencer: c, eliminatedAt: 'Vainqueur' },
        { rank: 2, fencer: a, eliminatedAt: 'Finale' },
      ],
      poolRanking,
    });
    expect(ids(rows)).toEqual(['c:1', 'a:2', 'b:3', 'd:4', 'e:5']);
  });

  it('un exclu du tableau : au bas sans rang, les autres renumérotés', () => {
    const out = f('a', Gender.MALE, FencerStatus.EXCLUDED);
    const { ranking: poolRanking } = resultsRanking(input(ranking(out, b, c, d)));
    const rows = finalRanking({
      finalResults: [
        { rank: 1, fencer: c, eliminatedAt: 'Vainqueur' },
        { rank: 2, fencer: out, eliminatedAt: 'Finale' },
      ],
      poolRanking,
    });
    expect(ids(rows)).toEqual(['c:1', 'b:2', 'd:3', 'a:null']);
  });

  it('tableaux séparés : le groupe affiché et ses non-qualifiés seulement', () => {
    const m1 = f('m1');
    const m2 = f('m2');
    const w1 = f('w1', Gender.FEMALE);
    const w2 = f('w2', Gender.FEMALE);
    const all = ranking(m1, w1, m2, w2);
    const women = resultsRanking(
      input(all, { postPoolSplitCriteria: 'gender', activeSplitGroup: Gender.FEMALE })
    ).ranking;
    expect(ids(women)).toEqual(['w1:1', 'w2:2']);
    // Sans groupe affiché : les groupes extraits sont écartés
    const rest = resultsRanking(
      input(all, { postPoolSplitCriteria: 'gender', splitOffCompetitionIds: { F: 'x' } })
    ).ranking;
    expect(ids(rest)).toEqual(['m1:1', 'm2:2']);
    // Sans critère de séparation : classement inchangé
    expect(resultsRanking(input(all)).ranking).toHaveLength(4);
  });

  it('épreuve scindée : sans les tireurs partis dans une branche', () => {
    const { ranking: poolRanking } = resultsRanking(
      input(ranking(a, b, c, d), {
        splitHistory: [{ label: 'B', competitionId: 'fb', fencerIds: ['b', 'd'] }],
      })
    );
    expect(ids(poolRanking)).toEqual(['a:1', 'c:2']);
  });

  it('tableau arrêté : restants, éliminés du tableau « Tableau de N », puis les autres', () => {
    const stage: TableauStageRecord = {
      kind: 'tableau',
      stopAt: 2,
      matches: [
        {
          id: 'm1',
          round: 4,
          position: 0,
          fencerA: a,
          fencerB: d,
          scoreA: 15,
          scoreB: 7,
          winner: a,
          isBye: false,
          seedA: 1,
          seedB: 4,
        },
        {
          id: 'm2',
          round: 4,
          position: 1,
          fencerA: b,
          fencerB: c,
          scoreA: 15,
          scoreB: 7,
          winner: b,
          isBye: false,
          seedA: 2,
          seedB: 3,
        },
      ],
      eliminated: [
        { fencerId: 'c', round: 4, seed: 3 },
        { fencerId: 'd', round: 4, seed: 4 },
      ],
    };
    const out = resultsRanking(input(ranking(b, a, d, c, e), { stageHistory: [stage] }));
    expect(ids(out.ranking)).toEqual(['b:1', 'a:2', 'c:3', 'd:4', 'e:5']);
    expect(out.eliminatedAt.get('c')).toBe('Tableau de 4');
    // Sans tableau joué, le classement final suit ce classement et ses libellés
    const rows = finalRanking({
      finalResults: [],
      poolRanking: out.ranking,
      stageEliminatedAt: out.eliminatedAt,
    });
    expect(rows.map(r => r.eliminatedAt)).toEqual([
      'Poules',
      'Poules',
      'Tableau de 4',
      'Tableau de 4',
      'Poules',
    ]);
  });
});
