// @vitest-environment jsdom
/**
 * Classement du tableau de l'écran (docs/adr/0040) : choix des ex aequo fait au passage au
 * tableau, puis coupe figée par le tableau tiré (classement, PDF, résultats).
 */
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { PoolRanking } from '../../../shared/types';
import type { TableauMatch } from '../../../shared/domain/tableau/tableauTypes';
import { setTableauTies } from '../tableauTiesChoice';
import { useScreenTableauRanking } from './useScreenTableauRanking';

const r = (id: string, rank: number, entry: number) =>
  ({ fencer: { id, ranking: entry, status: 'Q' }, rank }) as unknown as PoolRanking;
// a seul en tête ; b, c, d ex aequo à la 2e place pour 1 place (rang d'entrée : c, d, b)
const overall = [r('a', 1, 4), r('b', 2, 3), r('c', 2, 1), r('d', 2, 2)];
const options = {
  isRapieres: false,
  rapieresTableauMode: undefined,
  poolWinnersOnly: false,
  customFormula: undefined,
  tableauQualification: { mode: 'fixed_count' as const, count: 2 },
  postPoolSplitCriteria: undefined,
  activeSplitGroup: null,
  splitOffCompetitionIds: undefined,
};
const ids = (x: PoolRanking[]) => x.map(y => y.fencer.id);

describe('useScreenTableauRanking (ADR-0040)', () => {
  it('choix au passage au tableau appliqué, puis coupe figée par le tableau tiré', () => {
    setTableauTies('k', undefined);
    const { result, rerender } = renderHook(
      ({ matches }: { matches: TableauMatch[] }) =>
        useScreenTableauRanking({
          competitionId: 'k',
          overallRanking: overall,
          pools: [],
          tableauMatches: matches,
          options,
        }),
      { initialProps: { matches: [] as TableauMatch[] } }
    );
    // Formule : tous les ex aequo
    expect(ids(result.current)).toEqual(['a', 'b', 'c', 'd']);
    // Choix « initial_ranking » au passage au tableau
    act(() => setTableauTies('k', 'initial_ranking'));
    expect(ids(result.current)).toEqual(['a', 'c']);
    // Tableau tiré avec ce choix, puis choix perdu (rechargement) : coupe figée par le tableau
    const drawn = [{ fencerA: { id: 'a' }, fencerB: { id: 'c' } }] as unknown as TableauMatch[];
    act(() => setTableauTies('k', undefined));
    rerender({ matches: drawn });
    expect(ids(result.current)).toEqual(['a', 'c']);
  });
});
