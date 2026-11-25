/**
 * BPM - Escrime - Frise de la formule : interface unique (#2013 étape B1, docs/adr/0032)
 * Phases affichées, briques autorisées à chaque « ＋ », insertion, retrait et résumé.
 * Deux modèles jusqu'à l'étape C de #2013 :
 * - `FormulaDraft` (épée, fleuret, sabre, Sabre Laser), réécrit en réglages plats ;
 * - `CustomFormulaConfig` (arme « Autre », code 'C'), réduit par `deriveSettingsFromFormula`.
 * Grammaire bridée sur ce que le moteur exécute (P2) : 1 à 5 tours de poules, Tour Quest
 * (Sabre Laser), au plus un tableau, toujours en dernier ; classement final implicite.
 * Domaine pur : identifiants de phase injectés (ADR-0002).
 * Licensed under GPL-3.0
 */

import {
  CustomDEConfig,
  CustomFormulaConfig,
  CustomPoolRoundConfig,
  FormulaPhaseNode,
  Weapon,
} from '../../types';
import {
  FormulaDraft,
  MAX_POOL_ROUNDS,
  canAddPoolRound,
  canRemovePoolRound,
  effectivePoolRounds,
  removePoolRound,
  setQuest,
} from './formulaDraft';

/** Phase de la frise (hors appel et classement final, implicites) */
export type FriezePhase =
  | { kind: 'pool'; round: number; key: string }
  | { kind: 'quest'; key: 'quest' }
  | { kind: 'tableau'; key: 'tableau' };

/** Brique proposée par un « ＋ » */
export type FriezeBrick = 'pool' | 'quest' | 'tableau';

const poolPhase = (round: number): FriezePhase => ({ kind: 'pool', round, key: `pool-${round}` });

// ── Épée, fleuret, sabre, Sabre Laser : FormulaDraft ────────────────────────

export function draftFrieze(d: FormulaDraft, weapon: Weapon): FriezePhase[] {
  const phases: FriezePhase[] = [];
  const rounds = effectivePoolRounds(d, weapon);
  for (let r = 0; r < rounds; r++) phases.push(poolPhase(r));
  if (weapon === Weapon.LASER && d.questEnabled) phases.push({ kind: 'quest', key: 'quest' });
  if (d.hasDirectElimination) phases.push({ kind: 'tableau', key: 'tableau' });
  return phases;
}

/**
 * Briques autorisées au « ＋ » d'indice `at` : 0 = juste après l'appel,
 * `draftFrieze(d).length` = juste avant le classement final.
 */
export function draftInsertOptions(d: FormulaDraft, weapon: Weapon, at: number): FriezeBrick[] {
  const phases = draftFrieze(d, weapon);
  const rounds = effectivePoolRounds(d, weapon);
  const options: FriezeBrick[] = [];
  if (at <= rounds && canAddPoolRound(d, weapon)) options.push('pool');
  if (weapon === Weapon.LASER && !d.questEnabled && at === rounds) options.push('quest');
  if (!d.hasDirectElimination && at === phases.length) options.push('tableau');
  return options;
}

/** Insère une brique au « ＋ » d'indice `at` ; {} si elle n'y est pas autorisée */
export function draftInsert(
  d: FormulaDraft,
  weapon: Weapon,
  brick: FriezeBrick,
  at: number
): Partial<FormulaDraft> {
  if (!draftInsertOptions(d, weapon, at).includes(brick)) return {};
  if (brick === 'tableau') return { hasDirectElimination: true };
  if (brick === 'quest') return setQuest(d, true);
  if (weapon === Weapon.LASER && d.questEnabled) return { questHasPools: true, poolRounds: 1 };
  // Nouveau tour à la position `at` : on y entre avec tous les qualifiés du tour précédent
  const q = [...d.poolRoundQualifiers];
  q.splice(Math.max(0, at - 1), 0, 0);
  return { poolRounds: d.poolRounds + 1, poolRoundQualifiers: q.slice(0, d.poolRounds) };
}

/** Une phase peut-elle être retirée ? Il reste toujours au moins une phase de combat. */
export function draftCanRemove(d: FormulaDraft, weapon: Weapon, phase: FriezePhase): boolean {
  const count = draftFrieze(d, weapon).length;
  if (count <= 1) return false;
  if (phase.kind === 'pool') return canRemovePoolRound(d, weapon);
  if (phase.kind === 'quest') return true;
  return d.hasDirectElimination && effectivePoolRounds(d, weapon) > 0;
}

export function draftRemove(
  d: FormulaDraft,
  weapon: Weapon,
  phase: FriezePhase
): Partial<FormulaDraft> {
  if (!draftCanRemove(d, weapon, phase)) return {};
  if (phase.kind === 'pool') return removePoolRound(d, weapon, phase.round);
  if (phase.kind === 'quest') return setQuest(d, false);
  return { hasDirectElimination: false };
}

// ── Arme « Autre » : CustomFormulaConfig ───────────────────────────────────

const isPool = (n: FormulaPhaseNode) => n.type === 'pool_round';
const isTableau = (n: FormulaPhaseNode) => n.type === 'direct_elimination';

const reindexPools = (phases: FormulaPhaseNode[]): FormulaPhaseNode[] => {
  let round = 0;
  return phases.map(n =>
    isPool(n)
      ? { ...n, config: { ...(n.config as CustomPoolRoundConfig), roundIndex: round++ } }
      : n
  );
};

/**
 * Formule de l'arme « Autre » ramenée à ce que le moteur exécute : tours de poules dans l'ordre,
 * premier tableau seul et en dernier, phases « Classement final » retirées (implicites).
 */
