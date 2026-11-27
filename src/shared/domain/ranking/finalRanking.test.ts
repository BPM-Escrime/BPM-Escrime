/**
 * Tests : classement final de l'épreuve (règle de l'écran des résultats, docs/adr/0043, F4d)
 * Licensed under GPL-3.0
 */
import { describe, it, expect } from 'vitest';
import { FencerStatus } from '../../types';
import type { Fencer, PoolRanking } from '../../types';
import { finalRanking } from './finalRanking';

const f = (id: string, status = FencerStatus.CHECKED_IN, exclusionReason?: string): Fencer =>
  ({ id, lastName: id, firstName: '', status, exclusionReason }) as unknown as Fencer;
const pr = (fencer: Fencer, rank: number): PoolRanking => ({ fencer, rank }) as PoolRanking;
const out = (rows: ReturnType<typeof finalRanking>) =>
  rows.map(r => `${r.fencer.id}:${r.rank}:${r.eliminatedAt ?? ''}`);
const out_ = (rows: ReturnType<typeof finalRanking>) => rows.map(r => `${r.fencer.id}:${r.rank}`);

describe('finalRanking', () => {
  const [a, b, c, d, e] = ['a', 'b', 'c', 'd', 'e'].map(id => f(id));

  it('sans tableau : classement des poules, rangs 1…n, « Poules »', () => {
    expect(out(finalRanking({ finalResults: [], poolRanking: [pr(a, 1), pr(b, 2)] }))).toEqual([
      'a:1:Poules',
      'b:2:Poules',
    ]);
  });

  it('tableau puis éliminés des poules dans l’ordre des poules', () => {
    const rows = finalRanking({
      finalResults: [
        { rank: 1, fencer: b, eliminatedAt: 'Vainqueur' },
        { rank: 2, fencer: a, eliminatedAt: 'Finale' },
      ],
      poolRanking: [pr(a, 1), pr(b, 2), pr(c, 3), pr(d, 4)],
    });
    expect(out(rows)).toEqual(['b:1:Vainqueur', 'a:2:Finale', 'c:3:Poules', 'd:4:Poules']);
  });

  it('3es ex aequo : les éliminés des poules suivent le nombre de lignes du tableau', () => {
    const rows = finalRanking({
      finalResults: [
        { rank: 1, fencer: a, eliminatedAt: 'Vainqueur' },
        { rank: 2, fencer: b, eliminatedAt: 'Finale' },
        { rank: 3, fencer: c, eliminatedAt: 'Demi-finales' },
        { rank: 3, fencer: d, eliminatedAt: 'Demi-finales' },
      ],
      poolRanking: [pr(a, 1), pr(b, 2), pr(c, 3), pr(d, 4), pr(e, 5)],
    });
    expect(out(rows).slice(-1)).toEqual(['e:5:Poules']);
  });

  it('tableau arrêté : rangs du classement final, ex aequo compris, « Tableau de N »', () => {
    const rows = finalRanking({
      finalResults: [],
      poolRanking: [pr(a, 1), pr(b, 2), pr(c, 2)],
      stageEliminatedAt: new Map([['c', 'Tableau de 8']]),
    });
    expect(out(rows)).toEqual(['a:1:Poules', 'b:2:Poules', 'c:2:Tableau de 8']);
  });

  it('carton noir : rang perdu, en dernier, les suivants remontent', () => {
    const black = f('a', FencerStatus.EXCLUDED, 'black_card');
    const rows = finalRanking({
      finalResults: [
        { rank: 1, fencer: black, eliminatedAt: 'Vainqueur' },
        { rank: 2, fencer: b, eliminatedAt: 'Finale' },
      ],
      poolRanking: [pr(black, 1), pr(b, 2), pr(c, 3)],
    });
    expect(out(rows)).toEqual(['b:1:Finale', 'c:2:Poules', 'a:null:Vainqueur']);
  });

  it('égalités du tableau gardées sans exclu : 3es ex aequo, puis 5e', () => {
    const rows = finalRanking({
      finalResults: [
        { rank: 1, fencer: a, eliminatedAt: 'Vainqueur' },
        { rank: 2, fencer: b, eliminatedAt: 'Finale' },
        { rank: 3, fencer: c, eliminatedAt: 'Demi-finales' },
        { rank: 3, fencer: d, eliminatedAt: 'Demi-finales' },
      ],
      poolRanking: [pr(a, 1), pr(b, 2), pr(c, 3), pr(d, 3), pr(e, 5)],
    });
    expect(out_(rows)).toEqual(['a:1', 'b:2', 'c:3', 'd:3', 'e:5']);
  });

  it('rang des poules gardé, égalités comprises (XML fédéral) ; l’exclu reste au bas sans rang', () => {
    const x = f('c', FencerStatus.EXCLUDED);
    const tied = [pr(a, 1), pr(b, 2), pr(x, 2), pr(d, 4)];
    expect(out_(finalRanking({ finalResults: [], poolRanking: tied, poolRanks: 'pool' }))).toEqual([
      'a:1',
      'b:2',
      'd:3',
      'c:null',
    ]);
    const noExclusion = [pr(a, 1), pr(b, 2), pr(c, 2), pr(d, 4)];
    expect(
      out_(finalRanking({ finalResults: [], poolRanking: noExclusion, poolRanks: 'pool' }))
    ).toEqual(['a:1', 'b:2', 'c:2', 'd:4']);
    expect(
      out_(
        finalRanking({
          finalResults: [{ rank: 1, fencer: a }],
          poolRanking: noExclusion,
          poolRanks: 'pool',
        })
      )
    ).toEqual(['a:1', 'b:2', 'c:2', 'd:4']);
  });

  it('exclu, même après son entrée au tableau : au bas sans rang, les autres renumérotés (FIE o.74)', () => {
    const out = f('b', FencerStatus.EXCLUDED);
    const rows = finalRanking({
      finalResults: [
        { rank: 1, fencer: a, eliminatedAt: 'Vainqueur' },
        { rank: 2, fencer: out, eliminatedAt: 'Finale' },
        { rank: 3, fencer: c, eliminatedAt: 'Demi-finales' },
      ],
      poolRanking: [pr(a, 1), pr(out, 2), pr(c, 3), pr(d, 4), pr(e, 5)],
    });
    expect(out_(rows)).toEqual(['a:1', 'c:2', 'd:3', 'e:4', 'b:null']);
  });

  it('exclu parmi les non-qualifiés (motif autre que le carton noir) : au bas sans rang', () => {
    const x = f('d', FencerStatus.EXCLUDED, 'other');
    const rows = finalRanking({
      finalResults: [{ rank: 1, fencer: a, eliminatedAt: 'Vainqueur' }],
      poolRanking: [pr(a, 1), pr(b, 2), pr(x, 3), pr(c, 4)],
    });
    expect(out_(rows)).toEqual(['a:1', 'b:2', 'c:3', 'd:null']);
  });

  it('statut rafraîchi : le tireur figé est remplacé, le rang reste', () => {
    const rows = finalRanking({
      finalResults: [{ rank: 1, fencer: a }],
      poolRanking: [pr(a, 1), pr(b, 2)],
      refresh: x => ({ ...x, status: FencerStatus.FORFAIT }),
    });
    expect(rows.map(r => r.fencer.status)).toEqual([FencerStatus.FORFAIT, FencerStatus.FORFAIT]);
    expect(rows[1].eliminatedAt).toBe('Poules (forfait)');
  });
});
