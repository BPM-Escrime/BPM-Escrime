/**
 * BPM - Escrime - Points Quest (Sabre Laser)
 * Règles pures, extraites de shared/utils/poolCalculations.ts (#2197, docs/adr/0002).
 * Licensed under GPL-3.0
 */
import { type Fencer, type Match, MatchStatus, type PoolRanking } from '../../types';
import { isMatchCancelledByForfeit } from './poolForfeit';
import { voidsMatchForOpponent } from './poolStats';

/** Points Quest par match (Q/M) — 2e critère du classement Sabre Laser (règlement 2026) */
export function getQuestPerMatch(r: Pick<PoolRanking, 'questPoints' | 'matchesPlayed'>): number {
  return r.matchesPlayed > 0 ? (r.questPoints ?? 0) / r.matchesPlayed : 0;
}

/** Compare les victoires par cotation la plus élevée (V4, puis V3, V2, V1) — décroissant */
export function compareQuestVictories(a: PoolRanking, b: PoolRanking): number {
  return (
    (b.questVictories4 ?? 0) - (a.questVictories4 ?? 0) ||
    (b.questVictories3 ?? 0) - (a.questVictories3 ?? 0) ||
    (b.questVictories2 ?? 0) - (a.questVictories2 ?? 0) ||
    (b.questVictories1 ?? 0) - (a.questVictories1 ?? 0)
  );
}

/**
 * Tri Sabre Laser (règlement 2026) :
 * 1. Victoires/matchs  2. Points Quest/matchs  3. Indice (TD-TR)
 * 4. Victoires par cotation la plus élevée (V4, V3, V2, V1)
 */
export function compareQuestRanking(a: PoolRanking, b: PoolRanking): number {
  if (a.ratio !== b.ratio) return b.ratio - a.ratio;
  const aQpm = getQuestPerMatch(a);
  const bQpm = getQuestPerMatch(b);
  if (aQpm !== bQpm) return bQpm - aQpm;
  if (a.index !== b.index) return b.index - a.index;
  return compareQuestVictories(a, b);
}

/**
 * Calcule les points Quest pour une victoire selon l'écart de score
 * @param winnerScore Score du vainqueur
 * @param loserScore Score du perdant
 * @returns Nombre de points Quest (1 à 4)
 */
export function calculateQuestPoints(winnerScore: number, loserScore: number): number {
  const diff = winnerScore - loserScore;

  if (diff >= 12) return 4; // Écart très important (≥12 points)
  if (diff >= 8) return 3; // Écart important (8-11 points)
  if (diff >= 4) return 2; // Écart moyen (4-7 points)
  return 1; // Écart faible (≤3 points)
}

/**
 * Calcule les statistiques Quest d'un tireur (Sabre Laser)
 * Règle forfait : les matchs disputés avant le forfait/abandon sont conservés,
 * les matchs annulés ensuite ne comptent pas ; adversaire exclu → match annulé.
 */
export function calculateFencerQuestStats(
  fencer: Fencer,
  matches: Match[]
): { questPoints: number; v4: number; v3: number; v2: number; v1: number } {
  let questPoints = 0;
  let v4 = 0,
    v3 = 0,
    v2 = 0,
    v1 = 0;

  for (const match of matches) {
    const isA = match.fencerA?.id === fencer.id;
    const isB = match.fencerB?.id === fencer.id;

    if (!isA && !isB) continue;
    if (match.status !== MatchStatus.FINISHED) continue;

    const myScore = isA ? match.scoreA : match.scoreB;
    const oppScore = isA ? match.scoreB : match.scoreA;
    const opponent = isA ? match.fencerB : match.fencerA;

    if (!myScore || !oppScore) continue;
    if (isMatchCancelledByForfeit(match)) continue;

    // Si l'adversaire est exclu, le match ne compte pas
    if (voidsMatchForOpponent(opponent?.status, true)) continue;

    // Vérifier si victoire
    const isVictory =
      myScore.isVictory || oppScore.isAbstention || oppScore.isExclusion || oppScore.isForfait;

    if (isVictory && myScore.value !== null && oppScore.value !== null) {
      const points = calculateQuestPoints(myScore.value, oppScore.value);
      questPoints += points;

      switch (points) {
        case 4:
          v4++;
          break;
        case 3:
          v3++;
          break;
        case 2:
          v2++;
          break;
        case 1:
          v1++;
          break;
      }
    }
  }

  return { questPoints, v4, v3, v2, v1 };
}
