/**
 * BPM - Escrime - Filtres du classement : options et libellés (docs/adr/0043, F4d)
 * Valeurs proposées d'après les classés (catégories dans l'ordre des âges, sexes, niveaux du plus
 * faible au plus fort) ; libellés traduits, niveaux d'après la formule (`entry.levels`).
 * Licensed under GPL-3.0
 */
import { categoryLabel, genderLabel } from '../../../shared/utils/categoryLabel';
import { levelLabel } from '../../../shared/domain/fencers/teamEntry';
import {
  rankingFilterValues,
  type RankingFilter,
  type RankingSubject,
} from '../../../shared/domain/ranking/rankingFilters';

type Translate = (key: string) => string;

export interface RankingFilterOption {
  value: string | number;
  label: string;
}

export interface RankingFilterOptions {
  category: RankingFilterOption[];
  gender: RankingFilterOption[];
  level: RankingFilterOption[];
}

/** Libellé d'un sexe : M, F, X (tireur) ou MIXED (équipe des rapières) */
const sexLabel = (value: string | number, t: Translate): string =>
  value === 'MIXED' ? t('genders.mixed') : genderLabel(String(value), t);

/** Libellé d'un niveau : de la formule (codes par défaut traduits), sinon le numéro */
const levelText = (value: string | number, levels: readonly string[], t: Translate): string =>
  typeof value === 'number'
    ? levelLabel(value, levels, code => t(`rapieres.level_${code}`)) || String(value)
    : t(`rapieres.level_${value}`);

/** Options des filtres d'après les classés : seules les valeurs présentes sont proposées */
export function rankingFilterOptions(
  subjects: ReadonlyArray<RankingSubject | undefined>,
  levels: readonly string[],
  t: Translate
): RankingFilterOptions {
  return {
    category: rankingFilterValues(subjects, 'category').map(value => ({
      value,
      label: categoryLabel(String(value), t),
    })),
    gender: rankingFilterValues(subjects, 'gender').map(value => ({
      value,
      label: sexLabel(value, t),
    })),
    level: rankingFilterValues(subjects, 'level').map(value => ({
      value,
      label: levelText(value, levels, t),
    })),
  };
}

/** Libellés des critères retenus (sous-titre des PDF), ex. « M20 · Féminin · HANDI » */
export function rankingFilterLabels(
  filter: RankingFilter,
  levels: readonly string[],
  t: Translate
): string[] {
  return [
    filter.category !== undefined ? categoryLabel(filter.category, t) : '',
    filter.gender !== undefined ? sexLabel(filter.gender, t) : '',
    filter.level !== undefined ? levelText(filter.level, levels, t) : '',
    filter.handicap ? t('teamEntry.handicap') : '',
  ].filter(Boolean);
}
