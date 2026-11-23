/**
 * BPM - Escrime - Écritures d'équipe d'une version antérieure, pour les tests de reprise
 * (docs/adr/0024 : « les rencontres et relais en base sont repris tels quels (UUID) »).
 * L'écran et l'arène écrivaient les tables sans journal ; ces chemins n'existent plus
 * (lots E3, E4). Réservé aux tests.
 * Licensed under GPL-3.0
 */
import { randomUUID } from 'crypto';
import type { DatabaseManager } from '../index';

/** Rencontre de poule à identifiant UUID et ses relais, sans journal */
export function insertLegacyTeamMatch(
  db: DatabaseManager,
  m: {
    competitionId: string;
    poolNumber?: number;
    teamAId: string;
    teamBId: string;
    /** Tireurs des relais, dans l'ordre */
    relays: Array<[fencerAId: string, fencerBId: string]>;
    maxScore?: number;
  }
): { id: string; boutIds: string[] } {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.teams.insertTeamPoolMatch({
    id,
    competitionId: m.competitionId,
    poolNumber: m.poolNumber ?? 1,
    round: null,
    teamAId: m.teamAId,
    teamBId: m.teamBId,
    createdAt,
  });
  const boutIds = m.relays.map(([fencerAId, fencerBId], k) => {
    const boutId = randomUUID();
    db.teams.insertTeamBout({
      id: boutId,
      matchId: id,
      order: k + 1,
      fencerAId,
      fencerBId,
      maxScore: m.maxScore ?? 45,
      createdAt,
    });
    return boutId;
  });
  return { id, boutIds };
}

/**
 * Relais écrit par la base comme l'ancien `updateTeamBout` : score et statut du relais, puis
 * rencontre recalculée (cumul, statut, vainqueur au cumul, relais courant).
 */
export function writeLegacyRelay(
  db: DatabaseManager,
  matchId: string,
  boutId: string,
  r: { scoreA: number; scoreB: number; status: string; winnerId?: string | null }
): void {
  const at = new Date().toISOString();
  db.teams.setTeamBoutResult(boutId, { ...r, winnerId: r.winnerId ?? null, at });
  const m = db.teams.getTeamMatch(matchId);
  if (!m || r.status !== 'finished') return;
  const scoreA = m.bouts.reduce((s, b) => s + b.scoreA, 0);
  const scoreB = m.bouts.reduce((s, b) => s + b.scoreB, 0);
  const done = m.bouts.filter(b => b.status === 'finished').length;
  const all = done === m.bouts.length;
  db.teams.setTeamMatchResult(matchId, {
    scoreA,
    scoreB,
    status: all ? 'finished' : 'in_progress',
    winnerId: !all ? null : scoreA > scoreB ? m.teamAId : scoreB > scoreA ? m.teamBId : null,
    currentBoutIndex: done,
    at,
  });
}
