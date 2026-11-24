/**
 * BPM - Escrime - Statistiques d'un tireur dans une poule
 * Règles pures, extraites de shared/utils/poolCalculations.ts (#2197, docs/adr/0002).
 * Licensed under GPL-3.0
 */
import {
  type Fencer,
  FencerStatus,
  type Match,
  MatchStatus,
  type PoolStats,
  type Score,
} from '../../types';
import { isMatchCancelledByForfeit } from './poolForfeit';

export interface FencerPoolStatsOptions {
  /**
   * Règle Sabre Laser (forfait en cours de poule) : les matchs disputés avant
   * le forfait/abandon sont conservés, seuls les matchs annulés sont ignorés.
   * Un adversaire exclu (carton noir) voit toujours ses matchs annulés.
   */
  keepPlayedForfeitMatches?: boolean;
}

/** Statut d'adversaire qui annule le match pour le tireur */
export function voidsMatchForOpponent(
  status: FencerStatus | undefined,
  keepPlayed: boolean,
  opponentScore?: Score | null
): boolean {
  if (status === FencerStatus.EXCLUDED) return true;
  if (keepPlayed) return false;
  if (status !== FencerStatus.FORFAIT && status !== FencerStatus.ABANDONED) return false;
  // Armes olympiques : seul le match annulé par le forfait/abandon (score marqué) est ignoré.
  // Les matchs déjà disputés avant restent comptés pour les tireurs restants.
  return !!opponentScore && !!(opponentScore.isForfait || opponentScore.isAbstention);
}

/**
 * Calcule les statistiques d'un tireur dans une poule
 * Règle forfait : Si l'adversaire est en forfait/abandon, le match ne compte pas
 * (Sabre Laser : seuls les matchs annulés après le forfait sont ignorés)
 */
export function calculateFencerPoolStats(
  fencer: Fencer,
  matches: Match[],
  options: FencerPoolStatsOptions = {}
): PoolStats {
  const keepPlayed = options.keepPlayedForfeitMatches ?? false;
  if (!fencer)
    throw new TypeError('calculateFencerPoolStats: fencer ne peut pas être null/undefined');
  if (!Array.isArray(matches))
    throw new TypeError('calculateFencerPoolStats: matches doit être un tableau');
  let victories = 0;
  let defeats = 0;
  let touchesScored = 0;
  let touchesReceived = 0;
  let matchesPlayed = 0;
  let maxSingleMatchScore = 0;

  for (const match of matches) {
    // Vérifier si le tireur est dans ce match
    const isA = match.fencerA?.id === fencer.id;
    const isB = match.fencerB?.id === fencer.id;

    if (!isA && !isB) continue;
    if (match.status !== MatchStatus.FINISHED) continue;

    const myScore = isA ? match.scoreA : match.scoreB;
    const oppScore = isA ? match.scoreB : match.scoreA;
    const opponent = isA ? match.fencerB : match.fencerA;

    if (!myScore || !oppScore) continue;
    if (keepPlayed && isMatchCancelledByForfeit(match)) continue;

    // Si l'adversaire est en forfait/abandon/exclusion, le match ne compte pas
    if (voidsMatchForOpponent(opponent?.status, keepPlayed, oppScore)) continue;

    matchesPlayed++;
    maxSingleMatchScore = Math.max(maxSingleMatchScore, myScore.value ?? 0);

    // Gestion des cas spéciaux
    if (myScore.isAbstention || myScore.isExclusion || myScore.isForfait) {
      defeats++;
      touchesReceived += oppScore.value ?? 0;
      touchesScored += myScore.value ?? 0;
    } else if (oppScore.isAbstention || oppScore.isExclusion || oppScore.isForfait) {
      victories++;
      touchesScored += myScore.value ?? 0;
      touchesReceived += oppScore.value ?? 0;
    } else if (myScore.isVictory) {
      victories++;
      touchesScored += myScore.value ?? 0;
      touchesReceived += oppScore.value ?? 0;
    } else {
      defeats++;
      touchesScored += myScore.value ?? 0;
      touchesReceived += oppScore.value ?? 0;
    }
  }

  const index = touchesScored - touchesReceived;
  const victoryRatio = matchesPlayed > 0 ? victories / matchesPlayed : 0;

  return {
    victories,
    defeats,
    touchesScored,
    touchesReceived,
    index,
    matchesPlayed,
    victoryRatio,
    maxSingleMatchScore,
  };
}
