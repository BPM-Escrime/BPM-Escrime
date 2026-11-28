/**
 * Classement final des équipes dans le domaine (ADR-0044, G0d) : même résultat que
 * computeTeamFinalRanking (qui délègue), petite finale, éliminées à l'issue des poules.
 */
import { describe, expect, it } from 'vitest';
import type { TeamMatchRow, TeamRow } from './team.types';
import { placeRankedTeamsInTable } from './teamCalculations';
import { teamFinalRanking } from './teamFinalRanking';
import { computeTeamFinalRanking } from '../../utils/pdfExport/teamPdf';

const team = (id: string): TeamRow => ({ id, name: id, club: id, fencers: [] });
const played = (
  id: string,
  round: number,
  position: number,
  a: string,
  b: string,
  winner: string | null
): TeamMatchRow => ({
  id,
  round,
  position,
  teamAId: a,
  teamBId: b,
  scoreBoutsA: 0,
  scoreBoutsB: 0,
  status: winner ? 'finished' : 'in_progress',
  winnerId: winner,
  currentBoutIndex: 0,
  bouts: [],
});

/** Tableau de 8 placé au classement : quarts, demies, finale (vainqueurs donnés) */
function tableau8(teams: TeamRow[], quarters: string[], semis: string[], final?: string) {
  const p = placeRankedTeamsInTable(teams, 8).map(t => t!.id);
  const out = [0, 1, 2, 3].map(k => played(`q${k}`, 4, k, p[2 * k], p[2 * k + 1], quarters[k]));
  out.push(played('s0', 2, 0, quarters[0], quarters[1], semis[0]));
  out.push(played('s1', 2, 1, quarters[2], quarters[3], semis[1]));
  if (final !== undefined) out.push(played('f', 1, 0, semis[0], semis[1], final));
  return out;
}

describe('teamFinalRanking (docs/adr/0044)', () => {
  const teams = 'ABCDEFGH'.split('').map(team);
  const p = placeRankedTeamsInTable(teams, 8).map(t => t!.id);
  const quarters = [0, 1, 2, 3].map(k => p[2 * k]);
  const semis = [quarters[0], quarters[2]];

  it('computeTeamFinalRanking (écran, PDF, exports) délègue au domaine : rangs d’avant', () => {
    for (const ms of [
      tableau8(teams, quarters, semis, semis[1]),
      tableau8(teams, quarters, semis),
      [],
    ]) {
      expect(teamFinalRanking(teams, ms)).toEqual(computeTeamFinalRanking(teams, ms));
    }
    const ranked = teamFinalRanking(teams, tableau8(teams, quarters, semis, semis[1]));
    expect(ranked.rows.map(r => r.rank)).toEqual([1, 2, 3, 3, 5, 5, 5, 5]);
  });

  it('petite finale jouée : vainqueur 3e, perdant 4e', () => {
    const losers = [quarters[1], quarters[3]];
    const ms = [
      ...tableau8(teams, quarters, semis, semis[0]),
      played('t', 1, 1, losers[0], losers[1], losers[1]),
    ];
    const { rows, provisional } = teamFinalRanking(teams, ms);
    expect(provisional).toBe(false);
    expect(rows.slice(0, 4).map(r => [r.team.id, r.rank])).toEqual([
      [semis[0], 1],
      [semis[1], 2],
      [losers[1], 3],
      [losers[0], 4],
    ]);
    expect(rows.slice(4).map(r => r.rank)).toEqual([5, 5, 5, 5]);
  });

  it('éliminées à l’issue des poules : après les équipes du tableau, dans l’ordre donné', () => {
    const four = teams.slice(0, 4);
    const { rows } = teamFinalRanking(four, [], [team('X'), team('Y')]);
    expect(rows.map(r => [r.team.id, r.rank])).toEqual([
      ['A', 1],
      ['B', 2],
      ['C', 3],
      ['D', 4],
      ['X', 5],
      ['Y', 6],
    ]);
  });
});
