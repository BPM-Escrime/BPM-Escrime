/**
 * BPM - Escrime - Ordre des matchs d'une poule (tables FIE, Berger)
 * Règles pures, extraites de shared/utils/poolCalculations.ts (#2197, docs/adr/0002).
 * Licensed under GPL-3.0
 */

/**
 * Ordre standard des matchs d'une poule (#1964) : tables FIE o.69 pour 6 et 7, tables d'usage
 * de 3 à 12, Berger au-delà. Placement des coéquipiers : planPoolBouts (poolBoutOrder.ts).
 */
export function generatePoolMatchOrder(fencerCount: number): [number, number][] {
  if (!Number.isInteger(fencerCount) || fencerCount < 2) {
    throw new RangeError(
      `generatePoolMatchOrder: fencerCount doit être un entier ≥ 2 (reçu: ${fencerCount})`
    );
  }
  const orders: { [key: number]: [number, number][] } = {
    3: [
      [2, 3],
      [1, 3],
      [1, 2],
    ],
    4: [
      [1, 4],
      [2, 3],
      [1, 3],
      [2, 4],
      [3, 4],
      [1, 2],
    ],
    5: [
      [1, 2],
      [3, 4],
      [5, 1],
      [2, 3],
      [5, 4],
      [1, 3],
      [2, 5],
      [4, 1],
      [3, 5],
      [4, 2],
    ],
    6: [
      [1, 2],
      [4, 3],
      [6, 5],
      [3, 1],
      [2, 6],
      [5, 4],
      [1, 6],
      [3, 5],
      [4, 2],
      [5, 1],
      [6, 4],
      [2, 3],
      [1, 4],
      [5, 2],
      [3, 6],
    ],
    7: [
      [1, 4],
      [2, 5],
      [3, 6],
      [7, 1],
      [5, 4],
      [2, 3],
      [6, 7],
      [5, 1],
      [4, 3],
      [6, 2],
      [5, 7],
      [3, 1],
      [4, 6],
      [7, 2],
      [3, 5],
      [1, 6],
      [2, 4],
      [7, 3],
      [6, 5],
      [1, 2],
      [4, 7],
    ],
    8: [
      [2, 3],
      [1, 5],
      [7, 4],
      [6, 8],
      [1, 2],
      [3, 4],
      [5, 6],
      [8, 7],
      [4, 1],
      [5, 2],
      [8, 3],
      [6, 7],
      [4, 2],
      [8, 1],
      [7, 5],
      [3, 6],
      [2, 8],
      [5, 4],
      [6, 1],
      [3, 7],
      [4, 8],
      [2, 6],
      [3, 5],
      [1, 7],
      [4, 6],
      [8, 5],
      [7, 2],
      [1, 3],
    ],
  };

  const table = orders[fencerCount] ?? STANDARD_ORDERS_9_TO_12[fencerCount];
  return table
    ? table.map(([a, b]) => [a, b] as [number, number])
    : generateRoundRobinOrder(fencerCount);
}

/** Lit une table « 1-9 2-8 … » (numéros dans la poule, base 1) */
export function parseBoutTable(table: string): [number, number][] {
  return table
    .trim()
    .split(/\s+/)
    .map(pair => {
      const [a, b] = pair.split('-').map(Number);
      return [a, b] as [number, number];
    });
}

/**
 * Tables d'usage des poules de 9 à 12 (BPM - Escrime, #1964). Le règlement FIE (o.69) ne donne
 * que les poules de 6 et 7 : ces tables ne sont pas réglementaires mais reprises par les
 * logiciels de référence. Aucun tireur ne tire deux matchs de suite.
 */
