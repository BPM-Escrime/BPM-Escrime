/**
 * BPM - Escrime - Numéro de poule de chaque tireur (colonne « Poule » du classement des équipes,
 * #1441). Domaine pur.
 * Licensed under GPL-3.0
 */

/** Numéro de poule de chaque tireur (première poule trouvée) */
export function poolNumbersOf(
  pools: { number: number; fencers: { id: string }[] }[]
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pool of pools)
    for (const f of pool.fencers) if (out[f.id] === undefined) out[f.id] = pool.number;
  return out;
}
