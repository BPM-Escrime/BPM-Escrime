/**
 * BPM - Escrime - Passage au tour de poules suivant (#2013 étape C, ADR-0034, Q4)
 * Classement qui qualifie et répartit le tour suivant : celui du tour terminé (défaut,
 * comportement historique) ou le cumul de tous les tours joués. Nombre de qualifiés : règle de
 * qualification du tour dans la formule v2, sinon réglages historiques. Domaine pur.
 * Licensed under GPL-3.0
 */

import type { CompetitionSettings, Pool, PoolRanking, Weapon } from '../../types';
import {
  getActiveFormula,
  getAdvancementCount,
  getPoolRoundAdvancement,
} from '../../utils/customFormulaSettings';
import { computeOverallRankingFor } from '../../utils/poolOrchestration';
import { getRoundQualifierCount } from '../../utils/poolRounds';
import { phaseSettings } from '../formula/formulaV2';

/**
 * Cumul des tours : victoires, matchs et touches additionnés sur tous les tours joués, pour les
 * tireurs du tour terminé. Rang : ratio V/M, puis indice, puis touches données (Sabre Laser :
 * points Quest d'abord). Égalité parfaite : même rang.
 */
export function cumulativeRanking(
  history: Pool[][],
  current: Pool[],
  isLaserSabre: boolean
): PoolRanking[] {
  const last = computeOverallRankingFor(current, isLaserSabre);
  const totals = new Map(
    last.map(r => [
      r.fencer.id,
      {
        ...r,
        victories: 0,
        defeats: 0,
        matchesPlayed: 0,
        touchesScored: 0,
        touchesReceived: 0,
        questPoints: 0,
      },
    ])
  );
  for (const round of [...history, current]) {
    for (const r of computeOverallRankingFor(round, isLaserSabre)) {
      const t = totals.get(r.fencer.id);
      if (!t) continue;
      t.victories += r.victories;
      t.defeats += r.defeats;
      t.matchesPlayed += r.matchesPlayed;
      t.touchesScored += r.touchesScored;
      t.touchesReceived += r.touchesReceived;
      t.questPoints = (t.questPoints ?? 0) + (r.questPoints ?? 0);
    }
  }
  const rows = [...totals.values()].map(t => ({
    ...t,
    index: t.touchesScored - t.touchesReceived,
    ratio: t.matchesPlayed > 0 ? t.victories / t.matchesPlayed : 0,
  }));
  const key = (r: PoolRanking) =>
    isLaserSabre
      ? [r.questPoints ?? 0, r.index, r.touchesScored]
      : [r.ratio, r.index, r.touchesScored];
  rows.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (kb[i] !== ka[i]) return kb[i] - ka[i];
    return 0;
  });
  let rank = 0;
  return rows.map((r, i) => {
    const prev = rows[i - 1];
    if (!prev || key(prev).some((v, j) => v !== key(r)[j])) rank = i + 1;
    return { ...r, rank };
  });
}

export interface NextRoundPlan {
  /** Classement qui qualifie et répartit le tour suivant */
  ranking: PoolRanking[];
  /** Nombre de qualifiés (undefined : tous) */
  qualifierCount: number | undefined;
  seeding: 'previous_round' | 'cumulative';
}

/** Classement et qualifiés à la clôture du tour `round` (1 = 1er) — moteur et écran */
export function nextRoundPlan(input: {
  weapon: Weapon;
  settings?: Partial<CompetitionSettings>;
  round: number;
  pools: Pool[];
  history: Pool[][];
  isLaserSabre: boolean;
}): NextRoundPlan {
  const formula = input.settings?.formula;
  const phase = formula?.phases.some(p => p.kind === 'pool')
    ? phaseSettings(formula, { kind: 'pool', round: input.round - 1 })
    : undefined;
  // Répartition : réglage du tour **suivant** (comment il est réparti) ; qualifiés : tour terminé
  const next = formula?.phases.some(p => p.kind === 'pool')
    ? phaseSettings(formula, { kind: 'pool', round: input.round })
    : undefined;
  const seeding = next?.seeding ?? 'previous_round';
  const ranking =
    seeding === 'cumulative'
      ? cumulativeRanking(input.history, input.pools, input.isLaserSabre)
      : computeOverallRankingFor(input.pools, input.isLaserSabre);
  if (phase) {
    return {
      ranking,
      qualifierCount: getAdvancementCount(ranking.length, phase.qualification),
      seeding,
    };
  }
  const custom = getActiveFormula(input.weapon, input.settings);
  return {
    ranking,
    qualifierCount: custom
      ? getAdvancementCount(ranking.length, getPoolRoundAdvancement(custom, input.round - 1))
      : getRoundQualifierCount(input.settings?.poolRoundQualifiers, input.round + 1),
    seeding,
  };
}
