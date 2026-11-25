/**
 * BPM - Escrime - Tableau arrêté quand il reste N tireurs (#2013 étape D2, ADR-0037)
 * Le tableau est construit comme d'habitude ; seuls les tours où il reste plus de N tireurs se
 * jouent. À l'arrêt, les N restants passent à la phase suivante dans l'ordre de leur rang
 * d'entrée ; les éliminés sont classés par tour atteint (le plus loin devant), puis par rang
 * d'entrée (Q5). Domaine pur.
 * Licensed under GPL-3.0
 */

import type { Fencer } from '../../types';
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
