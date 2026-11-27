/**
 * BPM - Escrime - Avancement d'une épreuve par équipes pour le verrou S6 de la formule
 * (docs/adr/0041, ADR-0044). Faits lus dans les rencontres d'équipe, jugés par formulaProgress
 * comme ceux d'une épreuve individuelle ; même fonction pour le moteur et l'écran. Domaine pur.
 * Licensed under GPL-3.0
 */
import type { FormulaV2 } from '../formula/formulaV2';
import {
  formulaProgress,
  type FormulaProgress,
  type ProgressFacts,
} from '../formula/formulaRemarks';

/** Rencontres d'équipe utiles à l'avancement : celles de poule et celles du tableau */
export interface TeamProgressMatches {
  poolMatches: readonly { status: string }[];
  tableauMatches: readonly unknown[];
}

/**
 * Faits d'avancement : poules d'équipes tirées = tour de poules commencé ; tableau tiré = tableau
 * commencé ; toutes les rencontres de poule finies et le tableau tiré = tour de poules clos (ses
 * éliminés sont fixés par la coupe du tirage).
 */
export function teamProgressFacts(input: TeamProgressMatches): ProgressFacts {
  const pools = input.poolMatches.length > 0;
  const drawn = input.tableauMatches.length > 0;
  const closed = pools && drawn && input.poolMatches.every(m => m.status === 'finished');
  return {
    poolsLaunched: pools && !closed,
    poolHistory: closed ? [input.poolMatches] : [],
    tableauMatches: input.tableauMatches,
  };
}

/** Phases commencées de la formule enregistrée `stored` d'une épreuve par équipes */
export function teamFormulaProgress(
  stored: FormulaV2,
  input: TeamProgressMatches
): FormulaProgress {
  return formulaProgress(stored, teamProgressFacts(input));
}