export function normalizeCustomFormula(f: CustomFormulaConfig): CustomFormulaConfig {
  const pools = f.phases.filter(isPool).slice(0, MAX_POOL_ROUNDS);
  const tableau = f.phases.find(isTableau);
  return { ...f, phases: reindexPools([...pools, ...(tableau ? [tableau] : [])]) };
}

export function customFrieze(f: CustomFormulaConfig): FriezePhase[] {
  const n = normalizeCustomFormula(f);
  const phases: FriezePhase[] = n.phases.filter(isPool).map((_, r) => poolPhase(r));
  if (n.phases.some(isTableau)) phases.push({ kind: 'tableau', key: 'tableau' });
  return phases;
}

export function customInsertOptions(f: CustomFormulaConfig, at: number): FriezeBrick[] {
  const n = normalizeCustomFormula(f);
  const rounds = n.phases.filter(isPool).length;
  const hasTableau = n.phases.some(isTableau);
  const options: FriezeBrick[] = [];
  if (at <= rounds && rounds < MAX_POOL_ROUNDS) options.push('pool');
  if (!hasTableau && at === rounds) options.push('tableau');
  return options;
}

/** Nouveau tour de poules : réglages du tour voisin, sinon du modèle par défaut */
function newPoolNode(
  template: CustomPoolRoundConfig | undefined,
  fallback: CustomPoolRoundConfig,
  id: string
): FormulaPhaseNode {
  const base = template ?? fallback;
  return {
    id,
    type: 'pool_round',
    label: 'Tour de poules',
    config: { ...base, advancementRule: { mode: 'all' } },
  };
}

function newTableauNode(fallback: CustomDEConfig, id: string): FormulaPhaseNode {
  return { id, type: 'direct_elimination', label: 'Élimination directe', config: { ...fallback } };
}

/**
 * Insère une brique au « ＋ » d'indice `at` (formule normalisée) ; formule inchangée si la brique
 * n'y est pas autorisée. `defaults` : configuration d'un tour et d'un tableau neufs.
 */
export function customInsert(
  f: CustomFormulaConfig,
  brick: FriezeBrick,
  at: number,
  newId: () => string,
  defaults: { pool: CustomPoolRoundConfig; tableau: CustomDEConfig }
): CustomFormulaConfig {
  const n = normalizeCustomFormula(f);
  if (!customInsertOptions(n, at).includes(brick)) return n;
  const phases = [...n.phases];
  if (brick === 'tableau') {
    phases.push(newTableauNode(defaults.tableau, newId()));
  } else {
    const pools = phases.filter(isPool);
    const neighbour = (pools[at - 1] ?? pools[at])?.config as CustomPoolRoundConfig | undefined;
    phases.splice(at, 0, newPoolNode(neighbour, defaults.pool, newId()));
  }
  return { ...n, phases: reindexPools(phases) };
}

export function customCanRemove(f: CustomFormulaConfig, phase: FriezePhase): boolean {
  const frieze = customFrieze(f);
  if (frieze.length <= 1) return false;
  if (phase.kind === 'pool') return frieze.filter(p => p.kind === 'pool').length > 1;
  return phase.kind === 'tableau';
}

export function customRemove(f: CustomFormulaConfig, phase: FriezePhase): CustomFormulaConfig {
  const n = normalizeCustomFormula(f);
  if (!customCanRemove(n, phase)) return n;
  if (phase.kind === 'tableau') return { ...n, phases: n.phases.filter(p => !isTableau(p)) };
  if (phase.kind !== 'pool') return n;
  let round = -1;
  const phases = n.phases.filter(p => !(isPool(p) && ++round === phase.round));
  return { ...n, phases: reindexPools(phases) };
}

/** Nœud de la formule « Autre » correspondant à une phase de la frise */
export function customPhaseNode(
  f: CustomFormulaConfig,
  phase: FriezePhase
): { node: FormulaPhaseNode; index: number } | null {
  const n = normalizeCustomFormula(f);
  let round = -1;
  const index = n.phases.findIndex(p =>
    phase.kind === 'tableau'
      ? isTableau(p)
      : phase.kind === 'pool' && isPool(p) && ++round === phase.round
  );
  return index >= 0 ? { node: n.phases[index], index } : null;
}

// ── Résumé sur une ligne ──────────────────────────────────────────────────

export type FormulaSummaryPart =
  | { kind: 'pools'; rounds: number; maxScore: number }
  | { kind: 'quest' }
  | { kind: 'tableau'; maxScore: number; thirdPlace: boolean };

export function summarizeDraft(d: FormulaDraft, weapon: Weapon): FormulaSummaryPart[] {
  const parts: FormulaSummaryPart[] = [];
  const rounds = effectivePoolRounds(d, weapon);
  if (rounds > 0) parts.push({ kind: 'pools', rounds, maxScore: d.poolMaxScore });
  if (weapon === Weapon.LASER && d.questEnabled) parts.push({ kind: 'quest' });
  if (d.hasDirectElimination)
    parts.push({
      kind: 'tableau',
      maxScore: d.tableMaxScore,
      thirdPlace: d.thirdPlaceMatch || d.playAllPositions,
    });
  return parts;
}

export function summarizeCustomFormula(f: CustomFormulaConfig): FormulaSummaryPart[] {
  const n = normalizeCustomFormula(f);
  const pools = n.phases.filter(isPool).map(p => p.config as CustomPoolRoundConfig);
  const tableau = n.phases.find(isTableau)?.config as CustomDEConfig | undefined;
  const parts: FormulaSummaryPart[] = [];
  if (pools.length > 0)
    parts.push({ kind: 'pools', rounds: pools.length, maxScore: pools[0].maxScore });
  if (tableau)
    parts.push({
      kind: 'tableau',
      maxScore: tableau.maxScore,
      thirdPlace: !!tableau.thirdPlaceMatch,
    });
  return parts;
}
