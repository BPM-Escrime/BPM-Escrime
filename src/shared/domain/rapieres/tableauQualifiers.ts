/**
 * BPM - Escrime - Tournoi des rapières : qualification pour le tableau (#1441)
 * Règles pures (#1979, docs/adr/0002) : lues par l'écran (src/features/rapieres) et le moteur.
 * Licensed under GPL-3.0
 */
import type { Pool, PoolRanking } from '../../types';
import { poolHeadsCut } from '../ranking/poolHeads';

/**
 * Mode de tableau (#1441) : toutes les équipes qualifiées en « normal » (sans petite finale),
 * « third » (petite finale), « all » (toutes les places tirées) ; « semis » : 4 équipes, 3e place tirée.
 */
export type RapieresTableauMode = 'normal' | 'third' | 'all' | 'semis';

/** Équipe retirée (abandon, forfait, exclusion) : règle commune aux tireurs */
import { isWithdrawn } from '../fencers/fencerStatus';
export { isWithdrawn };

/**
 * Qualifiés pour le tableau selon le mode choisi (#1441) : demi-finales → les 4 équipes
 * désignées ; tableau normal, avec 3e place ou toutes places tirées → toutes les équipes.
 * Équipes retirées exclues, rangs recalculés.
 */
export function rapieresTableauQualifiers(
  pools: Pool[],
  overall: PoolRanking[],
  mode: RapieresTableauMode | undefined
): PoolRanking[] {
  if (mode === 'semis') return rapieresSemifinalists(pools, overall) ?? [];
  return overall.filter(r => !isWithdrawn(r.fencer)).map((r, i) => ({ ...r, rank: i + 1 }));
}

/** Réglages du tableau pour un mode : match pour la 3e place, toutes les places tirées */
export function rapieresTableauSettings(mode: RapieresTableauMode): {
  thirdPlaceMatch: boolean;
  playAllPositions: boolean;
} {
  return {
    thirdPlaceMatch: mode !== 'normal',
    playAllPositions: mode === 'all',
  };
}

/** Nombre de demi-finalistes : 4 équipes, soit `pool_heads` 4 (docs/adr/0043, F4b) */
export const SEMIFINALISTS = 4;

/**
 * Demi-finales (#1441) : les 4 équipes selon le nombre de poules, dans l'ordre de tête de série
 * (1 contre 4, 2 contre 3). Logique de la qualification générique « têtes de poule, puis
 * suivants » (`poolHeadsCut`, `pool_heads` 4, docs/adr/0043, F4b) : 2 poules : 1res contre 2es de
 * l'autre poule ; 3 poules : 1res + meilleure 2e ; 4 poules : 1res ; 1 poule : 4 premières.
 * Plus de 4 poules ou moins de 4 équipes retenues : pas de scénario (null). Mode hérité : les
 * ex aequo à la barre sont départagés dans l'ordre des poules, comme avant F4b.
 */
export function rapieresSemifinalists(pools: Pool[], overall: PoolRanking[]): PoolRanking[] | null {
  if (pools.length === 0 || pools.length > SEMIFINALISTS) return null;
  const poolOf = new Map<string, number>();
  pools.forEach((p, i) => p.fencers.forEach(f => poolOf.set(f.id, i)));
  const { ranking } = poolHeadsCut(pools, overall, SEMIFINALISTS, {
    ties: 'initial_ranking',
    entryRank: r => poolOf.get(r.fencer.id),
  });
  return ranking.length < SEMIFINALISTS ? null : ranking;
}
