/**
 * BPM - Escrime - Formule à la création : repliée, résumé sur une ligne (#2013 D3, docs/adr/0032)
 * Le standard de l'arme et de la catégorie est présélectionné ; « Personnaliser la formule »
 * déplie l'interface unique (`FormulaEditor`). Créer sans déplier ne demande aucun clic de plus.
 * Licensed under GPL-3.0
 */

import React from 'react';
import type { FormulaSummaryPart } from '../../../shared/domain/formula/formulaFrieze';
import { summarizeFormulaV2 } from '../../../shared/domain/formula/formulaV2Operations';
import { useTranslation } from '../../hooks/useTranslation';
import { FormulaTemplatePicker } from './FormulaTemplatePicker';
import { FormulaEditor, FormulaEditorProps } from './FormulaEditor';

type Translate = (key: string, params?: { [key: string]: string | number }) => string;

/** Résumé lisible : « Poules 5 touches → Tableau 15 touches · 3ᵉ place tirée » */
export function formatFormulaSummary(parts: FormulaSummaryPart[], t: Translate): string {
  return parts
    .map(p => {
      if (p.kind === 'pools')
        return p.rounds > 1
          ? t('formulaEditor.summary_pools_rounds', { rounds: p.rounds, score: p.maxScore })
          : t('formulaEditor.summary_pools', { score: p.maxScore });
      if (p.kind === 'quest') return t('properties.quest_round');
      const tableau =
        p.maxScore === 0
          ? t('formulaEditor.summary_tableau_unlimited')
          : t('formulaEditor.summary_tableau', { score: p.maxScore });
      return p.thirdPlace ? `${tableau} · ${t('formulaEditor.summary_third_place')}` : tableau;
    })
    .join(' → ');
}

interface Props extends FormulaEditorProps {
  /** Sélecteur de modèle (docs/adr/0033) */
  picker: React.ComponentProps<typeof FormulaTemplatePicker>;
}

export const FormulaCreationSection: React.FC<Props> = ({ picker, ...props }) => {
  const { t } = useTranslation();
  const { formula, specialMode } = props;
  const parts = summarizeFormulaV2(formula);
  const summary = specialMode ? t(`rapieres.mode_${specialMode}`) : formatFormulaSummary(parts, t);

  return (
    <div className="form-group formula-collapsed" data-testid="formula-collapsed">
      <div className="formula-collapsed__head">
        <span className="form-label">{t('formulaEditor.formula')}</span>
      </div>
      <FormulaTemplatePicker {...picker} />
      <p className="formula-collapsed__summary" data-testid="formula-summary">
        {summary}
      </p>
      <details>
        <summary data-testid="formula-personalize">{t('formulaEditor.personalize')}</summary>
        <FormulaEditor {...props} />
      </details>
    </div>
  );
};

export default FormulaCreationSection;
