/**
 * BPM - Escrime - Interface unique de la formule (#2013 étape B1, docs/adr/0032)
 * Nouvelle interface (réglage du poste `formulaPreview`) : frise Appel → phases → Classement
 * final, « ＋ » entre les phases limité aux briques autorisées, réglages de la phase
 * sélectionnée. Même composant à la création et dans Organisation ▸ Formule, pour toutes les
 * armes. Règles de la frise : shared/domain/formula/formulaFrieze.ts.
 * Licensed under GPL-3.0
 */

import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import {
  Category,
  CompetitionSpecialMode,
  CustomDEConfig,
  CustomFormulaConfig,
  CustomPoolRoundConfig,
  FormulaPhaseNode,
  Weapon,
} from '../../../shared/types';
import { FormulaDraft, FormulaPhaseId } from '../../../shared/domain/formula/formulaDraft';
import {
  FriezeBrick,
  FriezePhase,
  customCanRemove,
  customFrieze,
  customInsert,
  customInsertOptions,
  customPhaseNode,
  customRemove,
  draftCanRemove,
  draftFrieze,
  draftInsert,
  draftInsertOptions,
  draftRemove,
  normalizeCustomFormula,
} from '../../../shared/domain/formula/formulaFrieze';
import { createDefaultCustomFormula } from '../../../shared/utils/tournamentTemplates';
import { useTranslation } from '../../hooks/useTranslation';
import { PropertiesFormulaTab } from './PropertiesFormulaTab';
import { FormulaPhaseCard } from './FormulaPhaseCard';

export interface FormulaEditorProps {
  weapon: Weapon;
  category: Category;
  /** Épée, fleuret, sabre, Sabre Laser */
  draft: FormulaDraft;
  onDraftChange: (patch: Partial<FormulaDraft>) => void;
  /** Arme « Autre » (code 'C') */
  customFormula: CustomFormulaConfig;
  onCustomChange: (formula: CustomFormulaConfig) => void;
  /** Mode spécial de l'arme « Autre » (création seulement, #1118) */
  specialMode?: CompetitionSpecialMode;
  onSpecialModeChange?: (mode: CompetitionSpecialMode | undefined) => void;
  /** Épreuve des rapières existante : qualification sans effet, grisée */
  rapieres?: boolean;
}

const SPECIAL_MODES: CompetitionSpecialMode[] = ['rapieres'];

