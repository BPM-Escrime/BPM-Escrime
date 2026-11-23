/**
 * BPM - Escrime - Tableau d'équipes par le moteur (docs/adr/0024, lot E2)
 * Placement du classement de poule (évitement de revanche en arène Sabre Laser), puis
 * avancement : une rencontre est créée dès que ses deux équipes sont connues (têtes de série,
 * exemptés, vainqueurs du tour précédent). Mêmes règles que l'écran (resolveTeamTableauSlot) :
 * tour = nombre de rencontres du tour (taille / 2 au premier tour, 1 en finale).
 * Pur : ni heure ni hasard.
 * Licensed under GPL-3.0
 */
import type { Weapon } from '../../types';
import type { TeamMatchRow, TeamRow } from './team.types';
import {
  calculateTableSize,
  calculateTeamPoolRanking,
  placeRankedTeamsInTable,
  resolveTeamTableauSlot,
} from './teamCalculations';
import { calculateLaserArenaPoolRanking } from './laserArenaCalculations';
import { applyRematchAvoidanceSwap, buildPoolPairHistory } from './laserArenaBracketRules';
import { planRelays, teamTableauMatchId, type RelayPlan, type TeamFormat } from './relay';

/** Case du premier tour : deux équipes, ou une seule (exempt), ou aucune */
export interface TeamTableauSlot {
  round: number;
  position: number;
  teamAId: string | null;
  teamBId: string | null;
  isBye: boolean;
}

/** Tableau tiré (fait du journal TeamTableauGenerated) */
export interface TeamTableauPlan {
  size: number;
  slots: TeamTableauSlot[];
}

/** Rencontre de tableau déjà créée : seuls sa case, son statut et son vainqueur comptent */
export interface TeamTableauMatchState {
  round: number;
  position: number;
  status: string;
  winnerId: string | null;
}

export interface TeamTableauMatchPlan {
  matchId: string;
  round: number;
  position: number;
  teamAId: string;
  teamBId: string;
  /** null : titulaires manquants d'un côté */
  relays: RelayPlan[] | null;
}

/**
 * Classement de poule qui place le tableau, comme l'écran : relais FIE par victoires, arène
 * Sabre Laser par points, avec l'évitement de revanche au premier tour (5↔6, 7↔8)
 */
export function rankTeamsForTableau(
  teams: TeamRow[],
  poolMatches: TeamMatchRow[],
  format: TeamFormat
): TeamRow[] {
  if (format !== 'laser-arena')
    return calculateTeamPoolRanking(teams, poolMatches).map(r => r.team);
  const ranked = calculateLaserArenaPoolRanking(teams, poolMatches).map(r => r.team);
  return applyRematchAvoidanceSwap(ranked, buildPoolPairHistory(poolMatches));
}

/** Tableau à la taille du classement (puissance de 2), cases du premier tour */
export function planTeamTableau(rankedTeams: TeamRow[]): TeamTableauPlan {
  const size = calculateTableSize(rankedTeams.length);
  const placements = placeRankedTeamsInTable(rankedTeams, size);
  const round = size / 2;
  const slots = Array.from({ length: round }, (_, position) => {
    const a = placements[position * 2]?.id ?? null;
    const b = placements[position * 2 + 1]?.id ?? null;
    return { round, position, teamAId: a, teamBId: b, isBye: !(a && b) };
  });
  return { size, slots };
}

/** Case suivante du vainqueur ; null : finale */
export function nextTableauSlot(
  round: number,
  position: number
): { round: number; position: number } | null {
  return round > 1 ? { round: round / 2, position: Math.floor(position / 2) } : null;
}

/**
 * Rencontres à créer : toute case dont les deux équipes sont connues et qui n'a pas encore de
 * rencontre, du premier tour à la finale. Identifiants déterministes (`${cid}-t${tour}-${pos}`).
 */
export function planTeamTableauMatches(
  competitionId: string,
  tableau: TeamTableauPlan,
  existing: readonly TeamTableauMatchState[],
  teams: readonly TeamRow[],
  teamSize: number,
  weapon: Weapon
): TeamTableauMatchPlan[] {
  const teamById = new Map(teams.map(t => [t.id, t]));
  const placements: (TeamRow | null)[] = new Array(tableau.size).fill(null);
  for (const s of tableau.slots) {
    placements[s.position * 2] = (s.teamAId && teamById.get(s.teamAId)) || null;
    placements[s.position * 2 + 1] = (s.teamBId && teamById.get(s.teamBId)) || null;
  }
  const byKey = new Map<string, TeamMatchRow>(
    existing.map(m => [
      `${m.round}-${m.position}`,
      {
        id: '',
        teamAId: '',
        teamBId: '',
        scoreBoutsA: 0,
        scoreBoutsB: 0,
        currentBoutIndex: 0,
        bouts: [],
        ...m,
      },
    ])
  );
  const out: TeamTableauMatchPlan[] = [];
  for (let round = tableau.size / 2; round >= 1; round /= 2) {
    for (let position = 0; position < round; position++) {
      const slot = resolveTeamTableauSlot(
        round,
        position,
        tableau.size,
        placements,
        byKey,
        teamById
      );
      if (slot.match || !slot.teamA || !slot.teamB) continue;
      const matchId = teamTableauMatchId(competitionId, round, position);
      out.push({
        matchId,
        round,
        position,
        teamAId: slot.teamA.id,
        teamBId: slot.teamB.id,
        relays: planRelays(matchId, slot.teamA, slot.teamB, teamSize, weapon),
      });
      // Rencontre à jouer : son vainqueur n'est pas encore connu
      byKey.set(`${round}-${position}`, {
        id: matchId,
        teamAId: slot.teamA.id,
        teamBId: slot.teamB.id,
        scoreBoutsA: 0,
        scoreBoutsB: 0,
        status: 'not_started',
        winnerId: null,
        currentBoutIndex: 0,
        bouts: [],
      });
    }
  }
  return out;
}
