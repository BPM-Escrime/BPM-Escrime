/**
 * BPM - Escrime - Classement de poule, classement général, vainqueurs de poule
 * Règles pures, extraites de shared/utils/poolCalculations.ts (#2197, docs/adr/0002).
 * Licensed under GPL-3.0
 */
import {
  type Fencer,
  FencerStatus,
  type Match,
  MatchStatus,
  type Pool,
  type PoolRanking,
} from '../../types';
import {
  calculateFencerQuestStats,
  compareQuestRanking,
  compareQuestVictories,
  getQuestPerMatch,
} from './questPoints';
import {
  appendForfeitFencers,
  collectForfeitIds,
  isForfeitStatus,
  splitForfeit,
} from './poolForfeit';
import { calculateFencerPoolStats } from './poolStats';

/** Assigne les rangs en gérant les ex aequo (V/M + [Q/M + cotations + cartons] + indice + TD identiques) */
function assignRanks(rankings: PoolRanking[], useQuest = true): void {
  let currentRank = 1;
  for (let i = 0; i < rankings.length; i++) {
    if (i > 0) {
      const prev = rankings[i - 1];
      const curr = rankings[i];
      const sameVictories = prev.ratio === curr.ratio;
      const sameQuest =
        !useQuest ||
        (getQuestPerMatch(prev) === getQuestPerMatch(curr) &&
          compareQuestVictories(prev, curr) === 0);
      const sameCards = !useQuest || (prev.totalCards ?? 0) === (curr.totalCards ?? 0);
      const sameIndex = prev.index === curr.index;
      const sameTouches = prev.touchesScored === curr.touchesScored;

      if (sameVictories && sameQuest && sameCards && sameIndex && sameTouches) {
        rankings[i].rank = rankings[i - 1].rank;
      } else {
        rankings[i].rank = currentRank;
      }
    } else {
      rankings[i].rank = currentRank;
    }
    currentRank++;
  }
}

/**
 * Calcule le classement d'une poule selon les règles FIE/FFE
 * Ordre de priorité:
 * 1. Ratio V/M (décroissant)
 * 2. Indice (TD - TR) (décroissant)
 * 3. Touches données (décroissant)
 * 4. Confrontation directe (si 2 tireurs à égalité)
 * Les points Quest ne s'appliquent qu'au Sabre Laser (calculatePoolRankingQuest).
 */
export function calculatePoolRanking(pool: Pool): PoolRanking[] {
  if (!pool) throw new TypeError('calculatePoolRanking: pool ne peut pas être null/undefined');
  if (!Array.isArray(pool.fencers))
    throw new TypeError('calculatePoolRanking: pool.fencers doit être un tableau');
  if (!Array.isArray(pool.matches))
    throw new TypeError('calculatePoolRanking: pool.matches doit être un tableau');
  const rankings: PoolRanking[] = [];
  const forfeitFencers: PoolRanking[] = [];

  // Calculer les stats pour chaque tireur
  for (const fencer of pool.fencers) {
    // Si tireur forfait/abandon/exclu, l'ajouter à la liste séparée
    if (isForfeitStatus(fencer.status)) {
      forfeitFencers.push({
        fencer,
        rank: 0,
        victories: 0,
        defeats: 0,
        matchesPlayed: 0,
        touchesScored: 0,
        touchesReceived: 0,
        index: 0,
        ratio: 0,
        questPoints: 0,
      });
      continue;
    }

    const stats = calculateFencerPoolStats(fencer, pool.matches);

    // Calculer les points Quest
    const questStats = calculateFencerQuestStats(fencer, pool.matches);

    rankings.push({
      fencer,
      rank: 0,
      victories: stats.victories,
      defeats: stats.defeats,
      matchesPlayed: stats.matchesPlayed,
      touchesScored: stats.touchesScored,
      touchesReceived: stats.touchesReceived,
      index: stats.index,
      ratio: stats.victoryRatio,
      questPoints: questStats.questPoints,
      maxSingleMatchScore: stats.maxSingleMatchScore ?? 0,
    });
  }

  // Pré-construire une Map de matchs directs pour éviter O(n) dans le comparateur
  // Clé: `${idA}:${idB}` (les deux ordres sont stockés)
  const directMatchMap = new Map<string, Match>();
  for (const m of pool.matches) {
    if (m.fencerA && m.fencerB && m.status === MatchStatus.FINISHED) {
      directMatchMap.set(`${m.fencerA.id}:${m.fencerB.id}`, m);
      directMatchMap.set(`${m.fencerB.id}:${m.fencerA.id}`, m);
    }
  }

  // Trier selon les critères demandés
  rankings.sort((a, b) => {
    // 1. Ratio de victoires V/M (décroissant)
    if (a.ratio !== b.ratio) {
      return b.ratio - a.ratio;
    }

    // 2. Indice TD-TR (décroissant) — critère officiel FIE/FFE de départage
    if (a.index !== b.index) {
      return b.index - a.index;
    }

    // 3. Touches données (décroissant)
    if (a.touchesScored !== b.touchesScored) {
      return b.touchesScored - a.touchesScored;
    }

    // 4. Confrontation directe — O(1) grâce à la Map
    const directMatch = directMatchMap.get(`${a.fencer.id}:${b.fencer.id}`);
    if (directMatch) {
      const aIsFirst = directMatch.fencerA?.id === a.fencer.id;
      const aScore = aIsFirst ? directMatch.scoreA : directMatch.scoreB;
      return aScore?.isVictory ? -1 : 1;
    }

    // En cas d'égalité parfaite, trier par classement initial
    return (a.fencer.ranking ?? 9999) - (b.fencer.ranking ?? 9999);
  });

  assignRanks(rankings, false);
  appendForfeitFencers(rankings, forfeitFencers);

  return rankings;
}

