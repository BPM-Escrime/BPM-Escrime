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

  it('« initial_ranking » : rang d’entrée égal ou absent → ordre du classement, puis nom', () => {
    const named = (id: string, rank: number, entry: number | undefined, lastName: string) => ({
      rank,
      fencer: { id, ranking: entry, lastName, firstName: 'P' },
    });
    const r = [
      named('a', 1, 1, 'ZOLA'),
      named('b', 2, undefined, 'DURAND'),
      named('c', 2, 4, 'MARTIN'),
      named('d', 2, 4, 'BERNARD'),
      named('e', 2, undefined, 'ARNAUD'),
    ];
    // Rang d'entrée 4 : BERNARD avant MARTIN ; sans rang d'entrée : ARNAUD avant DURAND
    expect(ids(cutAtBar(r, 2, 'initial_ranking').qualified)).toEqual(['a', 'd']);
    expect(ids(cutAtBar(r, 4, 'initial_ranking').qualified)).toEqual(['a', 'd', 'c', 'e']);
  });

  it('rang d’entrée fourni par l’appelant (4e paramètre `entryRank`)', () => {
    const entry = new Map([
      ['b', 3],
      ['c', 1],
      ['d', 2],
      ['e', 4],
    ]);
    const cut = cutAtBar(ranking, 2, 'initial_ranking', r => entry.get(r.fencer.id));
    expect(ids(cut.qualified)).toEqual(['a', 'c']);
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

  it('« draw » (FIE o.73.2.f) : tirage au sort des ex aequo, hasard injecté, quota tenu', () => {
    // Hasard fixe : Fisher-Yates sur [b, c, d, e] avec j = 0 à chaque pas → [c, d, e, b]
    const cut = cutAtBar(ranking, 4, 'draw', undefined, () => 0);
    expect(ids(cut.qualified)).toEqual(['a', 'c', 'd', 'e']);
    expect(ids(cut.eliminated)).toEqual(['b', 'f']);
    expect(cut.tiedAtBar).toEqual({ rank: 2, fencerIds: ['b', 'c', 'd', 'e'], places: 3 });
    // Même hasard, même tirage (rejouable) ; hasard différent, autre tirage possible
    expect(ids(cutAtBar(ranking, 4, 'draw', undefined, () => 0).qualified)).toEqual(
      ids(cut.qualified)
    );
    expect(ids(cutAtBar(ranking, 4, 'draw', undefined, () => 0.99).qualified)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('« draw » sans hasard (affichage avant la coupe) : tous les ex aequo restent', () => {
    expect(ids(cutAtBar(ranking, 4, 'draw').qualified)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
