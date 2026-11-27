/**
 * Tests : filtres du classement (docs/adr/0043, F4d) : critères, renumération depuis 1, ex aequo
 * Licensed under GPL-3.0
 */
import { describe, it, expect } from 'vitest';
import { Category, Gender } from '../../types';
import {
  filterRanking,
  isRankingFilterEmpty,
  matchesRankingFilter,
  normalizeRankingFilterKeys,
  rankingFilterKeysIssue,
  rankingFilterValues,
  restrictRankingFilter,
  subjectOfFencer,
  type RankingSubject,
} from './rankingFilters';

interface Row {
  id: string;
  rank: number | null;
}

const subjects: Record<string, RankingSubject | undefined> = {
  a: { category: Category.SENIOR, gender: Gender.MALE, level: 3, handicap: false },
  b: { category: Category.V1, gender: Gender.FEMALE, level: 2, handicap: true },
  c: { category: Category.SENIOR, gender: Gender.FEMALE, level: 3, handicap: true },
  d: { category: Category.U20, gender: Gender.MIXED, level: 1, handicap: false },
  e: undefined,
};
const subjectOf = (r: Row) => subjects[r.id];
const rows = (...ranks: Array<[string, number | null]>): Row[] =>
  ranks.map(([id, rank]) => ({ id, rank }));
const out = (list: Row[]) => list.map(r => `${r.id}:${r.rank}`);

describe('filterRanking : renumération depuis 1, ex aequo gardés', () => {
  const all = rows(['a', 1], ['b', 2], ['c', 3], ['d', 4], ['e', 5]);

  it('sans critère : classement rendu tel quel, y compris sans valeur connue', () => {
    expect(out(filterRanking(all, subjectOf, {}))).toEqual(out(all));
    expect(isRankingFilterEmpty({})).toBe(true);
    expect(isRankingFilterEmpty({ handicap: false })).toBe(true);
  });

  it('un critère : seuls les classés qui le passent, rangs depuis 1', () => {
    expect(out(filterRanking(all, subjectOf, { category: Category.SENIOR }))).toEqual([
      'a:1',
      'c:2',
    ]);
    expect(out(filterRanking(all, subjectOf, { gender: Gender.FEMALE }))).toEqual(['b:1', 'c:2']);
    expect(out(filterRanking(all, subjectOf, { level: 3 }))).toEqual(['a:1', 'c:2']);
    expect(out(filterRanking(all, subjectOf, { handicap: true }))).toEqual(['b:1', 'c:2']);
  });

  it('critères cumulables', () => {
    expect(
      out(filterRanking(all, subjectOf, { gender: Gender.FEMALE, handicap: true, level: 3 }))
    ).toEqual(['c:1']);
    expect(out(filterRanking(all, subjectOf, { category: Category.V1, level: 3 }))).toEqual([]);
  });

  it('un classé sans valeur connue ne passe aucun critère retenu', () => {
    expect(matchesRankingFilter(undefined, { level: 3 })).toBe(false);
    expect(matchesRankingFilter({ level: undefined }, { level: 3 })).toBe(false);
    expect(matchesRankingFilter(undefined, {})).toBe(true);
  });

  it('ex aequo conservés et renumérotés : 1, 1, 3', () => {
    const tied = rows(['d', 1], ['a', 2], ['c', 2], ['b', 4]);
    // Seniors seuls : a et c, ex aequo au 2e rang d'origine, deviennent 1er ex aequo
    expect(out(filterRanking(tied, subjectOf, { category: Category.SENIOR }))).toEqual([
      'a:1',
      'c:1',
    ]);
    // Femmes : c et b, rangs d'origine 2 et 4
    expect(out(filterRanking(tied, subjectOf, { gender: Gender.FEMALE }))).toEqual(['c:1', 'b:2']);
    // Rang suivant un groupe d'ex aequo : saute comme au classement d'origine (1, 1, 3)
    const three = rows(['a', 1], ['c', 1], ['b', 3]);
    expect(out(filterRanking(three, subjectOf, { level: 3 }))).toEqual(['a:1', 'c:1']);
    expect(out(filterRanking(three, subjectOf, { handicap: true }))).toEqual(['c:1', 'b:2']);
    expect(out(filterRanking(three, subjectOf, { level: 3, handicap: true }))).toEqual(['c:1']);
  });

  it('ex aequo conservés : le suivant d’un groupe garde le rang de sa position', () => {
    const tied = rows(['a', 1], ['b', 2], ['c', 2], ['d', 4]);
    // Tous sauf b : a:1, c:2, d:3
    const noB = (r: Row) => (r.id === 'b' ? { level: 9 } : subjects[r.id]);
    expect(out(filterRanking(tied, noB, { level: 3 }))).toEqual(['a:1', 'c:2']);
    // Sans b ni a : c:1, d:2
    const noAB = (r: Row) => (r.id === 'a' || r.id === 'b' ? { level: 9 } : { level: 3 });
    expect(out(filterRanking(tied, noAB, { level: 3 }))).toEqual(['c:1', 'd:2']);
    // Groupe d'ex aequo entier gardé : b et c restent ex aequo, d prend le 3e rang
    const keepBCD = (r: Row) => ({ level: r.id === 'a' ? 9 : 3 });
    expect(out(filterRanking(tied, keepBCD, { level: 3 }))).toEqual(['b:1', 'c:1', 'd:3']);
  });

  it('lignes sans rang (carton noir) : gardées sans rang, derrière les classés', () => {
    const withBlack = rows(['a', 1], ['b', 2], ['c', null]);
    expect(out(filterRanking(withBlack, subjectOf, { handicap: true }))).toEqual(['b:1', 'c:null']);
  });

  it('ne modifie pas le classement d’origine', () => {
    const before = JSON.stringify(all);
    filterRanking(all, subjectOf, { category: Category.SENIOR });
    expect(JSON.stringify(all)).toBe(before);
  });
});

