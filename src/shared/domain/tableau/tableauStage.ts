/**
 * BPM - Escrime - Tableau arrêté quand il reste N tireurs (#2013 étape D2, ADR-0037)
 * Le tableau est construit comme d'habitude ; seuls les tours où il reste plus de N tireurs se
 * jouent. À l'arrêt, les N restants passent à la phase suivante dans l'ordre de leur rang
 * d'entrée ; les éliminés sont classés par tour atteint (le plus loin devant), puis par rang
 * d'entrée (Q5). Domaine pur.
 * Licensed under GPL-3.0
 */

import type { Fencer, PoolRanking } from '../../types';
import type { TableauMatch } from './tableauTypes';

/** Matchs joués avant l'arrêt : tours où il reste plus de `stopAt` tireurs */
export const stageMatches = (matches: TableauMatch[], stopAt: number): TableauMatch[] =>
  matches.filter(m => m.round > stopAt);

/** Tous les matchs avant l'arrêt sont décidés (vainqueur, ou exempt) */
export const isStageDone = (matches: TableauMatch[], stopAt: number): boolean => {
  const played = stageMatches(matches, stopAt);
  return played.length > 0 && played.every(m => m.isBye || !!m.winner);
};

/** Rang d'entrée de chaque tireur (seedA / seedB posés au tirage, #1996) */
export function entrySeeds(matches: TableauMatch[]): Map<string, number> {
  const seeds = new Map<string, number>();
  for (const m of matches) {
    if (m.fencerA && m.seedA != null && !seeds.has(m.fencerA.id)) seeds.set(m.fencerA.id, m.seedA);
    if (m.fencerB && m.seedB != null && !seeds.has(m.fencerB.id)) seeds.set(m.fencerB.id, m.seedB);
  }
  return seeds;
}

export interface StageOutcome {
  /** N restants, par rang d'entrée : ordre d'entrée dans la phase suivante */
  qualified: Fencer[];
  /** Éliminés, du mieux classé au moins bien : tour atteint, puis rang d'entrée */
  eliminated: Array<{ fencer: Fencer; round: number; seed: number }>;
}

/**
 * Issue de l'étape : refusée (null) tant qu'un match avant l'arrêt n'est pas décidé.
 * `round` d'un éliminé : taille du tour où il a perdu (32, 16…).
 */
export function closeStage(matches: TableauMatch[], stopAt: number): StageOutcome | null {
  if (!isStageDone(matches, stopAt)) return null;
  const seeds = entrySeeds(matches);
  const seedOf = (f: Fencer) => seeds.get(f.id) ?? Number.MAX_SAFE_INTEGER;
  const eliminated: StageOutcome['eliminated'] = [];
  const winners = new Set<string>();
  const played = stageMatches(matches, stopAt);
  // Tours dans l'ordre (le plus grand d'abord) : le vainqueur d'un tour avance au suivant
  for (const m of [...played].sort((a, b) => b.round - a.round)) {
    if (!m.winner) continue;
    winners.add(m.winner.id);
    const loser = m.fencerA?.id === m.winner.id ? m.fencerB : m.fencerA;
    if (loser && !m.isBye) eliminated.push({ fencer: loser, round: m.round, seed: seedOf(loser) });
  }
  // Restants : vainqueurs du dernier tour joué (round = 2 × stopAt, ou plus petit tour joué)
  const lastRound = Math.min(...played.map(m => m.round));
  const qualified = played
    .filter(m => m.round === lastRound && m.winner)
    .map(m => m.winner as Fencer)
    .sort((a, b) => seedOf(a) - seedOf(b));
  eliminated.sort((a, b) => a.round - b.round || a.seed - b.seed);
  return { qualified, eliminated };
}

/** Étape close gardée dans l'état de session (`stageHistory`, ADR-0037) */
export interface TableauStageRecord {
  kind: 'tableau';
  stopAt: number;
  matches: TableauMatch[];
  /** Éliminés dans l'ordre du classement (Q5) ; `round` : tour où le tireur a perdu */
  eliminated: Array<{ fencerId: string; round: number; seed: number }>;
}

