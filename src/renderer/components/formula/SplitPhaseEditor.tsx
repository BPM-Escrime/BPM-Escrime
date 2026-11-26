/**
 * BPM - Escrime - Réglages de la brique Scission dans l'éditeur de formule (#2013 étape E2b,
 * docs/adr/0039) : critère (sexe, catégorie, rang), branches (libellé, modèle, valeur du
 * critère), ajout et retrait. Étape E3 : répartition manuelle (libellé et modèle ; les tireurs
 * sont affectés au lancement, SplitLaunchDialog) ; scission par sexe, branche « Tableau » restée
 * dans l'épreuve (tableaux séparés, ADR-0024).
 * Règles : shared/domain/formula/formulaV2Operations.ts (withSplitCriterion, addSplitBranch…).
 * Licensed under GPL-3.0
 */

import React from 'react';
import { Plus, X } from 'lucide-react';
import { AdvancementRule, Category, Gender, Weapon } from '../../../shared/types';
import type {
  SplitBranch,
  SplitCriterion,
  SplitPhase,
} from '../../../shared/domain/formula/formulaV2';
import {
  addSplitBranch,
  branchPhases,
  branchPresetOf,
  removeSplitBranch,
  splitIssues,
  withSplitCriterion,
  type BranchPreset,
} from '../../../shared/domain/formula/formulaV2Operations';
import { useTranslation } from '../../hooks/useTranslation';
import { Button } from '../common/Button';

interface SplitPhaseEditorProps {
  split: SplitPhase;
  weapon: Weapon;
  category: Category;
  onChange: (split: SplitPhase) => void;
  newId: () => string;
}

/** Critères réglables à l'écran (manuelle : étape E3) */
const CRITERIA: SplitCriterion[] = ['gender', 'category', 'rank', 'manual'];
const PRESETS: BranchPreset[] = ['tableau', 'pools_tableau', 'pools'];
const CATEGORIES = Object.values(Category);
const categoryKey = (c: Category) => `categories.${c === Category.SENIOR ? 'senior' : c}`;

