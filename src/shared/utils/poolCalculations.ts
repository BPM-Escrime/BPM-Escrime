/**
 * BPM - Escrime - Formatage d'affichage des résultats de poule (#2197)
 * Les règles (ordre des matchs, forfaits, statistiques, Quest, classements, répartition,
 * validation) sont dans src/shared/domain/pools (docs/adr/0002).
 * Licensed under GPL-3.0
 */
import type { PoolRanking } from '../types';
import { getQuestPerMatch } from '../domain/pools/questPoints';

/**
 * Formate le ratio V/M pour l'affichage
 */
export function formatRatio(ratio: number): string {
  if (!Number.isFinite(ratio)) return '0.000';
  return ratio.toFixed(3);
}

/**
 * Formate l'indice pour l'affichage
 */
export function formatIndex(index: number): string {
  return index >= 0 ? `+${index}` : `${index}`;
}

/** Formate le ratio Q/M pour l'affichage */
export function formatQuestPerMatch(r: Pick<PoolRanking, 'questPoints' | 'matchesPlayed'>): string {
  return getQuestPerMatch(r).toFixed(2);
}
