/**
 * BPM - Escrime - Calculs de poule : formatage d'affichage et réexports (#2197)
 * Les règles (ordre des matchs, forfaits, statistiques, Quest, classements, répartition,
 * validation) sont dans src/shared/domain/pools (docs/adr/0002). Réexports temporaires :
 * importer directement depuis le domaine.
 * Licensed under GPL-3.0
 */
import type { Fencer, PoolRanking } from '../types';
import { getQuestPerMatch } from '../domain/pools/questPoints';
import {
  distributeFencersToPoolsSerpentine as drawSerpentine,
  type SeparationCriterionKey,
} from '../domain/pools/poolDistribution';

export {
  generatePoolMatchOrder,
  parseBoutTable,
  generateRoundRobinOrder,
  calculatePoolMatchCount,
} from '../domain/pools/poolMatchOrder';
export {
  LASER_FORFEIT_WINNER_SCORE,
  isCancelledForfeitScore,
  isMatchCancelledByForfeit,
  isMatchVoidedByForfeit,
  isDnf,
  isDnsRanking,
} from '../domain/pools/poolForfeit';
export { calculateFencerPoolStats } from '../domain/pools/poolStats';
export type { FencerPoolStatsOptions } from '../domain/pools/poolStats';
export {
  calculatePoolRanking,
  calculatePoolRankingQuest,
  calculateOverallRankingQuest,
  calculateOverallRanking,
  generateInitialRanking,
  getPoolWinnerIds,
  filterPoolWinners,
} from '../domain/pools/poolRanking';
export {
  distributeFencersGroupedByLevel,
  separationQuota,
  calculateOptimalPoolCount,
} from '../domain/pools/poolDistribution';
export type { SeparationCriterionKey } from '../domain/pools/poolDistribution';
export { validatePool } from '../domain/pools/poolValidation';
export {
  getQuestPerMatch,
  calculateQuestPoints,
  calculateFencerQuestStats,
} from '../domain/pools/questPoints';

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

/** Tirage en serpentin ; hasard du système par défaut (le domaine le reçoit en paramètre) */
export function distributeFencersToPoolsSerpentine(
  fencers: Fencer[],
  poolCount: number,
  separation: SeparationCriterionKey[],
  belowRanking: SeparationCriterionKey[] = [],
  random: () => number = Math.random
): Fencer[][] {
  return drawSerpentine(fencers, poolCount, separation, belowRanking, random);
}
