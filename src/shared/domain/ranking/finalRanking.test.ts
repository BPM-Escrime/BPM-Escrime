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
