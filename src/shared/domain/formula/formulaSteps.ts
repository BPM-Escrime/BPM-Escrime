/**
 * BPM - Escrime - Déroulé de l'épreuve dérivé de la formule v2 (#2013 étape D, ADR-0037)
 * Étapes dans l'ordre : appel, poules (suite de tours consécutifs), Tour Quest, tableau (arrêté
 * à N ou non), résultats. L'écran en déduit sa navigation ; une épreuve sans formule enregistrée
 * obtient la même suite depuis ses réglages (formulaOf). Domaine pur.
 * Licensed under GPL-3.0
 */

import type { FormulaV2, TableauPhase } from './formulaV2';

export type FormulaStep =
  | { kind: 'checkin' }
  | { kind: 'pools'; rounds: number }
  | { kind: 'quest'; hasPreliminaryPools: boolean }
  | { kind: 'tableau'; stopAt?: number }
  | { kind: 'results' };

export function formulaSteps(f: FormulaV2): FormulaStep[] {
  const steps: FormulaStep[] = [{ kind: 'checkin' }];
  for (const p of f.phases) {
    const last = steps[steps.length - 1];
    if (p.kind === 'pool') {
      if (last.kind === 'pools') last.rounds += 1;
      else steps.push({ kind: 'pools', rounds: 1 });
    } else if (p.kind === 'quest') {
      steps.push({ kind: 'quest', hasPreliminaryPools: p.config.hasPreliminaryPools });
    } else if (p.kind === 'tableau') {
      steps.push({ kind: 'tableau', ...(p.stopAt ? { stopAt: p.stopAt } : {}) });
    }
  }
  steps.push({ kind: 'results' });
  return steps;
}

/** Épreuve sans tour de poules ni Tour Quest : le tableau part du classement d'entrée */
export const startsWithTableau = (f: FormulaV2): boolean =>
  !f.phases.some(p => p.kind === 'pool' || p.kind === 'quest') &&
  f.phases.some(p => p.kind === 'tableau');

/**
 * Tableau arrêté à N tireurs et suivi d'au moins un tour de poules (ADR-0037, D2) ; sinon null.
 * Un `stopAt` sans phase après le tableau est sans effet : le tableau va jusqu'à la finale.
 */
export function stoppedTableauOf(f: FormulaV2): TableauPhase | null {
  const at = f.phases.findIndex(p => p.kind === 'tableau');
  const tableau = f.phases[at] as TableauPhase | undefined;
  if (!tableau?.stopAt) return null;
  return f.phases.slice(at + 1).some(p => p.kind === 'pool') ? tableau : null;
}

/**
 * Partie de la formule en cours quand un tableau est arrêté (ADR-0037, D2) : avant sa clôture,
 * les tours de poules qui le précèdent puis le tableau ; après, tous les tours et pas de
 * tableau (les restants finissent par les tours qui suivent). null : formule sans tableau
 * arrêté, réglages habituels.
 */
export function formulaSegment(
  f: FormulaV2,
  closedTableauStages: number
): { poolRounds: number; hasDirectElimination: boolean; stopAt?: number } | null {
  const tableau = stoppedTableauOf(f);
  if (!tableau) return null;
  const at = f.phases.indexOf(tableau);
  const pools = (list: FormulaV2['phases']) => list.filter(p => p.kind === 'pool').length;
  return closedTableauStages > 0
    ? { poolRounds: pools(f.phases), hasDirectElimination: false }
    : {
        poolRounds: pools(f.phases.slice(0, at)),
        hasDirectElimination: true,
        stopAt: tableau.stopAt,
      };
}
