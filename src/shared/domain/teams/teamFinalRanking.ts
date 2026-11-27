/**
 * BPM - Escrime - Classement final des équipes (ADR-0044), repris de computeTeamFinalRanking
 * (écran, PDF, exports) : même résultat. Vainqueur du tableau 1er, finaliste 2e, perdants d'un
 * tour de N rencontres classés N+1 ex æquo (3e, 5e, 9e…), départagés par le classement d'entrée
 * du tableau. Petite finale jouée (case t1-1) : son vainqueur 3e, son perdant 4e. Équipes
 * éliminées à l'issue des poules (coupe à la barre) : après celles du tableau, dans l'ordre du
 * classement de poule. Domaine pur.
 * Licensed under GPL-3.0
 */
import type { TeamMatchRow, TeamRow } from './team.types';
import {
  calculateTableSize,
  placeRankedTeamsInTable,
  resolveTeamTableauSlot,
} from './teamCalculations';

export interface TeamFinalRankingRow<T extends TeamRow = TeamRow> {
  rank: number;
  team: T;
}

/**
 * Classement final. `rankedTeams` : équipes du tableau dans l'ordre d'entrée (sans tableau :
 * classement de poule) ; `eliminated` : équipes éliminées à l'issue des poules. Équipes encore
 * en lice en tête (classement provisoire). Sans tableau : ordre de poule, provisoire.
 */
export function teamFinalRanking<T extends TeamRow>(
  rankedTeams: T[],
  tableauMatches: TeamMatchRow[],
  eliminated: T[] = []
): { rows: TeamFinalRankingRow<T>[]; provisional: boolean } {
  const after = (rows: TeamFinalRankingRow<T>[]) => [
    ...rows,
    ...eliminated.map((team, i) => ({ rank: rankedTeams.length + i + 1, team })),
  ];
  if (tableauMatches.length === 0 || rankedTeams.length < 2) {
    return {
      rows: after(rankedTeams.map((team, i) => ({ rank: i + 1, team }))),
      provisional: tableauMatches.length === 0 && rankedTeams.length >= 2,
    };
  }
  const tableSize = calculateTableSize(rankedTeams.length);
  const placements = placeRankedTeamsInTable(rankedTeams, tableSize);
  const teamById = new Map(rankedTeams.map(t => [t.id, t]));
  const matchesByKey = new Map(tableauMatches.map(m => [`${m.round}-${m.position}`, m]));
  const eliminatedAt = new Map<string, number>();
  let championId: string | null = null;

  for (let round = tableSize / 2; round >= 1; round /= 2) {
    for (let position = 0; position < round; position++) {
      const slot = resolveTeamTableauSlot(
        round,
        position,
        tableSize,
        placements,
        matchesByKey,
        teamById
      );
      if (round === 1 && slot.isBye && slot.team) championId = slot.team.id;
      const m = slot.match;
      if (!m || m.status !== 'finished' || !m.winnerId || !slot.teamA || !slot.teamB) continue;
      const loser = m.winnerId === slot.teamA.id ? slot.teamB : slot.teamA;
      eliminatedAt.set(loser.id, round);
      if (round === 1) championId = m.winnerId;
    }
  }

  // Petite finale jouée : vainqueur 3e (clé 2), perdant 4e (clé 3)
  const thirdKey = new Map<string, number>();
  const third = matchesByKey.get('1-1');
  if (third?.status === 'finished' && third.winnerId) {
    const loserId = third.winnerId === third.teamAId ? third.teamBId : third.teamAId;
    thirdKey.set(third.winnerId, 2);
    thirdKey.set(loserId, 3);
  }

  const seed = new Map(rankedTeams.map((t, i) => [t.id, i]));
  // Clé : champion 0, encore en lice 0.5, éliminé au tour de N rencontres → N
  const key = (t: TeamRow) =>
    t.id === championId
      ? 0
      : (thirdKey.get(t.id) ?? eliminatedAt.get(t.id) ?? (championId ? Infinity : 0.5));
  const sorted = [...rankedTeams].sort(
    (a, b) => key(a) - key(b) || (seed.get(a.id) ?? 0) - (seed.get(b.id) ?? 0)
  );
  const rows = sorted.map((team, i) => {
    const elim = thirdKey.get(team.id) ?? eliminatedAt.get(team.id);
    return { rank: team.id === championId ? 1 : elim !== undefined ? elim + 1 : i + 1, team };
  });
  return { rows: after(rows), provisional: championId === null };
}
