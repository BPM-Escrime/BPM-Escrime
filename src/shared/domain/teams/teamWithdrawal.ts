/**
 * BPM - Escrime - Équipe retirée ou exclue : règles pures (docs/adr/0028 § 4)
 * - o.99.7.a : équipe incomplète qui abandonne, rencontre perdue, garde sa place ;
 * - o.99.7.b : tireur exclu (noir individuel, armes olympiques), rencontre perdue, équipe exclue
 *   sans classement final ;
 * - o.99.8 (règles individuelles o.74.3, o.79.2) : ses résultats de poule sont annulés.
 * Licensed under GPL-3.0
 */

export type TeamWithdrawalReason = 'exclusion' | 'abandon';

export interface TeamWithdrawal {
  teamId: string;
  /** Rencontre perdue par le retrait */
  matchId: string;
  reason: TeamWithdrawalReason;
}

interface MeetingTeams {
  teamAId: string;
  teamBId: string;
}

/** Rencontre d'une équipe retirée ou exclue */
export const involvesWithdrawn = (m: MeetingTeams, withdrawn: ReadonlySet<string>): boolean =>
  withdrawn.has(m.teamAId) || withdrawn.has(m.teamBId);

/**
 * Classement de poule sans les équipes retirées ni leurs rencontres (o.99.8, o.74.3 : résultats
 * annulés, y compris ceux déjà acquis par leurs adversaires)
 */
export function withoutWithdrawnTeams<T extends { id: string }, M extends MeetingTeams>(
  teams: readonly T[],
  matches: readonly M[],
  withdrawn: ReadonlySet<string>
): { teams: T[]; matches: M[] } {
  return {
    teams: teams.filter(t => !withdrawn.has(t.id)),
    matches: matches.filter(m => !involvesWithdrawn(m, withdrawn)),
  };
}

interface OrderedMeeting extends MeetingTeams {
  id: string;
  status: string;
  bouts: ReadonlyArray<{ status: string }>;
}

/**
 * Rencontre suivante de l'équipe déjà commencée : une rencontre de l'équipe placée après
 * `matchId` dans l'ordre fourni (poules dans l'ordre du calendrier, puis tableau) a un relais
 * commencé ou terminé
 */
export function nextTeamMatchStarted(
  ordered: readonly OrderedMeeting[],
  matchId: string,
  teamId: string
): boolean {
  const at = ordered.findIndex(m => m.id === matchId);
  if (at < 0) return false;
  return ordered
    .slice(at + 1)
    .some(
      m =>
        (m.teamAId === teamId || m.teamBId === teamId) &&
        (m.status !== 'not_started' || m.bouts.some(b => b.status !== 'not_started'))
    );
}