const STANDARD_ORDERS_9_TO_12: Record<number, [number, number][]> = {
  9: parseBoutTable(
    '1-9 2-8 3-7 4-6 1-5 2-9 8-3 7-4 6-5 1-2 9-3 8-4 7-5 6-1 3-2 9-4 5-8 7-6 ' +
      '3-1 2-4 5-9 8-6 7-1 4-3 5-2 6-9 8-7 4-1 5-3 6-2 9-7 1-8 4-5 3-6 2-7 9-8'
  ),
  10: parseBoutTable(
    '1-4 6-9 2-5 7-10 3-1 8-6 4-5 9-10 2-3 7-8 5-1 10-6 4-2 9-7 5-3 10-8 1-2 ' +
      '6-7 3-4 8-9 5-10 1-6 2-7 3-8 4-9 6-5 10-2 8-1 7-4 9-3 2-6 5-8 4-10 1-9 ' +
      '3-7 8-2 6-4 9-5 10-3 7-1 4-8 2-9 3-6 5-7 1-10'
  ),
  11: parseBoutTable(
    '1-2 7-8 4-5 10-11 2-3 8-9 5-6 3-1 9-7 6-4 2-5 8-11 1-4 7-10 5-3 11-9 1-6 ' +
      '4-2 10-8 3-6 5-1 11-7 3-4 9-10 6-2 1-7 3-9 10-4 8-2 5-11 1-8 9-2 3-10 ' +
      '4-11 6-7 9-1 2-10 11-3 7-5 6-8 10-1 11-2 4-7 8-5 6-9 11-1 7-3 4-8 9-5 ' +
      '6-10 2-7 8-3 4-9 10-5 6-11'
  ),
  12: parseBoutTable(
    '1-2 7-8 4-5 10-11 2-3 8-9 5-6 11-12 3-1 9-7 6-4 12-10 2-5 8-11 1-4 7-10 ' +
      '5-3 11-9 1-6 7-12 4-2 10-8 3-6 9-12 5-1 11-7 3-4 9-10 6-2 12-8 1-7 3-9 ' +
      '10-4 8-2 5-11 12-6 1-8 9-2 3-10 4-11 12-5 6-7 9-1 2-10 11-3 4-12 7-5 ' +
      '6-8 10-1 11-2 12-3 4-7 8-5 6-9 11-1 2-12 7-3 4-8 9-5 6-10 12-1 2-7 8-3 ' +
      '4-9 10-5 6-11'
  ),
};

/**
 * Génère un ordre de matchs selon l'algorithme de Berger (méthode du cercle).
 * Sert au-delà de 12 tireurs et pour l'« ordre libre » (#1964).
 * Garantit qu'aucun tireur ne dispute deux matchs consécutifs.
 * Pour n pair : n-1 rondes de n/2 matchs.
 * Pour n impair : ajoute un fantôme n+1, applique Berger(n+1), supprime les matchs impliquant le fantôme.
 */
export function generateRoundRobinOrder(fencerCount: number): [number, number][] {
  const n = fencerCount;
  const matches: [number, number][] = [];
  const size = n % 2 === 0 ? n : n + 1;
  const ghost = n % 2 === 0 ? -1 : size; // fantôme = n+1 si impair
  const fixed = size;
  const circle = Array.from({ length: size - 1 }, (_, i) => i + 1);

  for (let round = 0; round < size - 1; round++) {
    if (fixed !== ghost && circle[0] !== ghost) {
      matches.push([fixed, circle[0]]);
    }
    for (let i = 1; i < size / 2; i++) {
      const a = circle[i];
      const b = circle[size - 1 - i];
      if (a !== ghost && b !== ghost) {
        matches.push([a, b]);
      }
    }
    circle.unshift(circle.pop()!);
  }

  return matches;
}

/**
 * Calcule le nombre de matchs dans une poule
 */
export function calculatePoolMatchCount(fencerCount: number): number {
  if (!Number.isInteger(fencerCount) || fencerCount < 0) {
    throw new RangeError(
      `calculatePoolMatchCount: fencerCount doit être un entier ≥ 0 (reçu: ${fencerCount})`
    );
  }
  return (fencerCount * (fencerCount - 1)) / 2;
}
