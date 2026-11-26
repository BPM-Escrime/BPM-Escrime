/**
 * BPM - Escrime - Branches d'une épreuve scindée (#2013 étape E2b, docs/adr/0039) : les tireurs
 * passés dans une branche sont classés dans sa compétition fille ; les résultats de l'épreuve
 * d'origine y renvoient (libellé, nombre de tireurs, « Ouvrir »).
 * Licensed under GPL-3.0
 */
import React from 'react';
import type { SplitHistoryEntry } from '../../../shared/domain/formula/splitPlan';
import { useTranslation } from '../../hooks/useTranslation';
import { Button } from '../common/Button';

interface SplitBranchesPanelProps {
  branches: readonly SplitHistoryEntry[];
  onOpenCompetition?: (competitionId: string) => void;
}

export const SplitBranchesPanel: React.FC<SplitBranchesPanelProps> = ({
  branches,
  onOpenCompetition,
}) => {
  const { t } = useTranslation();
  return (
    <section className="split-branches" data-testid="split-branches">
      <h2 className="split-branches__title">{t('resultsView.branches_title')}</h2>
      <p className="u-hint">{t('resultsView.branches_hint')}</p>
      <ul className="split-branches__list">
        {branches.map(b => (
          <li key={b.competitionId} className="split-branches__item">
            <span className="split-branches__label">{b.label}</span>
            <span className="split-branches__count">
              {t('resultsView.branch_fencers', { n: b.fencerIds.length })}
            </span>
            {onOpenCompetition && (
              <Button
                type="button"
                variant="secondary"
                data-testid={`split-branch-open-${b.label}`}
                onClick={() => onOpenCompetition(b.competitionId)}
              >
                {t('resultsView.open_branch')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
};

export default SplitBranchesPanel;
