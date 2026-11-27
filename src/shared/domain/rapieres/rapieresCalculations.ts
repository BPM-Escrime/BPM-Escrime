/**
 * BPM - Escrime - Tournoi des rapières : calculs (#1118)
 * Répartition des poules par niveau, vagues de rencontres, qualification pour le tableau,
 * classements par niveau et par catégorie d'âge.
 * Licensed under GPL-3.0
 */

import type { Fencer, PoolRanking } from '../../types';
import { finalRanking } from '../ranking/finalRanking';
import { POOL_WAVES_SIZE } from '../pools/waves';
import type { RankingFilterKey, RankingSubject } from '../ranking/rankingFilters';
import { RapieresFencer, RapieresTeamInfo } from './rapieres.types';
import { rapieresTeamCategory, rapieresTeamGender } from './rapieresAge';

export const RAPIERES_MAX_POOL_SIZE = POOL_WAVES_SIZE.max;

/** Prénom affiché de l'équipe : noms des deux tireurs */
export const teamMembersLabel = (fencers: [RapieresFencer, RapieresFencer]): string =>
  fencers
    .map(f => f.lastName.trim().toUpperCase())
    .filter(Boolean)
    .join(' / ');

// ─── Vagues ──────────────────────────────────────────────────────────────────
// Déplacées dans shared/domain/pools/waves.ts (docs/adr/0043, F4a) : réexportées jusqu'à F4e.
export {
  applyClassicOrder,
  canLaunchNextWave,
  isWaveComplete,
  pairKey,
  poolMatchWaves,
  scheduleWaves,
  waveCount,
  waveMatchIds,
  waveMatchOrder,
  waveSheetMatches,
} from '../pools/waves';

// ─── Qualification ───────────────────────────────────────────────────────────
// Règles du tableau des rapières : src/shared/domain/rapieres/tableauQualifiers.ts (#1979)
export {
  rapieresSemifinalists,
  rapieresTableauQualifiers,
  rapieresTableauSettings,
} from './tableauQualifiers';

// ─── Filtres de classement ───────────────────────────────────────────────────
// `filterRanking` est dans le domaine générique (shared/domain/ranking/rankingFilters.ts,
// docs/adr/0043, F4d) ; le mode spécial lui fournit les valeurs de l'équipe.

/** Filtres du mode rapières quand la formule n'en règle pas : catégorie, sexe, niveau, HANDI */
export const RAPIERES_RANKING_FILTERS: readonly RankingFilterKey[] = [
  'category',
  'gender',
  'level',
  'handicap',
];

/**
 * Valeurs d'une équipe pour les filtres génériques : catégorie d'équipe (moyenne des années de
 * naissance), sexe d'équipe (M, F, MIXED), niveau (code) et marqueur HANDI (distinct de la
 * catégorie).
 */
export function rapieresRankingSubject(team: RapieresTeamInfo, refDate: Date): RankingSubject {
  const category = rapieresTeamCategory(team, refDate);
  return {
    ...(category !== 'HANDI' ? { category } : {}),
    ...(rapieresTeamGender(team) ? { gender: rapieresTeamGender(team) } : {}),
    level: team.level,
    handicap: team.fencers.some(f => f.category === 'HANDI'),
  };
}

/** Numéro de poule de chaque équipe (première poule trouvée) */
export function rapieresPoolNumbers(
  pools: { number: number; fencers: { id: string }[] }[]
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pool of pools)
    for (const f of pool.fencers) if (out[f.id] === undefined) out[f.id] = pool.number;
  return out;
}

// ─── Classement final ────────────────────────────────────────────────────────

/**
 * Classement final des équipes : celui du classement final générique (`finalRanking`) : le
 * tableau, puis les non-qualifiées dans l'ordre des poules ; une équipe exclue au bas sans rang
 * (`null`), les autres renumérotées (docs/adr/0043 amendée, F4d). Alias jusqu'à F4e.
 */
export function mergeFinalRanking(
  tableauResults: { fencer: Fencer; rank: number }[],
  overall: PoolRanking[]
): { teamId: string; rank: number | null }[] {
  return finalRanking({ finalResults: tableauResults, poolRanking: overall }).map(r => ({
    teamId: r.fencer.id,
    rank: r.rank,
  }));
}
