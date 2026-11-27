/**
 * BPM - Escrime - Barre des filtres du classement final (docs/adr/0043, F4d)
 * Un sélecteur par critère proposé par la formule (`rankingFilters`) : catégorie, sexe, niveau,
 * HANDI. Les options viennent des classés. Un filtre est un affichage, pas une compétition fille.
 * Licensed under GPL-3.0
 */
import React from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import type {
  RankingFilter,
  RankingFilterKey,
} from '../../../shared/domain/ranking/rankingFilters';
import type { RankingFilterOption, RankingFilterOptions } from './rankingFilterOptions';

interface RankingFilterBarProps {
  /** Critères proposés, dans l'ordre d'affichage */
  keys: readonly RankingFilterKey[];
  value: RankingFilter;
  onChange: (filter: RankingFilter) => void;
  options: RankingFilterOptions;
  className?: string;
}

const RankingFilterBar: React.FC<RankingFilterBarProps> = ({
  keys,
  value,
  onChange,
  options,
  className,
}) => {
  const { t } = useTranslation();
  if (keys.length === 0) return null;

  const choose = (
    key: 'category' | 'gender' | 'level',
    opts: RankingFilterOption[],
    raw: string
  ) => {
    const next: RankingFilter = { ...value };
    const found = opts.find(o => String(o.value) === raw);
    if (found) next[key] = found.value as never;
    else delete next[key];
    onChange(next);
  };

  const select = (key: 'category' | 'gender' | 'level', all: string, label: string) => (
    <select
      key={key}
      className="form-input form-select"
      aria-label={label}
      value={value[key] === undefined ? '' : String(value[key])}
      onChange={e => choose(key, options[key], e.target.value)}
    >
      <option value="">{all}</option>
      {options[key].map(o => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );

  return (
    <div
      className={className ?? 'ranking-filter-bar'}
      role="group"
      aria-label={t('rankingFilters.title')}
      data-testid="ranking-filters"
    >
      {keys.includes('category') &&
        select('category', t('rankingFilters.all_categories'), t('rankingFilters.category'))}
      {keys.includes('gender') &&
        select('gender', t('rankingFilters.all_genders'), t('rankingFilters.gender'))}
      {keys.includes('level') &&
        select('level', t('rankingFilters.all_levels'), t('rankingFilters.level'))}
      {keys.includes('handicap') && (
        <label className="ranking-filter-bar__handicap">
          <input
            type="checkbox"
            checked={!!value.handicap}
            onChange={e => {
              const next: RankingFilter = { ...value };
              if (e.target.checked) next.handicap = true;
              else delete next.handicap;
              onChange(next);
            }}
          />{' '}
          {t('rankingFilters.handicap_only')}
        </label>
      )}
    </div>
  );
};

export default RankingFilterBar;