const newPhaseId = () => `phase_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

function customDefaults() {
  const f = createDefaultCustomFormula();
  return {
    pool: f.phases[0].config as CustomPoolRoundConfig,
    tableau: f.phases[1].config as CustomDEConfig,
  };
}

const toPhaseId = (p: FriezePhase | undefined): FormulaPhaseId | null =>
  !p ? null : p.kind === 'pool' ? { kind: 'pool', round: p.round } : { kind: p.kind };

export const FormulaEditor: React.FC<FormulaEditorProps> = ({
  weapon,
  category,
  draft,
  onDraftChange,
  customFormula,
  onCustomChange,
  specialMode,
  onSpecialModeChange,
  rapieres,
}) => {
  const { t } = useTranslation();
  const isOther = weapon === Weapon.CUSTOM;
  const custom = normalizeCustomFormula(customFormula);
  const phases = isOther ? customFrieze(custom) : draftFrieze(draft, weapon);
  const [selectedKey, setSelectedKey] = useState<string>(phases[0]?.key ?? '');
  const [openPlus, setOpenPlus] = useState<number | null>(null);
  const current = phases.find(p => p.key === selectedKey) ?? phases[0];
  const poolCount = phases.filter(p => p.kind === 'pool').length;

  const insertOptions = (at: number): FriezeBrick[] =>
    isOther ? customInsertOptions(custom, at) : draftInsertOptions(draft, weapon, at);

  const insert = (brick: FriezeBrick, at: number) => {
    if (isOther) onCustomChange(customInsert(custom, brick, at, newPhaseId, customDefaults()));
    else onDraftChange(draftInsert(draft, weapon, brick, at));
    setSelectedKey(brick === 'pool' ? `pool-${at}` : brick);
    setOpenPlus(null);
  };

  const canRemove = (p: FriezePhase) =>
    isOther ? customCanRemove(custom, p) : draftCanRemove(draft, weapon, p);

  const remove = (p: FriezePhase) => {
    if (isOther) onCustomChange(customRemove(custom, p));
    else onDraftChange(draftRemove(draft, weapon, p));
    setSelectedKey(phases[0]?.key ?? '');
  };

  const title = (p: FriezePhase) =>
    p.kind === 'pool'
      ? poolCount > 1
        ? t('properties.phase_pool_round', { n: p.round + 1 })
        : t('properties.phase_pools')
      : p.kind === 'quest'
        ? t('properties.quest_round')
        : t('properties.phase_tableau');

  const summary = (p: FriezePhase): string => {
    if (isOther) {
      const node = customPhaseNode(custom, p)?.node;
      const score = (node?.config as CustomPoolRoundConfig | CustomDEConfig | undefined)?.maxScore;
      return score ? t('formulaPhase.n_touches', { n: score }) : '';
    }
    if (p.kind === 'pool')
      return t('properties.summary_pool', {
        min: draft.poolSizeMin,
        max: draft.poolSizeMax,
        score: draft.poolMaxScore,
      });
    if (p.kind === 'quest') return '';
    return draft.tableMaxScore === 0
      ? t('properties.summary_tableau_unlimited')
      : t('properties.summary_tableau', { score: draft.tableMaxScore });
  };

  const plus = (at: number) => {
    const options = insertOptions(at);
    if (options.length === 0 || specialMode) return null;
    return (
      <span key={`plus-${at}`} className="formula-editor__plus">
        <button
          type="button"
          className="formula-editor__plus-btn"
          data-testid={`formula-plus-${at}`}
          aria-label={t('formulaEditor.add_here')}
          title={t('formulaEditor.add_here')}
          aria-expanded={openPlus === at}
          onClick={() => setOpenPlus(openPlus === at ? null : at)}
        >
          <Plus size={14} aria-hidden="true" />
        </button>
        {openPlus === at && (
          <span className="formula-editor__menu" role="menu">
            {options.map(brick => (
              <button
                key={brick}
                type="button"
                role="menuitem"
                data-testid={`formula-add-${brick}-${at}`}
                onClick={() => insert(brick, at)}
              >
                {t(`formulaEditor.brick_${brick}`)}
              </button>
            ))}
          </span>
        )}
      </span>
    );
  };

  const frieze: React.ReactNode[] = [
    <span key="checkin" className="formula-frieze__step formula-frieze__step--fixed">
      {t('properties.phase_checkin')}
    </span>,
    plus(0),
  ];
  phases.forEach((p, i) => {
    const selected = p.key === current?.key;
    frieze.push(
      <span key={p.key} className="formula-editor__phase">
        <button
          type="button"
          data-testid={`formula-step-${p.key}`}
          className={`formula-frieze__step${selected ? ' is-selected' : ''}`}
          aria-pressed={selected}
          onClick={() => setSelectedKey(p.key)}
        >
          <span className="formula-frieze__title">{title(p)}</span>
          <span className="formula-frieze__summary">{summary(p)}</span>
        </button>
        {canRemove(p) && !specialMode && (
          <button
            type="button"
            className="formula-editor__remove"
            data-testid={`formula-remove-${p.key}`}
            aria-label={t('formulaEditor.remove', { phase: title(p) })}
            title={t('formulaEditor.remove', { phase: title(p) })}
            onClick={() => remove(p)}
          >
            <X size={12} aria-hidden="true" />
          </button>
        )}
      </span>
    );
    frieze.push(plus(i + 1));
  });
  frieze.push(
    <span key="final" className="formula-frieze__step formula-frieze__step--fixed">
      {t('properties.phase_final_ranking')}
    </span>
  );

  const updateNode = (index: number, node: FormulaPhaseNode) => {
    const next = [...custom.phases];
    next[index] = node;
    onCustomChange({ ...custom, phases: next });
  };

  function renderOtherPhase() {
    if (!current) return null;
    const found = customPhaseNode(custom, current);
    if (!found) return null;
    return (
      <FormulaPhaseCard
        key={found.node.id}
        node={found.node}
        index={0}
        inputFencers={32}
        onUpdate={node => updateNode(found.index, node)}
        onRemove={() => remove(current)}
        canMoveUp={false}
        canMoveDown={false}
        advancementDisabled={rapieres || specialMode === 'rapieres'}
        embedded
      />
    );
  }

  function renderOtherGeneral() {
    const ruleSet = custom.ruleSet ?? (rapieres || specialMode ? 'modern' : 'laser');
    const rest = custom.restTimeSeconds ?? 60;
    return (
      <details className="properties-expert formula-editor__general">
        <summary>{t('properties.expert_settings')}</summary>
        {onSpecialModeChange && (
          <div className="form-group">
            <label className="form-label" htmlFor="formula-special-mode">
              {t('rapieres.special_modes')}
            </label>
            <select
              id="formula-special-mode"
              className="form-input form-select"
              value={specialMode ?? ''}
              onChange={e =>
                onSpecialModeChange((e.target.value || undefined) as CompetitionSpecialMode)
              }
            >
              <option value="">{t('rapieres.mode_none')}</option>
              {SPECIAL_MODES.map(mode => (
                <option key={mode} value={mode}>
                  {t(`rapieres.mode_${mode}`)}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="form-group">
          <label className="form-label" htmlFor="formula-editor-rule-set">
            {t('formula.rule_set')}
          </label>
          <select
            id="formula-editor-rule-set"
            className="form-input form-select"
            value={ruleSet}
            onChange={e =>
              onCustomChange({ ...custom, ruleSet: e.target.value as 'modern' | 'laser' })
            }
          >
            <option value="laser">{t('formula.rule_set_laser')}</option>
            <option value="modern">{t('formula.rule_set_modern')}</option>
          </select>
        </div>
        {ruleSet === 'modern' && (
          <div className="form-group">
            <label className="form-label" htmlFor="formula-editor-rest">
              {t('formula.rest_time')}
            </label>
            <input
              id="formula-editor-rest"
              type="number"
              className="form-input"
              min={0}
              value={rest}
              onChange={e =>
                onCustomChange({
                  ...custom,
                  restTimeSeconds: Math.max(0, parseInt(e.target.value, 10) || 0),
                })
              }
            />
          </div>
        )}
      </details>
    );
  }

  return (
    <div className="formula-editor" data-testid="formula-editor">
      <nav className="formula-frieze" aria-label={t('properties.frieze_label')}>
        {frieze}
      </nav>

      {isOther && specialMode && (
        <div className="card formula-builder-3">
          <strong>{t(`rapieres.mode_${specialMode}`)}</strong>
          <p className="formula-builder-4">{t('rapieres.mode_description')}</p>
        </div>
      )}
      {isOther && !specialMode && renderOtherPhase()}
      {!isOther && (
        <PropertiesFormulaTab
          draft={draft}
          onChange={onDraftChange}
          weapon={weapon}
          category={category}
          controlledPhase={toPhaseId(current)}
        />
      )}
      {isOther && renderOtherGeneral()}
    </div>
  );
};

export default FormulaEditor;
