/**
 * BPM - Escrime - Classement d'entrée du tableau d'équipes d'une formule (ADR-0044) : classement
 * de poule (ratio V/M toutes poules confondues, indice des relais, indice des touches) coupé à la barre par la
 * qualification du tour (`cutAtBar`, ADR-0040), ou, sans tour de poules, le rang d'entrée
 * effectif des équipes. Domaine pur : hasard injecté (ex aequo tirés au sort).
 * Licensed under GPL-3.0
 */
import type { AdvancementRule } from '../../types';
import { cutAtBar, getAdvancementCount, type TiedAtBar } from '../ranking/advancement';
import type { TeamMatchRow, TeamRow } from './team.types';
import {
  calculateTeamOverallRanking,
  sameOverallStanding,
  type TeamOverallRankingRow,
} from './teamCalculations';

/** Ligne du classement de poule avec son rang ; rang partagé par les équipes à égalité */
export interface RankedTeamPoolRow extends TeamOverallRankingRow {
  rank: number;
}

/**
 * Classement de poule toutes poules confondues (calculateTeamOverallRanking : ratio V/M, indice
 * des relais, indice des touches ; poule unique : victoires) avec ses rangs : égalité → même rang
 */
export function rankedTeamPool(teams: TeamRow[], matches: TeamMatchRow[]): RankedTeamPoolRow[] {
  const rows = calculateTeamOverallRanking(teams, matches);
  const out: RankedTeamPoolRow[] = [];
  rows.forEach((row, i) => {
    const prev = out[i - 1];
    out.push({
      ...row,
      rank: prev && sameOverallStanding(prev, row, matches) ? prev.rank : i + 1,
    });
  });
  return out;
}

export interface TeamTableauEntry {
  /** Équipes du tableau, dans l'ordre d'entrée (tête de série 1 d'abord) */
  qualified: TeamRow[];
  /** Équipes éliminées à l'issue des poules, dans l'ordre du classement de poule */
  eliminated: TeamRow[];
  tiedAtBar: TiedAtBar | null;
}

/**
 * Classement d'entrée du tableau : avec un tour de poules, classement de poule coupé par
 * `qualification` (tous, nombre, pourcentage ; ex aequo à la barre : `ties`, départagés au
 * rang d'entrée `entryOrder` ou tirés au sort par `random`) ; sans tour de poules, l'ordre
 * d'entrée `entryOrder`.
 */
export function teamTableauEntry(input: {
  /** Équipes classables (sans les équipes retirées, o.99.8) */
  teams: TeamRow[];
  poolMatches: TeamMatchRow[];
  /** Équipes dans l'ordre d'entrée effectif (teamEntryRanking) */
  entryOrder: TeamRow[];
  hasPools: boolean;
  qualification?: AdvancementRule;
  random?: () => number;
}): TeamTableauEntry {
  const ids = new Set(input.teams.map(t => t.id));
  const entry = input.entryOrder.filter(t => ids.has(t.id));
  if (!input.hasPools) return { qualified: entry, eliminated: [], tiedAtBar: null };
  const entryRank = new Map(entry.map((t, i) => [t.id, i + 1]));
  const rows = rankedTeamPool(input.teams, input.poolMatches).map(r => ({
    rank: r.rank,
    team: r.team,
    fencer: { id: r.team.id, ranking: entryRank.get(r.team.id), lastName: r.team.name },
  }));
  const count = getAdvancementCount(rows.length, input.qualification);
  const cut = cutAtBar(rows, count, input.qualification?.ties, undefined, input.random);
  return {
    qualified: cut.qualified.map(r => r.team),
    eliminated: cut.eliminated.map(r => r.team),
    tiedAtBar: cut.tiedAtBar,
  };
}
