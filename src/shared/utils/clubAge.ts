/**
 * BPM - Escrime - Mode Club (#1872) : catégories d'âge des membres (M9 … V4),
 * plages de catégories (séances, pointage, exercices, statistiques) et séances récurrentes.
 * Licensed under GPL-3.0
 */
import { isIsoDate } from './clubStats';

// Règles d'âge dans le domaine (docs/adr/0002, 0039) ; réexportées pour le Mode Club
export {
  AGE_CATEGORIES,
  ageCategoryFromBirthYear,
  normalizeAgeCategory,
  type ClubAgeCategory,
} from '../domain/fencers/ageCategory';
import {
  AGE_CATEGORIES,
  ageCategoryFromBirthYear,
  normalizeAgeCategory,
  type ClubAgeCategory,
} from '../domain/fencers/ageCategory';

/** Rang de la catégorie (0 = M9), -1 si inconnue */
export function ageCategoryRank(cat: string | undefined): number {
  const c = normalizeAgeCategory(cat);
  return c ? AGE_CATEGORIES.indexOf(c) : -1;
}

/** Année de naissance d'une date AAAA-MM-JJ, sinon undefined */
export function birthYearOfDate(date: string | undefined | null): number | undefined {
  if (!isIsoDate(date ?? undefined)) return undefined;
  const y = Number(date!.slice(0, 4));
  return y >= 1900 && y <= 2100 ? y : undefined;
}

/** Catégorie d'un membre : date puis année de naissance, sinon catégorie saisie */
export function memberAgeCategory(
  m: { birthDate?: string; birthYear?: number; category?: string },
  ref: Date = new Date()
): ClubAgeCategory | undefined {
  const year = birthYearOfDate(m.birthDate) ?? m.birthYear;
  if (typeof year === 'number' && year >= 1900) return ageCategoryFromBirthYear(year, ref);
  return normalizeAgeCategory(m.category);
}

/** Plage de catégories (bornes incluses, dans n'importe quel ordre) ; bornes absentes = ouvertes */
export interface AgeRange {
  ageFrom?: string;
  ageTo?: string;
}

/** Vrai si la plage est restreinte (au moins une borne reconnue) */
export function hasAgeRange(r: AgeRange | undefined): boolean {
  return ageCategoryRank(r?.ageFrom) >= 0 || ageCategoryRank(r?.ageTo) >= 0;
}

/**
 * La catégorie appartient-elle à la plage ? Plage ouverte : toujours vrai.
 * Catégorie inconnue dans une plage restreinte : `unknownMatches` (vrai par défaut,
 * un membre sans date de naissance n'est pas caché).
 */
export function inAgeRange(
  cat: string | undefined,
  r: AgeRange | undefined,
  unknownMatches = true
): boolean {
  if (!hasAgeRange(r)) return true;
  const rank = ageCategoryRank(cat);
  if (rank < 0) return unknownMatches;
  const [lo, hi] = rankBounds(r);
  return rank >= lo && rank <= hi;
}

/** Bornes [début, fin] d'une plage (rangs inclus, plage ouverte = toutes) */
function rankBounds(r: AgeRange | undefined): [number, number] {
  let lo = ageCategoryRank(r?.ageFrom);
  let hi = ageCategoryRank(r?.ageTo);
  if (lo < 0) lo = 0;
  if (hi < 0) hi = AGE_CATEGORIES.length - 1;
  return lo <= hi ? [lo, hi] : [hi, lo];
}

/** Deux plages ont-elles au moins une catégorie en commun ? (plage ouverte : toujours) */
export function rangesOverlap(a: AgeRange | undefined, b: AgeRange | undefined): boolean {
  const [alo, ahi] = rankBounds(a);
  const [blo, bhi] = rankBounds(b);
  return alo <= bhi && blo <= ahi;
}

/** Exercice : liste vide = commun à toutes les catégories */
export function exerciseMatchesRange(
  categories: readonly string[] | undefined,
  r: AgeRange | undefined
): boolean {
  if (!categories || categories.length === 0 || !hasAgeRange(r)) return true;
  return categories.some(c => inAgeRange(c, r, false));
}

/** Liste de catégories nettoyée (codes reconnus, sans doublon, ordre M9 → V4) */
export function normalizeAgeCategories(v: unknown): ClubAgeCategory[] {
  if (!Array.isArray(v)) return [];
  const set = new Set(v.map(normalizeAgeCategory).filter((c): c is ClubAgeCategory => !!c));
  return AGE_CATEGORIES.filter(c => set.has(c));
}

/** Tri par catégorie (M9 d'abord, inconnues à la fin) puis nom */
export function compareByAgeCategory<T extends { lastName: string; firstName: string }>(
  catOf: (m: T) => string | undefined
): (a: T, b: T) => number {
  return (a, b) => {
    const ra = ageCategoryRank(catOf(a));
    const rb = ageCategoryRank(catOf(b));
    const ka = ra < 0 ? AGE_CATEGORIES.length : ra;
    const kb = rb < 0 ? AGE_CATEGORIES.length : rb;
    return (
      ka - kb ||
      a.lastName.localeCompare(b.lastName, undefined, { sensitivity: 'base' }) ||
      a.firstName.localeCompare(b.firstName, undefined, { sensitivity: 'base' })
    );
  };
}

// ─── Séances récurrentes ──────────────────────────────────────────────────────

export const MAX_SERIES_OCCURRENCES = 60;

/** Date AAAA-MM-JJ + n jours (calcul UTC, sans effet d'heure d'été) */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Plafond d'une période sur jours d'ouverture (une saison environ) */
export const MAX_SCHEDULE_DAYS = 366;
/** Nombre de périodes par action (génération ou fermeture) */
export const MAX_SCHEDULE_PERIODS = 10;
/** Nombre total de dates créées par une génération */
export const MAX_SCHEDULE_DATES = 1000;

/**
 * Dates comprises entre `from` et `until` (incluses) tombant un des jours de la semaine
 * (0 = dimanche … 6 = samedi). Vide si une date est invalide ou si la période est inversée.
 */
export function weekdayDates(from: string, until: string, weekdays: readonly number[]): string[] {
  if (!isIsoDate(from) || !isIsoDate(until) || from > until) return [];
  const days = new Set(weekdays.filter(d => Number.isInteger(d) && d >= 0 && d <= 6));
  if (days.size === 0) return [];
  const out: string[] = [];
  for (let d = from; d <= until && out.length <= MAX_SCHEDULE_DAYS; d = addDays(d, 1)) {
    if (days.has(new Date(`${d}T00:00:00Z`).getUTCDay())) out.push(d);
  }
  return out;
}

/**
 * Dates d'une séance récurrente : `start`, puis tous les `everyDays` jours,
 * jusqu'à `until` (inclus) ou `count` occurrences ; 60 au plus.
 */
export function recurrenceDates(
  start: string,
  everyDays: number,
  opts: { count?: number; until?: string }
): string[] {
  if (!isIsoDate(start)) return [];
  const step = Math.floor(Number(everyDays));
  if (!Number.isFinite(step) || step < 1 || step > 365) return [start];
  const max = Math.min(
    Math.max(Math.floor(Number(opts.count ?? MAX_SERIES_OCCURRENCES)) || 1, 1),
    MAX_SERIES_OCCURRENCES
  );
  const until = isIsoDate(opts.until) ? opts.until : undefined;
  const out: string[] = [];
  for (let d = start; out.length < max; d = addDays(d, step)) {
    if (until && d > until) break;
    out.push(d);
  }
  return out;
}
