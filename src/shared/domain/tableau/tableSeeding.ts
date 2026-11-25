/**
 * BPM - Escrime - Taille et placement FIE du tableau à élimination directe
 * Règles pures, extraites de shared/utils/tableCalculations.ts (#2291, docs/adr/0002).
 * Licensed under GPL-3.0
 */

import type { Fencer } from '../../types';

// ============================================================================
// Table Size Calculation
// ============================================================================

/**
 * Calcule la taille du tableau (puissance de 2 supérieure ou égale)
 */
export function calculateTableSize(fencerCount: number): number {
  let size = 2;
  while (size < fencerCount) {
    size *= 2;
  }
  return size;
}

/**
 * Calcule le nombre d'exempts (byes) nécessaires
 */
export function calculateByeCount(fencerCount: number, tableSize: number): number {
  return tableSize - fencerCount;
}

// ============================================================================
// Seeding and Placement
// ============================================================================

/**
 * Génère le tableau de placement FIE : chart[position] = seed.
 *
 * Construction par dédoublement : à chaque tour, chaque seed s d'indice i
 * devient la paire [s, n+1-s] (i pair) ou [n+1-s, s] (i impair).
 * Tableau de 8 : [1, 8, 5, 4, 3, 6, 7, 2]
 *   → 1-8, 5-4, 3-6, 7-2 ; 1 et 2 ne se rencontrent qu'en finale.
 */
export function generateSeedingChart(tableSize: number): number[] {
  if (!Number.isInteger(tableSize) || tableSize < 1 || (tableSize & (tableSize - 1)) !== 0) {
    throw new RangeError(
      `generateSeedingChart: tableSize doit être une puissance de 2 (reçu: ${tableSize})`
    );
  }
  let chart = [1];
  for (let n = 2; n <= tableSize; n *= 2) {
    const next: number[] = [];
    chart.forEach((seed, i) => {
      const opponent = n + 1 - seed;
      if (i % 2 === 0) next.push(seed, opponent);
      else next.push(opponent, seed);
    });
    chart = next;
  }
  return chart;
}

/**
 * Position (0-based) d'une tête de série dans le tableau, selon le placement FIE.
 */
export function getSeedPosition(seed: number, tableSize: number): number {
  return generateSeedingChart(tableSize).indexOf(seed);
}

/**
 * Place les tireurs dans le tableau selon leur classement
 */
export function placeFencersInTable(fencers: Fencer[], tableSize: number): (Fencer | null)[] {
  const placements: (Fencer | null)[] = new Array(tableSize).fill(null);
  const seedingChart = generateSeedingChart(tableSize);

  // Précalcule seed→position en O(n) pour éviter indexOf en boucle
  const seedToPosition = new Map<number, number>();
  for (let pos = 0; pos < seedingChart.length; pos++) {
    seedToPosition.set(seedingChart[pos], pos);
  }

  // Trier les tireurs par classement général (après poules)
  const sortedFencers = [...fencers].sort(
    (a, b) => (a.poolStats?.overallRank ?? 999) - (b.poolStats?.overallRank ?? 999)
  );

  // Placer chaque tireur selon son seed
  for (let i = 0; i < sortedFencers.length; i++) {
    const position = seedToPosition.get(i + 1);
    if (position !== undefined) {
      placements[position] = sortedFencers[i];
    }
  }

  return placements;
}