export const SplitPhaseEditor: React.FC<SplitPhaseEditorProps> = ({
  split,
  weapon,
  category,
  onChange,
  newId,
}) => {
  const { t } = useTranslation();
  const ctx = { weapon, category };
  const issues = splitIssues(split, { weapon });
  const last = split.branches.length - 1;

  const setBranch = (i: number, patch: Partial<SplitBranch>) =>
    onChange({
      ...split,
      branches: split.branches.map((b, k) => (k === i ? { ...b, ...patch } : b)),
    });

  const takeField = (b: SplitBranch, i: number) => {
    if (i === last) return <p className="formula-split__rest">{t('formulaEditor.split_rest')}</p>;
    const take: AdvancementRule = b.take ?? { mode: 'fixed_count', count: 16 };
    const pct = take.mode === 'percentage';
    return (
      <div className="formula-split__take">
        <select
          className="form-input form-select"
          aria-label={t('formulaEditor.split_take')}
          data-testid={`split-take-mode-${i}`}
          value={take.mode}
          onChange={e =>
            setBranch(i, {
              take:
                e.target.value === 'percentage'
                  ? { mode: 'percentage', percentage: 50 }
                  : { mode: 'fixed_count', count: 16 },
            })
          }
        >
          <option value="fixed_count">{t('advancement.mode_fixed_count')}</option>
          <option value="percentage">{t('advancement.mode_percentage')}</option>
        </select>
        <input
          type="number"
          className="form-input"
          aria-label={t('formulaEditor.split_take')}
          data-testid={`split-take-${i}`}
          min={1}
          max={pct ? 99 : 999}
          value={(pct ? take.percentage : take.count) ?? ''}
          onChange={e => {
            const v = parseInt(e.target.value, 10) || 0;
            setBranch(i, { take: pct ? { ...take, percentage: v } : { ...take, count: v } });
          }}
        />
        <span>{pct ? '%' : t('formulaSim.fencers')}</span>
      </div>
    );
  };

  const genderField = (b: SplitBranch, i: number) => (
    <select
      className="form-input form-select"
      aria-label={t('formulaEditor.split_gender')}
      data-testid={`split-gender-${i}`}
      value={b.gender ?? ''}
      onChange={e => setBranch(i, { gender: (e.target.value || undefined) as Gender })}
    >
      <option value="">—</option>
      <option value={Gender.MALE}>{t('formulaEditor.split_gender_male')}</option>
      <option value={Gender.FEMALE}>{t('formulaEditor.split_gender_female')}</option>
    </select>
  );

  const categoryField = (b: SplitBranch, i: number) => (
    <div
      className="formula-split__categories"
      role="group"
      aria-label={t('formulaEditor.split_categories')}
    >
      {CATEGORIES.map(c => {
        const on = b.categories?.includes(c) ?? false;
        return (
          <label key={c} className="u-row cursor-pointer">
            <input
              type="checkbox"
              data-testid={`split-category-${i}-${c}`}
              checked={on}
              onChange={() =>
                setBranch(i, {
                  categories: on
                    ? (b.categories ?? []).filter(x => x !== c)
                    : CATEGORIES.filter(x => x === c || b.categories?.includes(x)),
                })
              }
            />
            <span>{t(categoryKey(c))}</span>
          </label>
        );
      })}
    </div>
  );

  return (
    <fieldset className="properties-group formula-split" data-testid="formula-split">
      <legend>{t('formulaEditor.brick_split')}</legend>
      <div className="form-group">
        <label htmlFor="split-criterion">{t('formulaEditor.split_criterion')}</label>
        <select
          id="split-criterion"
          className="form-input form-select"
          value={split.criterion}
          onChange={e => onChange(withSplitCriterion(split, e.target.value as SplitCriterion))}
        >
          {CRITERIA.map(c => (
            <option key={c} value={c}>
              {t(`formulaEditor.split_criterion_${c}`)}
            </option>
          ))}
        </select>
        {split.criterion === 'manual' && (
          <small className="u-hint" data-testid="split-manual-hint">
            {t('formulaEditor.split_manual_hint')}
          </small>
        )}
      </div>
      <fieldset className="formula-split__branches">
        {split.branches.map((b, i) => {
          const preset = branchPresetOf(b.phases);
          return (
            <div key={i} className="formula-split__branch" data-testid={`split-branch-${i}`}>
              <div className="formula-split__branch-head">
                <strong>{t('formulaEditor.split_branch', { n: i + 1 })}</strong>
                {split.branches.length > 2 && (
                  <button
                    type="button"
                    className="formula-split__remove"
                    data-testid={`split-remove-${i}`}
                    aria-label={t('formulaEditor.split_remove_branch', { label: b.label })}
                    title={t('formulaEditor.split_remove_branch', { label: b.label })}
                    onClick={() => onChange(removeSplitBranch(split, i))}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                )}
              </div>
              <div className="formula-editor__grid">
                <div className="form-group">
                  <label htmlFor={`split-label-${i}`}>{t('formulaEditor.split_label')}</label>
                  <input
                    id={`split-label-${i}`}
                    className="form-input"
                    maxLength={100}
                    value={b.label}
                    onChange={e => setBranch(i, { label: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor={`split-preset-${i}`}>{t('formulaEditor.split_preset')}</label>
                  <select
                    id={`split-preset-${i}`}
                    className="form-input form-select"
                    value={preset ?? ''}
                    onChange={e => {
                      const next = e.target.value as BranchPreset;
                      setBranch(i, {
                        phases: branchPhases(next, ctx, newId),
                        // Rester dans l'épreuve : branche réduite à un tableau seulement
                        ...(next !== 'tableau' ? { stayInCompetition: undefined } : {}),
                      });
                    }}
                  >
                    {!preset && (
                      <option value="" disabled>
                        {t('formulaEditor.split_preset_custom')}
                      </option>
                    )}
                    {PRESETS.map(p => (
                      <option key={p} value={p}>
                        {t(`formulaEditor.split_preset_${p}`)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {split.criterion === 'rank' && takeField(b, i)}
              {split.criterion === 'gender' && genderField(b, i)}
              {split.criterion === 'gender' && preset === 'tableau' && (
                <label className="u-row cursor-pointer">
                  <input
                    type="checkbox"
                    data-testid={`split-stay-${i}`}
                    checked={!!b.stayInCompetition}
                    onChange={e =>
                      setBranch(i, { stayInCompetition: e.target.checked || undefined })
                    }
                  />
                  <span>{t('formulaEditor.split_stay')}</span>
                </label>
              )}
              {split.criterion === 'category' && categoryField(b, i)}
            </div>
          );
        })}
      </fieldset>
      <Button
        type="button"
        variant="ghost"
        data-testid="split-add-branch"
        onClick={() => onChange(addSplitBranch(split, ctx, newId))}
      >
        <Plus size={14} aria-hidden="true" /> {t('formulaEditor.split_add_branch')}
      </Button>
      <small className="u-hint">{t('formulaEditor.split_preset_hint')}</small>
      {issues.length > 0 && (
        <div className="formula-coherence has-issues" data-testid="split-issues" role="status">
          <strong>{t('formulaEditor.split_issues')}</strong>
          <ul>
            {issues.map(issue => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      )}
    </fieldset>
  );
};

export default SplitPhaseEditor;
