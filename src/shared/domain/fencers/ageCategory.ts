/**
 * BPM - Escrime - Catégories d'âge (M9 … V4) et saison sportive : règle FFE commune au tireur
 * (docs/adr/0039) et au membre du Mode Club. Domaine pur : date de référence injectée.
 * Licensed under GPL-3.0
 */

/** Catégories d'âge, de la plus jeune à la plus âgée (codes de `Category`) */
export const AGE_CATEGORIES = [
  'U9',
  'U11',
  'U13',
  'U15',
  'U17',
  'U20',
  'SEN',
  'V1',
  'V2',
  'V3',
  'V4',
] as const;

export type ClubAgeCategory = (typeof AGE_CATEGORIES)[number];

/** Plafond d'âge des catégories jeunes (âge atteint dans l'année de fin de saison) */
const YOUTH_LIMITS: Array<[number, ClubAgeCategory]> = [
  [9, 'U9'],
  [11, 'U11'],
  [13, 'U13'],
  [15, 'U15'],
  [17, 'U17'],
  [20, 'U20'],
];

const ALIASES: Record<string, ClubAgeCategory> = {
  SENIOR: 'SEN',
  SENIORS: 'SEN',
  M9: 'U9',
  M11: 'U11',
  M13: 'U13',
  M15: 'U15',
  M17: 'U17',
  M20: 'U20',
};

/** Code de catégorie reconnu (U11, M11, SEN, Senior, V1…), sinon undefined */
export function normalizeAgeCategory(v: unknown): ClubAgeCategory | undefined {
  if (typeof v !== 'string') return undefined;
  const k = v.trim().toUpperCase();
  if ((AGE_CATEGORIES as readonly string[]).includes(k)) return k as ClubAgeCategory;
  return ALIASES[k];
}

/** Saison sportive (1er septembre → 31 août) contenant `ref` : années de début et de fin */
function seasonYears(ref: Date): { start: number; end: number } {
  const start = ref.getMonth() >= 8 ? ref.getFullYear() : ref.getFullYear() - 1;
  return { start, end: start + 1 };
}

/**
 * Catégorie d'âge d'une année de naissance pour la saison de `ref` :
 * jeunes (M9 → M20) d'après l'âge atteint l'année de fin de saison (règle FFE),
 * vétérans d'après l'âge atteint l'année de début de saison (même règle que les rapières).
 */
export function ageCategoryFromBirthYear(
  birthYear: number,
  /** Date de référence (saison) : injectée, domaine pur */
  ref: Date
): ClubAgeCategory {
  const { start, end } = seasonYears(ref);
  const youthAge = end - birthYear;
  for (const [limit, cat] of YOUTH_LIMITS) if (youthAge <= limit) return cat;
  const age = start - birthYear;
  if (age >= 70) return 'V4';
  if (age >= 60) return 'V3';
  if (age >= 50) return 'V2';
  if (age >= 40) return 'V1';
  return 'SEN';
}