/**
 * Calcule le classement d'une poule selon les règles Quest (Sabre Laser, règlement 2026)
 * Ordre de priorité:
 * 1. Victoires/matchs
 * 2. Points Quest/matchs (Q/M)
 * 3. Indice (TD-TR)
 * 4. Victoires par cotation la plus élevée (V4, puis V3, V2, V1)
 * 5. Moins de cartons, puis classement initial
 */
export function calculatePoolRankingQuest(
  pool: Pool,
  cardsByFencer: Record<string, number> = {}
): PoolRanking[] {
  const rankings: PoolRanking[] = [];
  const forfeitFencers: PoolRanking[] = [];

  for (const fencer of pool.fencers) {
    // Sabre Laser : un tireur forfait/abandon garde son classement acquis
    // (calculé sur ses matchs réellement disputés). Seul l'exclu est classé d'office en dernier.
    if (fencer.status === FencerStatus.EXCLUDED) {
      forfeitFencers.push({
        fencer,
        rank: 0,
        victories: 0,
        defeats: 0,
        matchesPlayed: 0,
        touchesScored: 0,
        touchesReceived: 0,
        index: 0,
        ratio: 0,
        questPoints: 0,
        questVictories4: 0,
        questVictories3: 0,
        questVictories2: 0,
        questVictories1: 0,
        totalCards: cardsByFencer[fencer.id] ?? 0,
      });
      continue;
    }

    const stats = calculateFencerPoolStats(fencer, pool.matches, {
      keepPlayedForfeitMatches: true,
    });
    const questStats = calculateFencerQuestStats(fencer, pool.matches);

    rankings.push({
      fencer,
      rank: 0,
      victories: stats.victories,
      defeats: stats.defeats,
      matchesPlayed: stats.matchesPlayed,
      touchesScored: stats.touchesScored,
      touchesReceived: stats.touchesReceived,
      index: stats.index,
      ratio: stats.victoryRatio,
      questPoints: questStats.questPoints,
      questVictories4: questStats.v4,
      questVictories3: questStats.v3,
      questVictories2: questStats.v2,
      questVictories1: questStats.v1,
      totalCards: cardsByFencer[fencer.id] ?? 0,
    });
  }

  rankings.sort((a, b) => {
    const cmp = compareQuestRanking(a, b);
    if (cmp !== 0) return cmp;

    const aCards = a.totalCards ?? 0;
    const bCards = b.totalCards ?? 0;
    if (aCards !== bCards) return aCards - bCards;

    return (a.fencer.ranking ?? 9999) - (b.fencer.ranking ?? 9999);
  });

  assignRanks(rankings);
  appendForfeitFencers(rankings, forfeitFencers);

  return rankings;
}

/**
 * Calcule le classement général Quest à partir de toutes les poules (règlement 2026)
 * Ordre de priorité:
 * 1. Victoires/matchs (décroissant)
 * 2. Points Quest/matchs (décroissant)
 * 3. Indice TD-TR (décroissant)
 * 4. V4 décroissant, puis V3, V2, V1
 */
export function calculateOverallRankingQuest(pools: Pool[]): PoolRanking[] {
  const allRankings: PoolRanking[] = [];
  const forfeitIds = collectForfeitIds(pools);

  pools.forEach(pool => {
    const ranking = calculatePoolRankingQuest(pool);
    allRankings.push(...ranking);
  });

  // Fusionner les stats du même tireur (multi-tours de poules)
  const { active: mergedRankings, forfeit } = splitForfeit(
    mergeFencerRankings(allRankings),
    forfeitIds
  );

  // Égalité parfaite : l'ordre est conservé (barrage si besoin)
  mergedRankings.sort(compareQuestRanking);

  assignRanks(mergedRankings);
  appendForfeitFencers(mergedRankings, forfeit);

  return mergedRankings;
}

