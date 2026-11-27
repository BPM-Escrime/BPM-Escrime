/**
 * BPM - Escrime - Rang d'entrée effectif d'une équipe (ADR-0044) : `ranking` saisi ou importé ;
 * à défaut, somme des classements des titulaires, à condition que chacun en ait un ; puis le nom.
 * Les équipes au rang saisi passent devant celles au rang calculé, chacune dans l'ordre de son
 * rang ; puis les équipes sans rang, au nom. Les deux échelles ne se mélangent pas (ADR-0044
 * amendée). Sert au serpentin des poules d'équipes, au placement du tableau sans poule et au
 * carton noir P. Domaine pur.
 * Licensed under GPL-3.0
 */
import type { TeamRow } from './team.types';
import { titulars } from './relay';

/** Classement d'un tireur (rang national…) ; absent ou ≤ 0 : non classé */
export type FencerRankingOf = (fencerId: string) => number | null | undefined;

const ranked = (n: number | null | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0;

/**
 * Rang effectif d'une équipe : `ranking` saisi, sinon somme des classements de ses `starters`
 * titulaires s'ils sont tous classés ; null : non classée (rangée au nom)
 */
export function teamEntryKey(
  team: Pick<TeamRow, 'ranking' | 'fencers'>,
  starters: number,
  fencerRanking: FencerRankingOf
): number | null {
  if (ranked(team.ranking)) return team.ranking;
  const ids = titulars(team as TeamRow, starters);
  if (ids.length < starters || ids.length === 0) return null;
  const ranks = ids.map(fencerRanking);
  return ranks.every(ranked) ? ranks.reduce((s, r) => s + r, 0) : null;
}

/**
 * Équipes dans l'ordre d'entrée (1re = la meilleure) : d'abord les équipes au rang saisi, par
 * rang croissant ; puis celles au rang calculé (somme des titulaires), par somme croissante ;
 * puis les équipes sans rang. Les deux échelles ne se comparent jamais ; égalité : le nom.
 */
export function teamEntryRanking<T extends Pick<TeamRow, 'id' | 'name' | 'ranking' | 'fencers'>>(
  teams: readonly T[],
  starters: number,
  fencerRanking: FencerRankingOf
): T[] {
  const keyed = teams.map(team => {
    if (ranked(team.ranking)) return { team, tier: 0, key: team.ranking };
    const sum = teamEntryKey(team, starters, fencerRanking);
    return sum === null ? { team, tier: 2, key: 0 } : { team, tier: 1, key: sum };
  });
  return keyed
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        a.key - b.key ||
        a.team.name.localeCompare(b.team.name, 'fr') ||
        a.team.id.localeCompare(b.team.id)
    )
    .map(x => x.team);
}

/** Rang d'entrée (dès 1) de chaque équipe, dans l'ordre de `teamEntryRanking` */
export function teamEntryRanks(teams: readonly Pick<TeamRow, 'id'>[]): Map<string, number> {
  return new Map(teams.map((t, i) => [t.id, i + 1]));
}
