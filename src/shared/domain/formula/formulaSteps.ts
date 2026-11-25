/**
 * BPM - Escrime - Déroulé de l'épreuve dérivé de la formule v2 (#2013 étape D, ADR-0035)
 * Étapes dans l'ordre : appel, poules (suite de tours consécutifs), Tour Quest, tableau (arrêté
 * à N ou non), résultats. L'écran en déduit sa navigation ; une épreuve sans formule enregistrée
 * obtient la même suite depuis ses réglages (formulaOf). Domaine pur.
 * Licensed under GPL-3.0
 */

import type { FormulaV2 } from './formulaV2';

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