/**
 * Fusionne les entrées de classement du même tireur (multi-tours de poules).
 * Additionne victoires, défaites, touches, et recalcule ratio et indice.
 */
function mergeFencerRankings(rankings: PoolRanking[]): PoolRanking[] {
  const byFencer = new Map<string, PoolRanking>();
  for (const r of rankings) {
    const existing = byFencer.get(r.fencer.id);
    if (!existing) {
      byFencer.set(r.fencer.id, { ...r });
    } else {
      existing.victories += r.victories;
      existing.defeats += r.defeats;
      existing.matchesPlayed += r.matchesPlayed;
      existing.touchesScored += r.touchesScored;
      existing.touchesReceived += r.touchesReceived;
      existing.index = existing.touchesScored - existing.touchesReceived;
      existing.ratio = existing.matchesPlayed > 0 ? existing.victories / existing.matchesPlayed : 0;
      existing.maxSingleMatchScore = Math.max(
        existing.maxSingleMatchScore ?? 0,
        r.maxSingleMatchScore ?? 0
      );
      existing.questPoints = (existing.questPoints ?? 0) + (r.questPoints ?? 0);
      existing.questVictories4 = (existing.questVictories4 ?? 0) + (r.questVictories4 ?? 0);
      existing.questVictories3 = (existing.questVictories3 ?? 0) + (r.questVictories3 ?? 0);
      existing.questVictories2 = (existing.questVictories2 ?? 0) + (r.questVictories2 ?? 0);
      existing.questVictories1 = (existing.questVictories1 ?? 0) + (r.questVictories1 ?? 0);
    }
  }
  return Array.from(byFencer.values());
}

/**
 * Calcule le classement général à partir de toutes les poules
 * Combine les classements de chaque poule selon les règles FIE
 */
export function calculateOverallRanking(pools: Pool[]): PoolRanking[] {
  // Collecter tous les classements de poules
  const allRankings: PoolRanking[] = [];
  const forfeitIds = collectForfeitIds(pools);

  pools.forEach(pool => {
    if (pool.ranking && pool.ranking.length > 0) {
      allRankings.push(...pool.ranking);
    } else {
      // Calculer le classement si pas déjà fait
      const ranking = calculatePoolRanking(pool);
      allRankings.push(...ranking);
    }
  });

  // Fusionner les stats du même tireur (multi-tours de poules)
  const mergedRankings = mergeFencerRankings(allRankings);

  const { active, forfeit } = splitForfeit(mergedRankings, forfeitIds);

  active.sort((a, b) => {
    // 1. Ratio de victoires V/M
    if (a.ratio !== b.ratio) {
      return b.ratio - a.ratio;
    }
    // 2. Indice TD-TR (critère officiel FIE/FFE)
    if (a.index !== b.index) {
      return b.index - a.index;
    }
    // 3. Touches données
    if (a.touchesScored !== b.touchesScored) {
      return b.touchesScored - a.touchesScored;
    }
    // 4. Égalité parfaite - ex aequo (tirage au sort manuel)
    return 0;
  });

  assignRanks(active, false);
  appendForfeitFencers(active, forfeit);

  return active;
}

// Génère un classement initial depuis la liste des tireurs (sans données de poules)
export function generateInitialRanking(fencers: Fencer[]): PoolRanking[] {
  return fencers.map((fencer, index) => ({
    fencer,
    rank: index + 1,
    victories: 0,
    defeats: 0,
    matchesPlayed: 0,
    touchesScored: 0,
    touchesReceived: 0,
    index: 0,
    ratio: 0,
    questPoints: 0,
  }));
}

/** Renvoie les IDs des tireurs classés 1er dans leur poule respective */
export function getPoolWinnerIds(pools: Pool[]): Set<string> {
  const ids = new Set<string>();
  for (const pool of pools) {
    const ranking = pool.ranking?.length ? pool.ranking : calculatePoolRanking(pool);
    ranking.filter(r => r.rank === 1).forEach(r => ids.add(r.fencer.id));
  }
  return ids;
}

/** Filtre le classement général pour ne garder que les vainqueurs de poule */
export function filterPoolWinners(pools: Pool[], overallRanking: PoolRanking[]): PoolRanking[] {
  const winnerIds = getPoolWinnerIds(pools);
  return overallRanking
    .filter(r => winnerIds.has(r.fencer.id))
    .map((r, i) => ({ ...r, rank: i + 1 }));
}
