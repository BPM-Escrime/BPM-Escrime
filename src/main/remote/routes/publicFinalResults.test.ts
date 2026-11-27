/**
 * Page publique des résultats : classement final générique (docs/adr/0043 amendée, F4d), comme
 * l'écran, les exports et le moteur : le tableau, puis les non-qualifiés dans l'ordre des poules ;
 * un exclu au bas sans rang, les autres renumérotés.
 */
import { describe, it, expect } from 'vitest';
import { FencerStatus } from '../../../shared/types';
import { publicFinalResults } from './resultsRoutes';

const fe = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  lastName: id,
  firstName: id,
  club: 'C',
  status: FencerStatus.CHECKED_IN,
  ...extra,
});
const row = (id: string, rank: number, extra: Record<string, unknown> = {}) => ({
  fencer: fe(id, extra),
  rank,
});
const out = (list: Array<{ rank: number | null; fencer: { id: string } | null; group?: string }>) =>
  list.map(r => `${r.group ?? ''}${r.fencer?.id}:${r.rank}`);

describe('publicFinalResults', () => {
  const overall = [row('a', 1), row('b', 2), row('c', 3), row('d', 4), row('e', 5)];

  it('aucun résultat de tableau : pas de classement final', () => {
    expect(publicFinalResults({ overallRanking: overall } as never)).toEqual([]);
  });

  it('le tableau, puis les non-qualifiés dans l’ordre des poules', () => {
    const list = publicFinalResults({
      overallRanking: overall,
      finalResults: [row('c', 1), row('a', 2)],
    } as never);
    expect(out(list)).toEqual(['c:1', 'a:2', 'b:3', 'd:4', 'e:5']);
    // Tireur réduit : identité et club seulement
    expect(list[0].fencer).toEqual({ id: 'c', lastName: 'c', firstName: 'c', club: 'C' });
  });

  it('exclu, même après son entrée au tableau : au bas sans rang, les autres renumérotés', () => {
    const list = publicFinalResults({
      overallRanking: overall,
      finalResults: [row('c', 1), row('a', 2, { status: FencerStatus.EXCLUDED }), row('b', 3)],
    } as never);
    expect(out(list)).toEqual(['c:1', 'b:2', 'd:3', 'e:4', 'a:null']);
  });

  it('liste courante : le statut du tireur est rafraîchi', () => {
    const list = publicFinalResults(
      { overallRanking: overall, finalResults: [row('c', 1), row('a', 2)] } as never,
      [{ id: 'a', status: FencerStatus.EXCLUDED }]
    );
    expect(out(list)).toEqual(['c:1', 'b:2', 'd:3', 'e:4', 'a:null']);
  });

  it('tableaux des groupes : chaque groupe avec ses non-qualifiés', () => {
    const everyone = [
      row('f1', 1, { gender: 'F' }),
      row('m1', 2, { gender: 'M' }),
      row('f2', 3, { gender: 'F' }),
      row('m2', 4, { gender: 'M' }),
      row('f3', 5, { gender: 'F' }),
    ];
    const list = publicFinalResults({
      overallRanking: everyone,
      groupTableaux: {
        F: {
          tableauMatches: [],
          consolationBrackets: [],
          finalResults: [row('f2', 1), row('f1', 2)],
        },
        M: { tableauMatches: [], consolationBrackets: [], finalResults: [row('m1', 1)] },
      },
    } as never);
    expect(out(list)).toEqual(['Ff2:1', 'Ff1:2', 'Ff3:3', 'Mm1:1', 'Mm2:2']);
  });
});
