/**
 * BPM - Escrime - Classements dérivés filtrés (docs/adr/0043, F4d)
 * Réglage général de la formule `rankingFilters` : catégorie, sexe, niveau, HANDI du tireur
 * (ou de l'équipe). Un classement filtré est un affichage : il renumérote depuis 1, ex aequo
 * gardés ; pas de compétition fille (ADR-0039), pas de publication distincte. Domaine pur.
 * Licensed under GPL-3.0
 */
import { Category, Gender, type Fencer } from '../../types';

export const RANKING_FILTER_KEYS = ['category', 'gender', 'level', 'handicap'] as const;

export type RankingFilterKey = (typeof RANKING_FILTER_KEYS)[number];

/** Valeurs d'un classé pour chaque critère (absent = non renseigné) */
export interface RankingSubject {
  category?: string;
  gender?: string;
  level?: number | string;
  handicap?: boolean;
}

/** Valeurs retenues : un critère absent n'est pas filtré */
export interface RankingFilter {
  category?: string;
  gender?: string;
  level?: number | string;
  handicap?: boolean;
}

/** Ligne d'un classement : rang (null : sans rang, carton noir) */
export interface RankedRow {
  rank: number | null;
}

/** Liste de critères valide (connus, distincts) ; sinon null. Absente ou vide : aucun filtre. */
export function rankingFilterKeysIssue(keys: unknown): string | null {
  if (!Array.isArray(keys)) return 'attend une liste de critères';
  const known: readonly unknown[] = RANKING_FILTER_KEYS;
  if (keys.some(k => !known.includes(k)))
    return `critère inconnu (${RANKING_FILTER_KEYS.join(' | ')})`;
  if (new Set(keys).size !== keys.length) return 'critères distincts';
  return null;
}

/** Critères proposés : ceux de la liste, dans l'ordre canonique, sans inconnu ni doublon */
export function normalizeRankingFilterKeys(
  keys: readonly unknown[] | undefined
): RankingFilterKey[] {
  const wanted = new Set(keys ?? []);
  return RANKING_FILTER_KEYS.filter(k => wanted.has(k));
}

/** Aucun critère retenu */
export const isRankingFilterEmpty = (filter: RankingFilter): boolean =>
  filter.category === undefined &&
  filter.gender === undefined &&
  filter.level === undefined &&
  !filter.handicap;

/** Critères du filtre restreints à ceux proposés par la formule */
export function restrictRankingFilter(
  filter: RankingFilter,
  keys: readonly RankingFilterKey[]
): RankingFilter {
  const out: RankingFilter = {};
  if (keys.includes('category') && filter.category !== undefined) out.category = filter.category;
  if (keys.includes('gender') && filter.gender !== undefined) out.gender = filter.gender;
  if (keys.includes('level') && filter.level !== undefined) out.level = filter.level;
  if (keys.includes('handicap') && filter.handicap) out.handicap = true;
  return out;
}

/** Le classé passe-t-il tous les critères retenus ? Sans valeur connue : refusé dès qu'un critère est retenu. */
export function matchesRankingFilter(
  subject: RankingSubject | undefined,
  filter: RankingFilter
): boolean {
  if (isRankingFilterEmpty(filter)) return true;
  if (!subject) return false;
  if (filter.category !== undefined && subject.category !== filter.category) return false;
  if (filter.gender !== undefined && subject.gender !== filter.gender) return false;
  if (filter.level !== undefined && subject.level !== filter.level) return false;
  if (filter.handicap && !subject.handicap) return false;
  return true;
}

/**
 * Filtre un classement déjà ordonné : seuls les classés qui passent tous les critères retenus
 * sont gardés, rangs recalculés depuis 1 (ex aequo conservés). Les lignes sans rang (null) restent
 * sans rang. Sans critère retenu, le classement est rendu tel quel.
 */
export function filterRanking<T extends RankedRow>(
  rows: readonly T[],
  subjectOf: (row: T) => RankingSubject | undefined,
  filter: RankingFilter
): T[] {
  if (isRankingFilterEmpty(filter)) return [...rows];
  const kept = rows.filter(r => matchesRankingFilter(subjectOf(r), filter));
  const out: T[] = [];
  // Rang d'origine du groupe d'ex aequo en cours et rang qui lui est donné
  let groupFrom: number | null = null;
  let groupTo = 0;
  let position = 0;
  for (const row of kept) {
    if (row.rank === null) {
      out.push(row);
      continue;
    }
    position++;
    if (row.rank !== groupFrom) {
      groupFrom = row.rank;
      groupTo = position;
    }
    out.push({ ...row, rank: groupTo });
  }
  return out;
}

/** Ordre d'affichage des valeurs connues d'un critère ; les autres suivent, dans l'ordre d'apparition */
const VALUE_ORDER: Record<'category' | 'gender', readonly string[]> = {
  category: Object.values(Category),
  gender: [Gender.MALE, Gender.FEMALE, Gender.MIXED],
};

/**
 * Valeurs présentes pour un critère (catégorie, sexe, niveau), de quoi proposer le filtre :
 * catégories dans l'ordre des âges, sexes M, F, X, niveaux croissants (du plus faible au plus fort).
 */
export function rankingFilterValues(
  subjects: ReadonlyArray<RankingSubject | undefined>,
  key: Exclude<RankingFilterKey, 'handicap'>
): Array<string | number> {
  const seen = new Set<string | number>();
  for (const s of subjects) {
    const v = s?.[key];
    if (v !== undefined && v !== '') seen.add(v);
  }
  const values = [...seen];
  if (key === 'level') return values.sort((a, b) => Number(a) - Number(b));
  const order = VALUE_ORDER[key];
  const rank = (v: string | number) => {
    const i = order.indexOf(String(v));
    return i < 0 ? order.length : i;
  };
  // Tri stable : les valeurs hors ordre gardent leur ordre d'apparition
  return values.sort((a, b) => rank(a) - rank(b));
}

/** Valeurs d'un tireur (ou d'une équipe) pour les critères : catégorie, sexe, niveau, HANDI */
export function subjectOfFencer(
  fencer: Pick<Fencer, 'category' | 'gender' | 'level' | 'handicap'>
): RankingSubject {
  return {
    ...(fencer.category ? { category: fencer.category } : {}),
    ...(fencer.gender ? { gender: fencer.gender } : {}),
    ...(fencer.level ? { level: fencer.level } : {}),
    handicap: !!fencer.handicap,
  };
}
