/**
 * BPM - Escrime - Règles du match d'arène transmises à la tablette (#2214) : score limite
 * (aucun carton P à limite − 1 des deux côtés, t.124.3) et rangs du tableau en cours pour le
 * noir P à égalité (FFE, règlement de l'arbitrage 2026-2027, 4.3.2 : dès M15). Les règles sont
 * dans `shared/domain/match/matchEndValidation.ts` ; ce module ne fait que les nourrir.
 * Licensed under GPL-3.0
 */
import type { ArenaMatch, ArenaUpdate } from '../../shared/types/remote';
import { Weapon } from '../../shared/types';
import {
  passivityUsesTableauSeed,
  resolveScoreLimit,
} from '../../shared/domain/match/matchEndValidation';
import { tableauSeedRanks } from '../../shared/domain/tableau/tableauCalculations';
import type { SessionMatch } from './types';

/** État de session lu pour les règles du match */
export interface ArenaRulesContext {
  readonly sessionMatches: readonly SessionMatch[];
  readonly sessionWeapon: string | null;
  readonly sessionPoolMaxScore: number | null;
  readonly sessionTableMaxScore: number | null;
  readonly sessionCategory: string | null;
}

/** Rangs du tirage du tableau du match (même `tableId`), ou null s'ils sont inconnus */
function passivityRanks(
  ctx: ArenaRulesContext,
  match: ArenaMatch,
  session: SessionMatch | undefined
): { A: number | null; B: number | null } | null {
  const tableId = session?.tableId;
  const sameTable = ctx.sessionMatches.filter(
    m => m.isTableau && !m.poolId && (tableId === undefined || m.tableId === tableId)
  );
  const seeds = tableauSeedRanks(
    sameTable.map(m => ({
      fencerA: m.fencerA ?? null,
      fencerB: m.fencerB ?? null,
      seedA: m.seedA ?? null,
      seedB: m.seedB ?? null,
    }))
  );
  if (!seeds) return null;
  const A = seeds.get(match.fencerA?.id) ?? null;
  const B = seeds.get(match.fencerB?.id) ?? null;
  return A === null && B === null ? null : { A, B };
}

/** Champs de règles d'un `ArenaUpdate` pour le match en cours (absents sans match) */
export function arenaMatchRules(
  ctx: ArenaRulesContext,
  match: ArenaMatch | null | undefined
): Pick<ArenaUpdate, 'scoreLimit' | 'passivityRanks'> {
  if (!match) return {};
  const session = ctx.sessionMatches.find(m => m.id === match.id);
  // Même lecture que `getScoreLimit` (arenaOps.ts)
  const isTableau = !!(match.isTableau || session?.isTableau);
  const limit = resolveScoreLimit({
    isLaser: ctx.sessionWeapon === Weapon.LASER,
    isTableau,
    poolMaxScore: ctx.sessionPoolMaxScore,
    tableMaxScore: ctx.sessionTableMaxScore,
    matchMaxScore: session?.maxScore,
  });
  const bySeed = passivityUsesTableauSeed({ isTableau, category: ctx.sessionCategory });
  return {
    // JSON : Infinity deviendrait null ; 0 = sans limite
    scoreLimit: Number.isFinite(limit) ? limit : 0,
    passivityRanks: bySeed ? passivityRanks(ctx, match, session) : null,
  };
}
