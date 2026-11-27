/**
 * BPM - Escrime - Validation de la formule (docs/adr/0012)
 * Une seule fonction, appelée par le moteur à chaque écriture de réglages (création,
 * modification) ; l'écran peut l'appeler pour afficher les erreurs. Pure : rend la liste des
 * écarts, sans lever.
 * Licensed under GPL-3.0
 */
import type { CompetitionSettings, CustomFormulaConfig, FormulaPhaseNode } from '../../types';
import { MAX_POOL_ROUNDS } from './formulaDraft';
import { FormulaScope, MAX_SCORE_LIMITS, maxScoreLimits } from './laserMaxScores';
import { tiesIssue } from '../ranking/advancement';

export { maxScoreLimits };
export type { FormulaScope };

export interface FormulaIssue {
  /** Réglage en cause (chemin pointé : customFormula.phases[0].config.maxScore) */
  field: string;
  message: string;
}

/** Bornes de la formule : une seule déclaration (alignée sur database/validation.ts) */
export const FORMULA_LIMITS = {
  poolMaxScore: MAX_SCORE_LIMITS.pool,
  tableMaxScore: MAX_SCORE_LIMITS.table,
  poolRounds: { min: 1, max: MAX_POOL_ROUNDS },
  poolSize: { min: 3, max: 64 },
  timerSeconds: { min: 1, max: 3600 },
} as const;

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const PHASE_TYPES = ['pool_round', 'direct_elimination', 'classification'];
const ADVANCEMENT = ['all', 'percentage', 'fixed_count', 'fixed_bracket', 'pool_winner'];

function range(
  out: FormulaIssue[],
  field: string,
  v: unknown,
  { min, max }: { min: number; max?: number }
) {
  if (v === undefined) return;
  if (!isInt(v) || v < min || (max !== undefined && v > max)) {
    out.push({
      field,
      message: max !== undefined ? `entier de ${min} à ${max} attendu` : `entier ≥ ${min} attendu`,
    });
  }
}

function checkPhase(out: FormulaIssue[], node: FormulaPhaseNode, i: number) {
  const at = `customFormula.phases[${i}]`;
  if (typeof node?.id !== 'string' || !node.id) {
    out.push({ field: `${at}.id`, message: 'identifiant requis' });
  }
  if (!PHASE_TYPES.includes(node?.type)) {
    out.push({ field: `${at}.type`, message: `type attendu : ${PHASE_TYPES.join(', ')}` });
    return;
  }
  const c = (node.config ?? {}) as unknown as Record<string, unknown>;
  range(out, `${at}.config.maxScore`, c.maxScore, { min: 1, max: 99 });
  range(out, `${at}.config.timerSeconds`, c.timerSeconds, FORMULA_LIMITS.timerSeconds);
  if (node.type === 'pool_round') {
    range(out, `${at}.config.minPoolSize`, c.minPoolSize, FORMULA_LIMITS.poolSize);
    range(out, `${at}.config.maxPoolSize`, c.maxPoolSize, FORMULA_LIMITS.poolSize);
    if (isInt(c.minPoolSize) && isInt(c.maxPoolSize) && c.maxPoolSize < c.minPoolSize) {
      out.push({ field: `${at}.config.maxPoolSize`, message: 'inférieur à la taille minimum' });
    }
    const rule = c.advancementRule as { mode?: string; percentage?: number; count?: number };
    if (rule !== undefined) {
      if (!ADVANCEMENT.includes(rule?.mode ?? '')) {
        out.push({ field: `${at}.config.advancementRule.mode`, message: 'mode inconnu' });
      } else if (rule.mode === 'percentage') {
        range(out, `${at}.config.advancementRule.percentage`, rule.percentage, {
          min: 1,
          max: 100,
        });
      } else if (rule.mode === 'fixed_count' || rule.mode === 'fixed_bracket') {
        range(out, `${at}.config.advancementRule.count`, rule.count, { min: 1 });
      }
      // Ex aequo à la barre (ADR-0040) : 'barrage' attend le lot F1b
      const ties = tiesIssue((rule as { ties?: unknown }).ties);
      if (ties) out.push({ field: `${at}.config.advancementRule.ties`, message: ties });
    }
  }
  if (node.type === 'direct_elimination' && c.bracketSizeOverride !== undefined) {
    const n = c.bracketSizeOverride;
    if (!isInt(n) || n < 2 || (n & (n - 1)) !== 0) {
      out.push({ field: `${at}.config.bracketSizeOverride`, message: 'puissance de 2 attendue' });
    }
  }
}

