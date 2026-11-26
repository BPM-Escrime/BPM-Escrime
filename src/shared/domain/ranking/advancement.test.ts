import { describe, expect, it } from 'vitest';
import { cutAtBar, getAdvancementCount } from './advancement';

/** Classement : rang du tour et rang d'entrée (`fencer.ranking`) */
const rows = (spec: Array<[string, number, number?]>) =>
  spec.map(([id, rank, entry]) => ({ rank, fencer: { id, ranking: entry } }));
const ids = (r: Array<{ fencer: { id: string } }>) => r.map(x => x.fencer.id);

describe('cutAtBar : ex aequo à la barre (docs/adr/0040)', () => {
  // 4 qualifiés ; b, c, d, e ex aequo à la 2e place
  const ranking = rows([
    ['a', 1, 5],
    ['b', 2, 9],
    ['c', 2, 2],
    ['d', 2, 7],
    ['e', 2, 3],
    ['f', 6, 1],
  ]);

  it('sans ex aequo à la barre : quota tenu, rien à signaler', () => {
    const cut = cutAtBar(ranking, 1, 'initial_ranking');
    expect(ids(cut.qualified)).toEqual(['a']);
    expect(cut.tiedAtBar).toBeNull();
  });

  it('« all » (défaut, réglage absent) : tous les ex aequo passent, quota dépassé', () => {
    const cut = cutAtBar(ranking, 4);
    expect(ids(cut.qualified)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(ids(cut.eliminated)).toEqual(['f']);
    expect(cut.tiedAtBar).toEqual({ rank: 2, fencerIds: ['b', 'c', 'd', 'e'], places: 3 });
    expect(ids(cutAtBar(ranking, 4, 'all').qualified)).toEqual(ids(cut.qualified));
  });

  it('« initial_ranking » : départagés par le rang d’entrée, quota tenu', () => {
    const cut = cutAtBar(ranking, 4, 'initial_ranking');
    expect(ids(cut.qualified)).toEqual(['a', 'c', 'e', 'd']);
    expect(ids(cut.eliminated)).toEqual(['b', 'f']);
    expect(cut.tiedAtBar).toEqual({ rank: 2, fencerIds: ['b', 'c', 'd', 'e'], places: 3 });
  });

  it('« initial_ranking » : rang d’entrée égal ou absent → ordre du classement', () => {
    const r = rows([
      ['a', 1, 1],
      ['b', 2],
      ['c', 2, 4],
      ['d', 2, 4],
      ['e', 2],
    ]);
    expect(ids(cutAtBar(r, 3, 'initial_ranking').qualified)).toEqual(['a', 'c', 'd']);
    expect(ids(cutAtBar(r, 4, 'initial_ranking').qualified)).toEqual(['a', 'c', 'd', 'b']);
  });

  it('quota absent ou ≥ effectif : tout le monde passe', () => {
    expect(ids(cutAtBar(ranking, undefined, 'initial_ranking').qualified)).toHaveLength(6);
    expect(cutAtBar(ranking, 6, 'initial_ranking').tiedAtBar).toBeNull();
  });

  it('nombre de qualifiés : règle inchangée', () => {
    expect(
      getAdvancementCount(10, { mode: 'fixed_count', count: 4, ties: 'initial_ranking' })
    ).toBe(4);
  });
});
