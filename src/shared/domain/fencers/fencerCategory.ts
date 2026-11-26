/**
 * BPM - Escrime - Catégorie d'âge du tireur (docs/adr/0039, étape E1 de #2013)
 * Champ `Fencer.category` : importé, calculé depuis la date de naissance et la saison de
 * l'épreuve, ou saisi. Sert à la scission par catégorie. Domaine pur : la date de référence
 * (date de l'épreuve) est injectée.
 * Licensed under GPL-3.0
 */
import { Category, type Fencer } from '../../types';
import { ageCategoryFromBirthYear, normalizeAgeCategory } from './ageCategory';

/** Codes acceptés par le contrat, de la plus jeune à la plus âgée */
export const FENCER_CATEGORIES = [
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
] as const satisfies readonly `${Category}`[];

/** Code reconnu (U17, M17, SEN, Senior, V1…), sinon undefined */
export function normalizeFencerCategory(v: unknown): Category | undefined {
  return normalizeAgeCategory(v) as Category | undefined;
}

/**
 * Catégorie d'après la date de naissance, pour la saison de l'épreuve (1er septembre →
 * 31 août ; règles FFE des jeunes et des vétérans). Sans date de naissance : undefined.
 */
export function categoryFromBirthDate(
  birthDate: Date | undefined,
  competitionDate: Date
): Category | undefined {
  if (!birthDate || Number.isNaN(new Date(birthDate).getTime())) return undefined;
  return ageCategoryFromBirthYear(new Date(birthDate).getFullYear(), competitionDate) as Category;
}

/**
 * « Calculer les catégories » : catégorie des tireurs qui n'en ont pas, d'après leur date de
 * naissance. Les catégories déjà connues (importées, saisies) ne sont pas touchées. Rend
 * aussi les tireurs restés sans catégorie (pas de date de naissance).
 */
export function computeMissingCategories(
  fencers: Array<Pick<Fencer, 'id' | 'birthDate' | 'category'>>,
  competitionDate: Date
): { updates: Array<{ fencerId: string; category: Category }>; withoutBirthDate: string[] } {
  const updates: Array<{ fencerId: string; category: Category }> = [];
  const withoutBirthDate: string[] = [];
  for (const f of fencers) {
    if (f.category) continue;
    const category = categoryFromBirthDate(f.birthDate, competitionDate);
    if (category) updates.push({ fencerId: f.id, category });
    else withoutBirthDate.push(f.id);
  }
  return { updates, withoutBirthDate };
}

/** Libellé court de la catégorie, comme les feuilles FFE : M17, Sen, V1… */
export function categoryShortLabel(category: Category | undefined | null): string {
  if (!category) return '';
  if (category === Category.SENIOR) return 'Sen';
  return category.startsWith('U') ? `M${category.slice(1)}` : category;
}
