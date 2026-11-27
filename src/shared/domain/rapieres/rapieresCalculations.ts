/**
 * BPM - Escrime - Tournoi des rapières : calculs (#1118)
 * Répartition des poules par niveau, vagues de rencontres, qualification pour le tableau,
 * classements par niveau et par catégorie d'âge.
 * Licensed under GPL-3.0
 */

import { Fencer, FencerStatus, PoolRanking } from '../../types';
import { POOL_WAVES_SIZE } from '../pools/waves';
import {
  RapieresAgeCategory,
  RapieresFencer,
  RapieresLevel,
  RapieresTeamGender,
  RapieresTeamInfo,
} from './rapieres.types';
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

/**
 * Filtres cumulables sur les équipes (#1441) : catégorie d'équipe, niveau, sexe d'équipe.
 * Un champ absent = pas de filtre sur ce critère.
 */
export interface RapieresRankingFilter {
  category?: RapieresAgeCategory;
  level?: RapieresLevel;
  gender?: RapieresTeamGender;
}

export interface RapieresDisplayRow {
  rank: number;
  teamId: string;
}

/**
 * Filtre un classement d'équipes déjà ordonné : seules les équipes correspondant à tous les
 * critères actifs sont gardées, rangs recalculés (ex æquo conservés). Une équipe sans
 * composition ne passe aucun filtre actif.
 */
export function filterRanking(
  ranked: { teamId: string; rank: number }[],
  teams: Record<string, RapieresTeamInfo>,
  filter: RapieresRankingFilter,
  /** Date de référence de la catégorie d'âge (saison) */
  refDate: Date
): RapieresDisplayRow[] {
  const active = !!(filter.category || filter.level || filter.gender);
  const kept = ranked.filter(r => {
    const team = teams[r.teamId];
    if (!team) return !active;
    if (filter.category && rapieresTeamCategory(team, refDate) !== filter.category) return false;
    if (filter.level && team.level !== filter.level) return false;
    if (filter.gender && rapieresTeamGender(team) !== filter.gender) return false;
    return true;
  });
  return kept.map((r, i) => ({
    teamId: r.teamId,
    // Ex æquo : même rang que le premier de leur groupe dans la liste filtrée
    rank: i > 0 && kept[i - 1].rank === r.rank ? kept.findIndex(x => x.rank === r.rank) + 1 : i + 1,
  }));
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
 * Classement final des équipes : résultats du tableau, puis équipes non qualifiées dans
 * l'ordre du classement de poules ; équipes exclues en dernier.
 */
export function mergeFinalRanking(
  tableauResults: { fencer: Fencer; rank: number }[],
  overall: PoolRanking[]
): { teamId: string; rank: number }[] {
  const rows = [...tableauResults]
    .sort((a, b) => a.rank - b.rank)
    .map(r => ({
      teamId: r.fencer.id,
      rank: r.rank,
      excluded: r.fencer.status === FencerStatus.EXCLUDED,
    }));
  const placed = new Set(rows.map(r => r.teamId));
  let next = rows.reduce((max, r) => Math.max(max, r.rank), 0);
  for (const r of overall) {
    if (placed.has(r.fencer.id)) continue;
    placed.add(r.fencer.id);
    rows.push({
      teamId: r.fencer.id,
      rank: ++next,
      excluded: r.fencer.status === FencerStatus.EXCLUDED,
    });
  }
  const ordered = [...rows.filter(r => !r.excluded), ...rows.filter(r => r.excluded)];
  // Exclues déplacées : rangs renumérotés en conservant les ex æquo du tableau
  const result: { teamId: string; rank: number }[] = [];
  ordered.forEach((r, i) => {
    const prev = ordered[i - 1];
    const tied = !!prev && !r.excluded && !prev.excluded && prev.rank === r.rank;
    result.push({ teamId: r.teamId, rank: tied ? result[i - 1].rank : i + 1 });
  });
  return result;
}
