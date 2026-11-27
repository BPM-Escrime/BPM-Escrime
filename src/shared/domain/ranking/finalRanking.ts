/**
 * BPM - Escrime - Classement final de l'épreuve (écran des résultats, CSV, PDF)
 * Résultats du tableau, puis éliminés des poules dans l'ordre du classement des poules ; sans
 * tableau, le classement des poules. Un exclu (carton noir compris, #1418) est au bas sans rang.
 * Règle unique de l'écran, des exports et du moteur (docs/adr/0043, F4d). Domaine pur.
 * Licensed under GPL-3.0
 */
import { FencerStatus } from '../../types';
import type { Fencer, PoolRanking } from '../../types';
import { poolEliminatedAt } from '../../utils/forfeit';
import { applyBlackCardRanking } from '../../utils/blackCardRanking';

export interface FinalRankingEntry {
  /**
   * Rang ; `null` à l'exécution pour un carton noir (classement perdu, #1418). Typé `number`
   * comme avant l'extraction : les exports et l'écran lisent `null` comme « - ».
   */
  rank: number;
  fencer: Fencer;
  /** « Finale », « Demi-finale », « Poules »… */
  eliminatedAt?: string;
}

export interface TableauResult {
  rank: number;
  fencer: Fencer;
  eliminatedAt?: string;
}

export interface FinalRankingInput {
  /** Résultats du tableau (vide : pas de tableau terminé) */
  finalResults: readonly TableauResult[];
  /** Classement des poules (ou du tableau arrêté, docs/adr/0037) */
  poolRanking: readonly PoolRanking[];
  /** Éliminés d'un tableau arrêté : « Tableau de N » au lieu de « Poules » (docs/adr/0037) */
  stageEliminatedAt?: ReadonlyMap<string, string>;
  /** Rafraîchit le tireur figé dans les résultats (statut courant), sans changer le classement */
  refresh?: (fencer: Fencer) => Fencer;
}

/** Classement final : tableau, puis éliminés des poules (carton noir appliqué) */
export function finalRanking({
  finalResults,
  poolRanking,
  stageEliminatedAt,
  refresh = f => f,
}: FinalRankingInput): FinalRankingEntry[] {
  const base: FinalRankingEntry[] = (() => {
    if (finalResults.length === 0) {
      return poolRanking.map((pr, idx) => {
        const fencer = refresh(pr.fencer);
        return {
          // Tableau arrêté : rangs du classement final, ex aequo compris (Q5, ADR-0037)
          rank: stageEliminatedAt?.size ? pr.rank : idx + 1,
          fencer,
          eliminatedAt: stageEliminatedAt?.get(fencer.id) ?? poolEliminatedAt(fencer),
        };
      });
    }
    const tableauIds = new Set(finalResults.map(r => r.fencer.id));
    const poolEliminated = poolRanking
      .filter(pr => !tableauIds.has(pr.fencer.id))
      .map((pr, idx) => {
        const fencer = refresh(pr.fencer);
        return {
          rank: finalResults.length + idx + 1,
          fencer,
          eliminatedAt: poolEliminatedAt(fencer),
        };
      });
    return [...finalResults.map(r => ({ ...r, fencer: refresh(r.fencer) })), ...poolEliminated];
  })();

  // Exclu (y compris après son entrée au tableau, carton noir compris) : inscrit au bas sans
  // classement (rang « - »), les autres sont renumérotés (FIE o.74, docs/adr/0043 amendée, F4d) ;
  // ex aequo départagés par le classement de composition du tableau (rang de poules)
  return applyBlackCardRanking(
    base,
    new Map(poolRanking.map(pr => [pr.fencer.id, pr.rank])),
    f => f.status === FencerStatus.EXCLUDED
  );
}