function checkCustomFormula(out: FormulaIssue[], f: CustomFormulaConfig) {
  if (f.version !== 1) out.push({ field: 'customFormula.version', message: 'version 1 attendue' });
  if (!Array.isArray(f.phases) || f.phases.length === 0) {
    out.push({ field: 'customFormula.phases', message: 'au moins une phase' });
    return;
  }
  f.phases.forEach((node, i) => checkPhase(out, node, i));
  const ids = f.phases.map(p => p?.id);
  if (new Set(ids).size !== ids.length) {
    out.push({ field: 'customFormula.phases', message: 'identifiants de phase en double' });
  }
}

/**
 * Écarts de la formule. `fields` : seuls les réglages modifiés sont jugés (une épreuve 2.0 aux
 * réglages anciens hors bornes reste modifiable pour le reste, ADR-0012) ; absent : tout.
 */
export function validateFormulaSettings(
  settings: Partial<CompetitionSettings>,
  fields?: ReadonlyArray<keyof CompetitionSettings>,
  scope: FormulaScope = {}
): FormulaIssue[] {
  const out: FormulaIssue[] = [];
  const s = settings;
  const scoreLimits = maxScoreLimits(scope);
  range(out, 'defaultPoolMaxScore', s.defaultPoolMaxScore, scoreLimits.pool);
  range(out, 'defaultTableMaxScore', s.defaultTableMaxScore, scoreLimits.table);
  range(out, 'defaultPoolTimerSeconds', s.defaultPoolTimerSeconds, FORMULA_LIMITS.timerSeconds);
  range(out, 'defaultTableTimerSeconds', s.defaultTableTimerSeconds, FORMULA_LIMITS.timerSeconds);
  range(out, 'restTimeSeconds', s.restTimeSeconds, { min: 0, max: 3600 });
  range(out, 'poolRounds', s.poolRounds, FORMULA_LIMITS.poolRounds);
  if (s.poolRoundQualifiers !== undefined) {
    s.poolRoundQualifiers.forEach((n, i) =>
      range(out, `poolRoundQualifiers[${i}]`, n, { min: 0, max: 10000 })
    );
    if (isInt(s.poolRounds) && s.poolRoundQualifiers.length > Math.max(0, s.poolRounds - 1)) {
      out.push({
        field: 'poolRoundQualifiers',
        message: 'plus de valeurs que de tours suivants',
      });
    }
  }
  range(out, 'poolSizeMin', s.poolSizeMin, FORMULA_LIMITS.poolSize);
  range(out, 'poolSizeMax', s.poolSizeMax, FORMULA_LIMITS.poolSize);
  if (isInt(s.poolSizeMin) && isInt(s.poolSizeMax) && s.poolSizeMax < s.poolSizeMin) {
    out.push({ field: 'poolSizeMax', message: 'inférieur à la taille minimum' });
  }
  range(out, 'defaultRanking', s.defaultRanking, { min: 0 });
  range(out, 'minTeamSize', s.minTeamSize, { min: 1 });
  range(out, 'teamReserveCount', s.teamReserveCount, { min: 0 });
  range(out, 'teamRelayStepSize', s.teamRelayStepSize, { min: 1 });
  if (s.questConfig?.enabled) {
    range(out, 'questConfig.qualifiersCount', s.questConfig.qualifiersCount, { min: 2 });
    range(out, 'questConfig.fightsPerFencer', s.questConfig.fightsPerFencer, { min: 1 });
  }
  if (s.customFormula !== undefined) checkCustomFormula(out, s.customFormula);
  if (!fields) return out;
  const judged = new Set<string>(fields as readonly string[]);
  // poolRoundQualifiers dépend de poolRounds : changer l'un juge l'autre
  if (judged.has('poolRounds')) judged.add('poolRoundQualifiers');
  if (judged.has('poolSizeMin')) judged.add('poolSizeMax');
  return out.filter(i => judged.has(i.field.split(/[.[]/)[0]));
}