describe('critères de la formule', () => {
  it('liste valide : critères connus et distincts', () => {
    expect(rankingFilterKeysIssue(['category', 'handicap'])).toBeNull();
    expect(rankingFilterKeysIssue([])).toBeNull();
    expect(rankingFilterKeysIssue('category')).toMatch(/liste/);
    expect(rankingFilterKeysIssue(['club'])).toMatch(/inconnu/);
    expect(rankingFilterKeysIssue(['level', 'level'])).toMatch(/distincts/);
  });

  it('normalisation : ordre canonique, sans inconnu ni doublon', () => {
    expect(normalizeRankingFilterKeys(['handicap', 'category', 'x', 'category'])).toEqual([
      'category',
      'handicap',
    ]);
    expect(normalizeRankingFilterKeys(undefined)).toEqual([]);
  });

  it('un filtre posé hors des critères proposés est ignoré', () => {
    expect(
      restrictRankingFilter({ category: 'V1', gender: 'F', level: 2, handicap: true }, [
        'gender',
        'handicap',
      ])
    ).toEqual({ gender: 'F', handicap: true });
    expect(restrictRankingFilter({ category: 'V1' }, [])).toEqual({});
  });

  it('valeurs proposées : catégories dans l’ordre des âges, sexes M F X, niveaux croissants', () => {
    const list = Object.values(subjects);
    expect(rankingFilterValues(list, 'category')).toEqual([
      Category.U20,
      Category.SENIOR,
      Category.V1,
    ]);
    expect(rankingFilterValues(list, 'gender')).toEqual([Gender.MALE, Gender.FEMALE, Gender.MIXED]);
    expect(rankingFilterValues(list, 'level')).toEqual([1, 2, 3]);
  });

  it('valeurs d’un tireur', () => {
    expect(
      subjectOfFencer({ category: Category.V2, gender: Gender.FEMALE, level: 2, handicap: true })
    ).toEqual({ category: 'V2', gender: 'F', level: 2, handicap: true });
    expect(subjectOfFencer({ gender: Gender.MALE })).toEqual({ gender: 'M', handicap: false });
  });
});
