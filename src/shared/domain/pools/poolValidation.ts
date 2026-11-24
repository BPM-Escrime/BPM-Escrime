/**
 * BPM - Escrime - Validation d'une poule (matchs terminés, vainqueur clair)
 * Règles pures, extraites de shared/utils/poolCalculations.ts (#2197, docs/adr/0002).
 * Licensed under GPL-3.0
 */
import { MatchStatus, type Pool } from '../../types';

/**
 * Vérifie si une poule est complète et valide
 */
export function validatePool(pool: Pool): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Vérifier que tous les matchs sont terminés
  const incompleteMatches = (pool.matches ?? []).filter(
    m => m.status !== MatchStatus.FINISHED && m.status !== MatchStatus.CANCELLED
  );
  if (incompleteMatches.length > 0) {
    errors.push(`${incompleteMatches.length} match(s) non terminé(s)`);
  }

  // Vérifier la cohérence des scores
  for (const match of pool.matches ?? []) {
    if (match.status !== MatchStatus.FINISHED) continue;

    if (!match.scoreA || !match.scoreB) {
      errors.push(`Match ${match.number}: scores manquants`);
      continue;
    }

    // Vérifier qu'il y a un gagnant et un perdant
    const aWins = match.scoreA.isVictory;
    const bWins = match.scoreB.isVictory;

    if (aWins === bWins && !match.scoreA.isAbstention && !match.scoreB.isAbstention) {
      errors.push(`Match ${match.number}: pas de vainqueur clair`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
