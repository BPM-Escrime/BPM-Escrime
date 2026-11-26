/**
 * BPM - Escrime - Interface unique de la formule (#2013 B1, C ; docs/adr/0032, 0034)
 * Nouvelle interface (réglage du poste `formulaPreview`) sur la formule v2, pour toutes les
 * armes : frise Appel → phases → Classement final, « ＋ » limité aux briques autorisées,
 * réglages **de chaque tour**, scission en compétitions filles (ADR-0039), relevé de cohérence et
 * simulation. Même composant à la création et
 * dans Organisation ▸ Formule. Règles : shared/domain/formula/formulaV2Operations.ts.
 * Licensed under GPL-3.0
 */

import React, { useState } from 'react';
import { Plus, TriangleAlert, X } from 'lucide-react';
import {
  AdvancementMode,
  AdvancementRule,
  Category,
  CompetitionSpecialMode,
  CustomScoringConfig,
  PoolBoutOrder,
  Weapon,
} from '../../../shared/types';
import type { FriezeBrick, FriezePhase } from '../../../shared/domain/formula/formulaFrieze';
import {
  coupledFormula,
  isCoupledSplit,
  playedTableauOf,
  splitOf,
  uncoupledFormula,
  type FormulaV2,
  type PoolRoundPhase,
  type QuestPhase,
  type SplitPhase,
  type TableauPhase,
} from '../../../shared/domain/formula/formulaV2';
import { simulateSplit } from '../../../shared/domain/formula/splitPlan';
import { isWavesOrder, wavesSizeBounds } from '../../../shared/domain/pools/waves';
import { bricksForLevel, formulaNeedsExpert } from '../../../shared/domain/formula/formulaExpert';
import type { FormulaProgress, FormulaRemark } from '../../../shared/domain/formula/formulaRemarks';
import {
  canRemoveV2,
  formulaV2Issues,
  formulaViewV2,
  friezeOfV2,
  insertOptionsV2,
  insertV2,
  removeV2,
  simulationFormulaOf,
  TABLEAU_STOP_AT,
} from '../../../shared/domain/formula/formulaV2Operations';
import { isOlympicWeapon } from '../../../shared/utils/defaultMaxScores';
import { simulateFormula } from '../../../shared/utils/customRankingCalculator';
import { useTranslation } from '../../hooks/useTranslation';
import { useDurationSources } from '../../hooks/useDurationSources';
import { useFormulaExpert } from '../../hooks/useFormulaExpert';
import { Button } from '../common/Button';
import { Icon } from '../common/Icon';
import { AdvancementRuleEditor } from './AdvancementRuleEditor';
import { ScoringZoneEditor } from './ScoringZoneEditor';
import { FormulaSimulationPreview } from './FormulaSimulationPreview';
import { SplitPhaseEditor } from './SplitPhaseEditor';

/** Taille d'une poule hors tour en vagues */
const POOL_SIZE = { min: 3, max: 64 } as const;

export interface FormulaEditorProps {
  weapon: Weapon;
  category: Category;
  formula: FormulaV2;
  onChange: (formula: FormulaV2) => void;
  /** Mode spécial de l'arme « Autre » (création seulement, #1118) */
  specialMode?: CompetitionSpecialMode;
  onSpecialModeChange?: (mode: CompetitionSpecialMode | undefined) => void;
  /** Épreuve des rapières existante : qualification sans effet, grisée */
  rapieres?: boolean;
  /** Effectif de départ de la simulation (modifiable dans le panneau) */
  fencerCount?: number;
  /** Épreuve par équipes (bornes des réglages) */
  isTeamEvent?: boolean;
  /** Effectif connu de l'épreuve (S4, somme des parts d'une scission) ; absent : inconnu */
  knownFencerCount?: number;
  /** Phases déjà commencées de l'épreuve (S6) ; absent : création, rien de commencé */
  progress?: FormulaProgress;
  /** Remarques déjà jugées par l'appelant (bouton Enregistrer) ; absent : jugées ici */
  remarks?: FormulaRemark[];
}

