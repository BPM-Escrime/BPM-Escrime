/**
 * BPM - Escrime - Éditeur de formule : filtres du classement final (docs/adr/0043, F4d)
 * Critères proposés à l'écran, aux PDF et au CSV du classement final : catégorie, sexe, niveau,
 * HANDI. Un affichage : pas de compétition fille, la publication reste le classement complet.
 * Licensed under GPL-3.0
 */
import React from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { FormulaHelpLink } from './FormulaHelpLink';
import {
  normalizeRankingFilterKeys,
  RANKING_FILTER_KEYS,
  type RankingFilterKey,
} from '../../../shared/domain/ranking/rankingFilters';

interface FormulaRankingFilterFieldsProps {
  id: string;
  filters: readonly RankingFilterKey[];
  onChange: (filters: RankingFilterKey[]) => void;
}

const FormulaRankingFilterFields: React.FC<FormulaRankingFilterFieldsProps> = ({
  id,
  filters,
  onChange,
}) => {
  const { t } = useTranslation();
  return (
    <fieldset className="form-group" data-testid={`${id}-ranking-filters`}>
      <legend className="form-label">{t('formulaEditor.ranking_filters')}</legend>
      <FormulaHelpLink topic="ranking-filters" />
      {RANKING_FILTER_KEYS.map(key => (
        <div key={key}>
          <label>
            <input
              type="checkbox"
              checked={filters.includes(key)}
              onChange={e =>
                onChange(
                  normalizeRankingFilterKeys(
                    e.target.checked ? [...filters, key] : filters.filter(k => k !== key)
                  )
                )
              }
            />{' '}
            {t(`rankingFilters.${key}`)}
          </label>
        </div>
      ))}
      <small className="u-hint">{t('formulaEditor.ranking_filters_hint')}</small>
    </fieldset>
  );
};

export default FormulaRankingFilterFields;
