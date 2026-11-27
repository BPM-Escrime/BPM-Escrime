/**
 * BPM - Escrime - Remarques situées sur la formule (#2013 étape F, lot F2 ; docs/adr/0041)
 * Une remarque bloquante dit quelle phase de la frise est en cause : le moteur la rend dans son
 * refus (`invalid_settings`), l'écran l'affiche sur la carte de la phase. `FormulaProgress` :
 * phases déjà commencées de l'épreuve (S6), calculées ici depuis l'état de session, pour le
 * moteur comme pour l'écran. Domaine pur.
 * Licensed under GPL-3.0
 */

import type { FormulaPhaseV2, FormulaV2 } from './formulaV2';

/**
 * Remarque bloquante. `code` : snake_case stable ; `phase` : clé de la frise (`pool-0`,
 * `quest`, `tableau`, `split`), null pour la formule entière ; `message` : en français.
 */
export interface FormulaRemark {
  code: string;
  phase: string | null;
  message: string;
}

export const remark = (code: string, phase: string | null, message: string): FormulaRemark => ({
  code,
  phase,
  message,
});

/** Natures de phase de la formule */
export type FormulaPhaseKind = FormulaPhaseV2['kind'];

/** Natures des phases commencées de l'épreuve, dans l'ordre de la formule (ADR-0041, S6) */
export type FormulaProgress = readonly FormulaPhaseKind[] & {
  /**
   * Tours de poules clos, dans l'ordre (`closePoolRound`) : leur qualification est fixée dès la
   * clôture, même si la phase suivante n'est pas commencée (S6, amendement du 2026-11-27).
   * Propriété non énumérable posée par `formulaProgress` : l'avancement reste une liste de
   * natures pour qui la compare ou la sérialise ; absente = aucun tour clos connu.
   */
  readonly closedRounds?: number;
};

/** Clés de la frise des phases (pool-0, pool-1…, quest, tableau, split), dans l'ordre */
export function phaseKeys(phases: readonly FormulaPhaseV2[]): string[] {
  let round = 0;
  return phases.map(p => (p.kind === 'pool' ? `pool-${round++}` : p.kind));
}

/** Clé de la frise d'une phase d'un type donné, la `index`-ième de la suite `kinds` */
export function keyOfKinds(kinds: readonly FormulaPhaseKind[], index: number): string {
  const kind = kinds[index];
  return kind === 'pool' ? `pool-${kinds.slice(0, index).filter(k => k === 'pool').length}` : kind;
}

/**
 * Message de refus du moteur : une remarque par ligne, avec la clé de la phase (`formule` pour
 * la formule entière).
 */
export function remarksMessage(remarks: readonly FormulaRemark[]): string {
  return `Formule refusée :\n${remarks.map(r => `[${r.phase ?? 'formule'}] ${r.message}`).join('\n')}`;
}

/** Faits de l'état de session utiles au calcul de l'avancement (état du moteur ou de l'écran) */
export interface ProgressFacts {
  /** Poules du tour courant */
  pools?: unknown;
  /** Poules des tours clos (et du dernier tour avant un tableau arrêté clos) */
  poolHistory?: unknown;
  poolsLaunched?: unknown;
  tableauMatches?: unknown;
  /** Tableaux séparés par groupe (ADR-0024) */
  groupTableaux?: unknown;
  /** Étapes closes : tableaux arrêtés (ADR-0037) */
  stageHistory?: unknown;
  /** Scission faite (ADR-0039) */
  splitHistory?: unknown;
  /** Phase Tour Quest ouverte */
  questStarted?: boolean;
}

const count = (v: unknown): number => (Array.isArray(v) ? v.length : 0);

/**
 * Phases commencées de `stored`, la formule enregistrée à laquelle correspond l'état : tours de
 * poules lancés (clos ou en cours), Tour Quest ouvert, tableau tiré ou arrêté et clos, scission
 * faite. Une phase commencée entraîne celles qui la précèdent. Rend les natures dans l'ordre.
 */
export function formulaProgress(stored: FormulaV2, facts: ProgressFacts): FormulaProgress {
  // Tour courant commencé : poules lancées (`poolsLaunched`, état de session) ; un tirage non
  // lancé ne compte pas. Sans l'information : poules présentes
  const current =
    typeof facts.poolsLaunched === 'boolean' ? facts.poolsLaunched : count(facts.pools) > 0;
  let rounds = count(facts.poolHistory) + (current ? 1 : 0);
  const groups = Object.values(
    facts.groupTableaux && typeof facts.groupTableaux === 'object' ? facts.groupTableaux : {}
  ) as Array<{ tableauMatches?: unknown } | null>;
  let tableaux =
    count(facts.stageHistory) +
    (count(facts.tableauMatches) > 0 || groups.some(g => count(g?.tableauMatches) > 0) ? 1 : 0);
  const started: FormulaPhaseKind[] = [];
  for (const p of stored.phases) {
    if (p.kind === 'pool') {
      if (rounds <= 0) break;
      rounds--;
    } else if (p.kind === 'quest') {
      if (!facts.questStarted && tableaux <= 0) break;
    } else if (p.kind === 'tableau') {
      if (tableaux <= 0) break;
      tableaux--;
    } else if (count(facts.splitHistory) === 0) break;
    started.push(p.kind);
  }
  // Tours clos : l'historique des poules (clôture d'un tour, ou dernier tour avant un tableau
  // arrêté clos, suivi alors d'une phase commencée), borné aux tours commencés
  const startedRounds = started.filter(k => k === 'pool').length;
  return withClosedRounds(started, Math.min(count(facts.poolHistory), startedRounds));
}

/** Avancement portant le nombre de tours de poules clos (propriété non énumérable) */
export function withClosedRounds(
  kinds: readonly FormulaPhaseKind[],
  closedRounds: number
): FormulaProgress {
  const progress = [...kinds];
  Object.defineProperty(progress, 'closedRounds', { value: closedRounds, enumerable: false });
  return progress;
}