const SPECIAL_MODES: CompetitionSpecialMode[] = ['rapieres'];
/** Qualification vers le tableau du mode spécial rapières : tous, ou demi-finales (docs/adr/0043) */
const RAPIERES_QUALIFICATIONS: readonly AdvancementMode[] = ['all', 'pool_heads'];

const newPhaseId = () => `phase_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

const int = (v: string, fallback: number) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};

export const FormulaEditor: React.FC<FormulaEditorProps> = ({
  weapon,
  category,
  formula,
  onChange,
  specialMode,
  onSpecialModeChange,
  rapieres,
  fencerCount = 32,
  isTeamEvent,
  knownFencerCount,
  progress,
  remarks: judged,
}) => {
  const { t } = useTranslation();
  // Mode expert (ADR-0041) : préférence du poste, rallumée pour cette édition quand la formule
  // contient une brique ou un réglage expert (la préférence ne change pas)
  const { expert: preferred, setExpert } = useFormulaExpert();
  // Formule ouverte avec de l'expert : rallumé pour toute l'édition, même si la brique est
  // retirée ensuite ; une brique experte ajoutée garde aussi le mode
  const [openedExpert] = useState(() => formulaNeedsExpert(formula));
  const forced = openedExpert || formulaNeedsExpert(formula);
  const expert = preferred || forced;
  const isOther = weapon === Weapon.CUSTOM;
  const phases = friezeOfV2(formula);
  const [selectedKey, setSelectedKey] = useState<string>(phases[0]?.key ?? '');
  const [openPlus, setOpenPlus] = useState<number | null>(null);
  const [simCount, setSimCount] = useState(fencerCount);
  const durationSources = useDurationSources();
  const current = phases.find(p => p.key === selectedKey) ?? phases[0];
  const pools = formula.phases.filter((p): p is PoolRoundPhase => p.kind === 'pool');
  const view = formulaViewV2({ weapon, category, settings: { formula } });
  // Jugement en direct (ADR-0041) : mêmes fonctions que le moteur, remarques situées
  const remarks =
    judged ??
    formulaV2Issues(formula, { weapon, isTeamEvent, fencerCount: knownFencerCount }, progress);
  const remarksOf = (key: string) => remarks.filter(r => r.phase === key);
  // Formule entière (phase null) ou phase absente de la frise (retirée) : en tête
  const headRemarks = remarks.filter(r => r.phase === null || !phases.some(p => p.key === r.phase));
  const categoryLabel = t(`categories.${category === Category.SENIOR ? 'senior' : category}`);

  const insert = (brick: FriezeBrick, at: number) => {
    onChange(insertV2(formula, { weapon, category }, brick, at, newPhaseId));
    setSelectedKey(brick === 'pool' ? `pool-${at}` : brick);
    setOpenPlus(null);
  };
  const remove = (p: FriezePhase) => {
    onChange(removeV2(formula, p));
    setSelectedKey(phases[0]?.key ?? '');
  };

  /** Remplace, dans la formule, la phase `p` de la frise */
  const patchPhase = <T extends PoolRoundPhase | TableauPhase | QuestPhase>(
    p: FriezePhase,
    patch: Partial<T>
  ) => {
    let round = -1;
    onChange({
      ...formula,
      phases: formula.phases.map(x => {
        const hit =
          p.kind === 'pool' ? x.kind === 'pool' && ++round === p.round : x.kind === p.kind;
        return hit ? ({ ...x, ...patch } as typeof x) : x;
      }),
    });
  };
  const patchGeneral = (patch: Partial<FormulaV2['general']>) =>
    onChange({ ...formula, general: { ...formula.general, ...patch } });

  const title = (p: FriezePhase) =>
    p.kind === 'pool'
      ? pools.length > 1
        ? t('properties.phase_pool_round', { n: p.round + 1 })
        : t('properties.phase_pools')
      : p.kind === 'quest'
        ? t('properties.quest_round')
        : p.kind === 'split'
          ? t('formulaEditor.brick_split')
          : t('properties.phase_tableau');

  const ownTableau = formula.phases.find((x): x is TableauPhase => x.kind === 'tableau');
  const split = formula.phases.find((x): x is SplitPhase => x.kind === 'split');
  // Tableau des branches restées dans l'épreuve (tableaux séparés, ADR-0039 E3) : réglé une fois
  const keptTableau = ownTableau ? undefined : playedTableauOf(formula);
  const tableau = ownTableau ?? keptTableau;
  const coupled = isCoupledSplit(split);
  /** Réglages du tableau des branches restées, les mêmes pour chacune */
  const patchKeptTableau = (patch: Partial<TableauPhase>) => {
    if (!split || !coupled) return;
    const next: SplitPhase = {
      ...split,
      branches: split.branches.map(b => ({
        ...b,
        phases: b.phases.map(x => (x.kind === 'tableau' ? { ...x, ...patch } : x)),
      })),
    };
    onChange({ ...formula, phases: formula.phases.map(x => (x === split ? next : x)) });
  };
  const summary = (p: FriezePhase): string => {
    if (p.kind === 'split')
      return split
        ? split.branches
            .map(b => b.label)
            .filter(Boolean)
            .join(' · ')
        : '';
    if (p.kind === 'pool') {
      const pool = pools[p.round];
      return pool
        ? t('properties.summary_pool', {
            min: pool.sizeMin,
            max: pool.sizeMax,
            score: pool.maxScore,
          })
        : '';
    }
    if (p.kind === 'quest' || !tableau) return '';
    return tableau.maxScore === 0
      ? t('properties.summary_tableau_unlimited')
      : t('properties.summary_tableau', { score: tableau.maxScore });
  };

  const plus = (at: number) => {
    const options = bricksForLevel(insertOptionsV2(formula, weapon, at), expert);
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
    const phaseRemarks = remarksOf(p.key);
    frieze.push(
      <span key={p.key} className="formula-editor__phase">
        <button
          type="button"
          data-testid={`formula-step-${p.key}`}
          className={`formula-frieze__step${selected ? ' is-selected' : ''}${phaseRemarks.length ? ' has-remark' : ''}`}
          aria-pressed={selected}
          onClick={() => setSelectedKey(p.key)}
        >
          <span className="formula-frieze__title">
            {phaseRemarks.length > 0 && (
              <span
                className="formula-frieze__remark"
                data-testid={`formula-remark-${p.key}`}
                title={phaseRemarks.map(r => r.message).join('\n')}
              >
                <Icon icon={TriangleAlert} label={t('formulaEditor.remark_on_phase')} />
              </span>
            )}
            {title(p)}
          </span>
          <span className="formula-frieze__summary">{summary(p)}</span>
        </button>
        {canRemoveV2(formula, p) && !specialMode && (
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

  const numberField = (
    id: string,
    label: string,
    value: number,
    onValue: (v: number) => void,
    opts: { min?: number; max?: number; hint?: string } = {}
  ) => (
    <div className="form-group">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        className="form-input"
        min={opts.min}
        max={opts.max}
        value={value}
        onChange={e => onValue(Math.max(opts.min ?? 0, int(e.target.value, opts.min ?? 0)))}
      />
      {opts.hint && <small className="u-hint">{opts.hint}</small>}
    </div>
  );

  function renderPool(p: FriezePhase & { kind: 'pool' }) {
    const pool = pools[p.round];
    if (!pool) return null;
    const isLast = p.round === pools.length - 1;
    const set = (patch: Partial<PoolRoundPhase>) => patchPhase<PoolRoundPhase>(p, patch);
    const id = `pool-${p.round}`;
    const sizeBounds = wavesSizeBounds(pool.boutOrder) ?? POOL_SIZE;
    return (
      <>
        <fieldset className="properties-group">
          <legend>{t('properties.group_essential')}</legend>
          <div className="formula-editor__grid">
            {numberField(
              `${id}-min`,
              t('properties.pool_size_min'),
              pool.sizeMin,
              v =>
                set({
                  sizeMin: Math.min(sizeBounds.max, Math.max(sizeBounds.min, v)),
                  sizeMax: Math.min(sizeBounds.max, Math.max(sizeBounds.min, v, pool.sizeMax)),
                }),
              { min: sizeBounds.min, max: sizeBounds.max }
            )}
            {numberField(
              `${id}-max`,
              t('properties.pool_size_max'),
              pool.sizeMax,
              v => set({ sizeMax: Math.min(sizeBounds.max, Math.max(pool.sizeMin, v)) }),
              { min: pool.sizeMin, max: sizeBounds.max }
            )}
            {numberField(
              `${id}-score`,
              t('properties.pool_max_score'),
              pool.maxScore,
              v => set({ maxScore: Math.max(1, v) }),
              { min: 1, hint: t('properties.pool_max_score_hint') }
            )}
            {numberField(
              `${id}-timer`,
              t('properties.pool_timer'),
              pool.timerSeconds,
              v => set({ timerSeconds: Math.max(1, v) }),
              { min: 1 }
            )}
          </div>
          <small className="u-hint">{t('properties.pool_size_hint')}</small>
          {/* Qualification : vers le tour suivant, ou vers le tableau pour toutes les armes
              (#2013 R1), ou vers la scission (ADR-0039) ; dernier tour sans suite : rien */}
          {(!isLast || isOther || tableau || split) && (
            <div className="form-group">
              <label className="form-label">{t('formulaPhase.advancement')}</label>
              {/* Rapières : tous qualifiés ou demi-finales (têtes de poule 4) ; la fenêtre du
                  passage au tableau est retirée, la formule décide (docs/adr/0043, F4b) */}
              <AdvancementRuleEditor
                rule={pool.qualification}
                onChange={(rule: AdvancementRule) => set({ qualification: rule })}
                inputFencers={simCount}
                expert={expert}
                headsAvailable={
                  formula.phases[formula.phases.indexOf(pool) + 1]?.kind === 'tableau' &&
                  (expert || !!rapieres || !!specialMode)
                }
                only={rapieres || specialMode ? RAPIERES_QUALIFICATIONS : undefined}
              />
            </div>
          )}
        </fieldset>
        {expert && (
          <details className="properties-expert" data-testid={`${id}-expert`}>
            <summary>{t('properties.expert_settings')}</summary>
            {p.round > 0 && (
              <div className="form-group">
                <label htmlFor={`${id}-seeding`}>{t('formulaEditor.seeding')}</label>
                <select
                  id={`${id}-seeding`}
                  className="form-input form-select"
                  value={pool.seeding}
                  onChange={e => set({ seeding: e.target.value as PoolRoundPhase['seeding'] })}
                >
                  <option value="previous_round">{t('formulaEditor.seeding_previous')}</option>
                  <option value="cumulative">{t('formulaEditor.seeding_cumulative')}</option>
                </select>
                <small className="u-hint">{t('formulaEditor.seeding_hint')}</small>
              </div>
            )}
            <div className="form-group">
              <label htmlFor={`${id}-order`}>{t('properties.bout_order')}</label>
              <select
                id={`${id}-order`}
                className="form-input form-select"
                value={pool.boutOrder}
                onChange={e => {
                  const boutOrder = e.target.value as PoolBoutOrder;
                  // Tour en vagues : poules de 2 à 10 (vagues classiques : 15) tireurs (docs/adr/0043) ; sinon 3 à 64
                  const bounds = wavesSizeBounds(boutOrder) ?? POOL_SIZE;
                  const fit = (n: number) => Math.min(bounds.max, Math.max(bounds.min, n));
                  set({ boutOrder, sizeMin: fit(pool.sizeMin), sizeMax: fit(pool.sizeMax) });
                }}
              >
                <option value="fie">{t('properties.bout_order_fie')}</option>
                {/* Arme « Autre » : ordre libre non proposé (réglage plat non reporté) */}
                {!isOther && <option value="free">{t('properties.bout_order_free')}</option>}
                <option value="waves">{t('properties.bout_order_waves')}</option>
                <option value="waves_classic">{t('properties.bout_order_waves_classic')}</option>
              </select>
              <small className="u-hint">{t('properties.bout_order_hint')}</small>
              {isWavesOrder(pool.boutOrder) && (
                <small className="u-hint">{t('properties.bout_order_waves_hint')}</small>
              )}
            </div>
            {isOther && (
              <div className="form-group">
                <label className="form-label">{t('formulaPhase.scoring')}</label>
                <ScoringZoneEditor
                  scoring={pool.scoring ?? { type: 'standard', maxScore: pool.maxScore }}
                  onChange={(s: CustomScoringConfig) => set({ scoring: s })}
                />
              </div>
            )}
          </details>
        )}
      </>
    );
  }

  function renderTableau(p: FriezePhase) {
    if (!tableau) return null;
    const set = (patch: Partial<TableauPhase>) =>
      ownTableau ? patchPhase<TableauPhase>(p, patch) : patchKeptTableau(patch);
    // Tableau arrêté à N (ADR-0037) : un tour de poules le suit ; sans arrêt, plus de tour après
    const setStopAt = (n: number) => {
      const at = formula.phases.indexOf(tableau);
      const { stopAt: _old, ...rest } = tableau;
      let next: FormulaV2 = {
        ...formula,
        phases: formula.phases.map(x => (x === tableau ? (n ? { ...rest, stopAt: n } : rest) : x)),
      };
      // Tour de poules ou scission (ADR-0039) après le tableau arrêté
      const hasAfter = next.phases.slice(at + 1).some(x => x.kind === 'pool' || x.kind === 'split');
      if (n && !hasAfter) next = insertV2(next, { weapon, category }, 'pool', at + 1, newPhaseId);
      if (!n) next = { ...next, phases: next.phases.slice(0, at + 1) };
      onChange(next);
    };
    return (
      <>
        <fieldset className="properties-group">
          <legend>{t('properties.group_essential')}</legend>
          <div className="formula-editor__grid">
            {numberField(
              'tableau-score',
              t('properties.table_max_score'),
              tableau.maxScore,
              v => set({ maxScore: Math.max(0, v) }),
              { min: 0, hint: t('properties.table_max_score_hint') }
            )}
            {numberField(
              'tableau-timer',
              t('properties.table_timer'),
              tableau.timerSeconds,
              v => set({ timerSeconds: Math.max(1, v) }),
              { min: 1 }
            )}
          </div>
          <label className="u-row cursor-pointer">
            <input
              type="checkbox"
              checked={tableau.thirdPlace}
              onChange={e => set({ thirdPlace: e.target.checked })}
            />
            <span>{t('competition.third_place_match_label')}</span>
          </label>
        </fieldset>
        <details className="properties-expert">
          <summary>{t('properties.expert_settings')}</summary>
          <label className="u-row cursor-pointer">
            <input
              type="checkbox"
              checked={tableau.allPlaces}
              onChange={e => set({ allPlaces: e.target.checked })}
            />
            <span>{t('properties.all_places')}</span>
          </label>
          <small className="u-hint">{t('properties.all_places_hint')}</small>
          {expert && ownTableau && !formula.phases.some(x => x.kind === 'quest') && (
            <div className="form-group">
              <label htmlFor="tableau-stop-at" className="form-label">
                {t('formulaEditor.stop_at')}
              </label>
              <select
                id="tableau-stop-at"
                className="form-input form-select"
                value={tableau.stopAt ?? 0}
                onChange={e => setStopAt(Number(e.target.value))}
              >
                <option value={0}>{t('formulaEditor.stop_at_none')}</option>
                {TABLEAU_STOP_AT.map(n => (
                  <option key={n} value={n}>
                    {t('formulaEditor.stop_at_n', { n })}
                  </option>
                ))}
              </select>
              <small className="u-hint">{t('formulaEditor.stop_at_hint')}</small>
            </div>
          )}
          {expert && isOther && (
            <div className="form-group">
              <label className="form-label">{t('formulaPhase.scoring')}</label>
              <ScoringZoneEditor
                scoring={tableau.scoring ?? { type: 'standard', maxScore: tableau.maxScore }}
                onChange={(s: CustomScoringConfig) => set({ scoring: s })}
              />
            </div>
          )}
        </details>
      </>
    );
  }

  function renderQuest(p: FriezePhase) {
    const quest = formula.phases.find((x): x is QuestPhase => x.kind === 'quest');
    if (!quest) return null;
    return (
      <fieldset className="properties-group">
        <legend>{t('properties.quest_round')}</legend>
        {quest.config.hasPreliminaryPools &&
          numberField(
            'quest-qualified',
            t('properties.quest_qualified'),
            quest.config.qualifiersCount ?? 8,
            v =>
              patchPhase<QuestPhase>(p, {
                config: { ...quest.config, qualifiersCount: Math.max(2, v) },
              }),
            { min: 2 }
          )}
        <small className="u-hint">
          {quest.config.hasPreliminaryPools
            ? t('properties.quest_with_pools')
            : t('properties.quest_without_pools')}
        </small>
      </fieldset>
    );
  }

  function renderGeneral() {
    const ruleSet = formula.general.ruleSet ?? (rapieres || specialMode ? 'modern' : 'laser');
    const showRest = isOlympicWeapon(weapon) || (isOther && ruleSet === 'modern');
    // Compétition couplée = scission par sexe : brique expert
    const showCoupled =
      expert && !isOther && pools.length > 0 && ((ownTableau && !split) || coupled);
    if (!isOther && !showRest && !showCoupled) return null;
    return (
      <details className="properties-expert formula-editor__general">
        <summary>{t('properties.formula_general')}</summary>
        {isOther && onSpecialModeChange && (
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
        {isOther && (
          <div className="form-group">
            <label className="form-label" htmlFor="formula-editor-rule-set">
              {t('formula.rule_set')}
            </label>
            <select
              id="formula-editor-rule-set"
              className="form-input form-select"
              value={ruleSet}
              onChange={e => patchGeneral({ ruleSet: e.target.value as 'modern' | 'laser' })}
            >
              <option value="laser">{t('formula.rule_set_laser')}</option>
              <option value="modern">{t('formula.rule_set_modern')}</option>
            </select>
          </div>
        )}
        {showRest &&
          numberField(
            'formula-editor-rest',
            t('properties.rest_time'),
            formula.general.restTimeSeconds ?? 60,
            v => patchGeneral({ restTimeSeconds: Math.max(0, v) }),
            { min: 0, hint: t('properties.rest_time_hint') }
          )}
        {showCoupled && (
          <div className="form-group">
            <label htmlFor="formula-editor-coupled">{t('properties.coupled')}</label>
            {/* Compétition couplée = scission par sexe dont les branches restent (ADR-0039 E3) */}
            <select
              id="formula-editor-coupled"
              className="form-input form-select"
              value={coupled || formula.general.postPoolSplitCriteria ? 'gender' : ''}
              onChange={e =>
                onChange(
                  e.target.value
                    ? coupledFormula({
                        ...formula,
                        general: { ...formula.general, postPoolSplitCriteria: 'gender' },
                      })
                    : uncoupledFormula({
                        ...formula,
                        general: { ...formula.general, postPoolSplitCriteria: undefined },
                      })
                )
              }
            >
              <option value="">{t('properties.coupled_none')}</option>
              <option value="gender">{t('properties.coupled_gender')}</option>
            </select>
            <small className="u-hint">{t('properties.coupled_hint')}</small>
          </div>
        )}
      </details>
    );
  }

  function renderCoherence() {
    if (isOther) return null;
    const issues = view.coherence;
    return (
      <div
        className={`formula-coherence${issues.length ? ' has-issues' : ''}`}
        data-testid="formula-coherence"
      >
        <strong>{t('properties.coherence_title')}</strong>
        {issues.length === 0 ? (
          <p>{t('properties.coherence_ok', { category: categoryLabel })}</p>
        ) : (
          <ul>
            {issues.map(issue => (
              <li key={issue.field}>
                {t(
                  issue.field === 'poolMaxScore'
                    ? 'properties.coherence_pools'
                    : 'properties.coherence_tableau',
                  { actual: issue.actual, expected: issue.expected, category: categoryLabel }
                )}{' '}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    issue.field === 'tableMaxScore' && keptTableau
                      ? patchKeptTableau({ maxScore: issue.expected })
                      : onChange({
                          ...formula,
                          phases: formula.phases.map(x =>
                            (issue.field === 'poolMaxScore' && x.kind === 'pool') ||
                            (issue.field === 'tableMaxScore' && x.kind === 'tableau')
                              ? { ...x, maxScore: issue.expected }
                              : x
                          ),
                        })
                  }
                >
                  {t('properties.coherence_apply')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <small className="u-hint">{t('properties.coherence_source')}</small>
      </div>
    );
  }

  /** Remarques bloquantes (ADR-0041) : sur la carte de la phase, ou en tête pour la formule */
  function renderRemarks(list: FormulaRemark[], testId: string) {
    if (list.length === 0) return null;
    return (
      <div className="formula-coherence has-issues is-blocking" data-testid={testId} role="alert">
        <ul>
          {list.map(r => (
            <li key={`${r.code}-${r.message}`}>{r.message}</li>
          ))}
        </ul>
      </div>
    );
  }

  const simulation = simulateFormula(
    simCount,
    simulationFormulaOf(formula),
    weapon,
    durationSources
  );
  // Scission (ADR-0039) : effectif entrant = qualifiés du dernier tour de poules simulé
  const pendingSplit = splitOf(formula);
  const lastPool = [...simulation.phases].reverse().find(p => p.type === 'pool_round');
  const simulatedSplit = pendingSplit
    ? simulateSplit(pendingSplit, lastPool?.advancingFencers ?? simCount)
    : undefined;

  return (
    <div className="formula-editor" data-testid="formula-editor">
      {!specialMode && (
        <div className="formula-editor__expert">
          <label className="u-row cursor-pointer">
            <input
              type="checkbox"
              data-testid="formula-expert-toggle"
              checked={expert}
              disabled={forced}
              onChange={e => setExpert(e.target.checked)}
            />
            <span>{t('formulaEditor.expert_mode')}</span>
          </label>
          <small className="u-hint">
            {forced ? t('formulaEditor.expert_forced') : t('formulaEditor.expert_hint')}
          </small>
        </div>
      )}
      {renderRemarks(headRemarks, 'formula-remarks')}
      <nav className="formula-frieze" aria-label={t('properties.frieze_label')}>
        {frieze}
      </nav>

      <div className="formula-builder-content">
        <div className="formula-editor__settings">
          {isOther && specialMode ? (
            <div className="card formula-builder-3">
              <strong>{t(`rapieres.mode_${specialMode}`)}</strong>
              <p className="formula-builder-4">{t('rapieres.mode_description')}</p>
            </div>
          ) : (
            <>
              {current &&
                current.kind !== 'split' &&
                renderRemarks(remarksOf(current.key), 'phase-remarks')}
              {current?.kind === 'pool' && renderPool(current)}
              {current?.kind === 'tableau' && renderTableau(current)}
              {current?.kind === 'quest' && renderQuest(current)}
              {current?.kind === 'split' && split && (
                <SplitPhaseEditor
                  split={split}
                  weapon={weapon}
                  category={category}
                  newId={newPhaseId}
                  remarks={remarksOf('split')}
                  onChange={next =>
                    onChange({
                      ...formula,
                      phases: formula.phases.map(x => (x === split ? next : x)),
                    })
                  }
                />
              )}
              {current?.kind === 'split' && keptTableau && (
                <div data-testid="split-kept-tableau">{renderTableau(current)}</div>
              )}
            </>
          )}
          {renderGeneral()}
          {renderCoherence()}
        </div>
        {!specialMode && (
          <aside className="formula-simulation-panel" data-testid="formula-simulation">
            <label className="form-label formula-editor__sim-count">
              {t('formulaEditor.sim_fencers')}
              <input
                type="number"
                className="form-input"
                min={2}
                max={512}
                value={simCount}
                onChange={e =>
                  setSimCount(Math.min(512, Math.max(2, parseInt(e.target.value, 10) || 2)))
                }
              />
            </label>
            <FormulaSimulationPreview
              simulation={simulation}
              fencerCount={simCount}
              split={simulatedSplit}
            />
          </aside>
        )}
      </div>
    </div>
  );
};

export default FormulaEditor;