/** Étapes « tableau » closes d'un état de session (absent, mal formé : aucune) */
export const tableauStagesOf = (stageHistory: unknown): TableauStageRecord[] =>
  Array.isArray(stageHistory)
    ? (stageHistory as TableauStageRecord[]).filter(
        s => s?.kind === 'tableau' && Array.isArray(s.eliminated) && Array.isArray(s.matches)
      )
    : [];

/** Libellé « éliminé à » d'un tireur sorti d'un tableau arrêté */
export const stageEliminatedAt = (round: number): string => `Tableau de ${round}`;

/**
 * Classement final d'une épreuve dont un tableau a été arrêté (Q5, ADR-0037) : les restants
 * selon la phase suivante (ordre du classement reçu), puis les éliminés du tableau arrêté
 * (tour atteint, puis rang d'entrée), puis les autres (éliminés des poules, ordre reçu). Rangs
 * renumérotés, égalités gardées. Sans étape close : classement inchangé.
 */
export function rankAfterStages(
  ranking: PoolRanking[],
  stages: TableauStageRecord[]
): { ranking: PoolRanking[]; eliminatedAt: Map<string, string> } {
  const eliminatedAt = new Map<string, string>();
  if (stages.length === 0) return { ranking, eliminatedAt };
  const byId = new Map(ranking.map(r => [r.fencer.id, r]));
  // Étape la plus récente d'abord : ses éliminés sont allés le plus loin
  const stageOut: Array<{ row: PoolRanking; key: string }> = [];
  const out = new Set<string>();
  [...stages].reverse().forEach((stage, s) => {
    for (const e of stage.eliminated) {
      const row = byId.get(e.fencerId);
      if (!row || out.has(e.fencerId)) continue;
      out.add(e.fencerId);
      // Même étape, même tour, même rang d'entrée : ex aequo
      stageOut.push({ row, key: `${s}:${e.round}:${e.seed}` });
      eliminatedAt.set(e.fencerId, stageEliminatedAt(e.round));
    }
  });
  const last = stages[stages.length - 1];
  const entered = new Set(
    last.matches.flatMap(m => [m.fencerA?.id, m.fencerB?.id]).filter((id): id is string => !!id)
  );
  const front = ranking.filter(r => entered.has(r.fencer.id) && !out.has(r.fencer.id));
  const frontIds = new Set(front.map(r => r.fencer.id));
  const rest = ranking.filter(r => !frontIds.has(r.fencer.id) && !out.has(r.fencer.id));
  const result: PoolRanking[] = [...front];
  let tie = 0;
  stageOut.forEach(({ row, key }, i) => {
    if (i === 0 || stageOut[i - 1].key !== key) tie = i;
    result.push({ ...row, rank: front.length + tie + 1 });
  });
  // Autres : égalités du classement reçu gardées
  let prev = NaN;
  let tieStart = 0;
  rest.forEach((r, i) => {
    if (r.rank !== prev) {
      tieStart = i;
      prev = r.rank;
    }
    result.push({ ...r, rank: front.length + stageOut.length + tieStart + 1 });
  });
  return { ranking: result, eliminatedAt };
}

/**
 * Classement qui répartit le tour de poules suivant un tableau arrêté (Q5, ADR-0037) : les
 * restants dans l'ordre de leur rang d'entrée au tableau. `ranking` fournit les lignes (tour
 * qui précède le tableau) ; seuls les restants sont gardés, rang = rang d'entrée.
 */
export function rankingAfterStage(
  ranking: PoolRanking[],
  stage: TableauStageRecord
): PoolRanking[] {
  const out = new Set(stage.eliminated.map(e => e.fencerId));
  const seeds = entrySeeds(stage.matches);
  return ranking
    .filter(r => seeds.has(r.fencer.id) && !out.has(r.fencer.id))
    .map(r => ({ ...r, rank: seeds.get(r.fencer.id) as number }))
    .sort((a, b) => a.rank - b.rank);
}

/**
 * Tableau des résultats et de leurs exports (PDF du tableau, livret, XML) : le tableau en cours,
 * sinon le tableau arrêté clos (ADR-0037 : une étape close reste consultable)
 */
export const resultsTableauMatches = (
  current: TableauMatch[],
  closed: TableauStageRecord | undefined
): TableauMatch[] => (current.length === 0 && closed ? closed.matches : current);
