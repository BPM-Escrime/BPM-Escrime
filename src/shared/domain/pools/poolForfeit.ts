/**
 * BPM - Escrime - Forfaits, abandons et exclusions dans une poule
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
  type Score,
} from '../../types';
import { isWithdrawnStatus } from '../fencers/fencerStatus';

/** Sabre Laser : score attribué à l'adversaire d'un tireur forfait en cours de match */
export const LASER_FORFEIT_WINNER_SCORE = 15;

/** Score d'un tireur forfait/abandon/exclu sur un match annulé (non disputé) */
export function isCancelledForfeitScore(score: Score | null | undefined): boolean {
  return (
    !!score && score.value === null && (score.isForfait || score.isAbstention || score.isExclusion)
  );
}

/**
 * Match annulé suite au forfait/abandon d'un tireur (Sabre Laser) :
 * terminé mais sans score exploitable pour l'un des deux tireurs.
 */
export function isMatchCancelledByForfeit(match: Match): boolean {
  return (
    match.status === MatchStatus.FINISHED &&
    (isCancelledForfeitScore(match.scoreA) ||
      isCancelledForfeitScore(match.scoreB) ||
      match.scoreA?.value == null ||
      match.scoreB?.value == null)
  );
}

/**
 * Match saisi comme forfait / abandon / exclusion (armes olympiques incluses) :
 * considéré non joué, sans effet sur V/M, TD, TR ni indice (#1144).
 *
 * Exception (#2000) : un abandon signalé par l'appareil de piste sur un tireur dont le statut n'a
 * pas (encore) été passé à ABANDONED par le DT reste un combat normal (V pour le vainqueur, touches
 * comptées) ; il n'est annulé qu'une fois le statut posé (FIE o.74). Le même critère que le
 * classement (voidsMatchForOpponent) : la grille et les V/M restent cohérents.
 */
export function isMatchVoidedByForfeit(match: Match): boolean {
  if (match.status !== MatchStatus.FINISHED) return false;
  if (isMatchCancelledByForfeit(match)) return true;
  const flagged = (s: Score | null | undefined) => !!s && (s.isForfait || s.isExclusion);
  if (flagged(match.scoreA) || flagged(match.scoreB)) return true;
  const abandonVoids = (s: Score | null | undefined, fencer: Fencer | null | undefined) =>
    !!s?.isAbstention && (!fencer?.status || isOutStatus(fencer.status));
  return abandonVoids(match.scoreA, match.fencerA) || abandonVoids(match.scoreB, match.fencerB);
}

/** Tireur sorti de la poule (forfait, abandon, exclusion) */
function isOutStatus(status: FencerStatus): boolean {
  return isWithdrawnStatus(status);
}

/** Ajoute les tireurs forfait/abandon/exclu à la fin du classement */
export function appendForfeitFencers(rankings: PoolRanking[], forfeitFencers: PoolRanking[]): void {
  if (forfeitFencers.length > 0) {
    const lastRank = rankings.length + 1;
    forfeitFencers.forEach((ff, idx) => {
      ff.rank = lastRank + idx;
      rankings.push(ff);
    });
  }
}

/** Forfait / abandon en poule : non classé, rang remplacé par « DNF » */
export function isDnf(ranking: { fencer: { status?: FencerStatus } }): boolean {
  return (
    ranking.fencer.status === FencerStatus.FORFAIT ||
    ranking.fencer.status === FencerStatus.ABANDONED
  );
}

/** Forfait / médical déclaré à l'appel sans match de poule commencé : rang remplacé par « DNS » */
export function isDnsRanking(ranking: {
  fencer: { status?: FencerStatus; exclusionReason?: string | null };
}): boolean {
  return isDnf(ranking) && ranking.fencer.exclusionReason === 'dns';
}

/** Statuts classés d'office en fin de classement (forfait, abandon, carton noir) */
export function isForfeitStatus(status: FencerStatus | undefined): boolean {
  return (
    status === FencerStatus.EXCLUDED ||
    status === FencerStatus.FORFAIT ||
    status === FencerStatus.ABANDONED
  );
}

/** IDs des tireurs forfait/abandon/exclus d'après le statut courant des tireurs de poule */
export function collectForfeitIds(pools: Pool[]): Set<string> {
  const ids = new Set<string>();
  for (const pool of pools) {
    for (const f of pool.fencers ?? []) {
      if (isForfeitStatus(f.status)) ids.add(f.id);
    }
  }
  return ids;
}

/** Sépare les tireurs actifs des forfaits/abandons/exclus (classés d'office en dernier) */
export function splitForfeit(
  rankings: PoolRanking[],
  forfeitIds: Set<string>
): { active: PoolRanking[]; forfeit: PoolRanking[] } {
  const active: PoolRanking[] = [];
  const forfeit: PoolRanking[] = [];
  for (const r of rankings) {
    if (forfeitIds.has(r.fencer.id) || isForfeitStatus(r.fencer.status)) forfeit.push(r);
    else active.push(r);
  }
  return { active, forfeit };
}
