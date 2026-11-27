/**
 * BPM - Escrime - Classement des poules qui alimente le classement final de l'écran
 * Le classement complet des poules (comme le moteur, `resultsData`), pas la seule coupe du
 * tableau : les non-qualifiés suivent le tableau (docs/adr/0043 amendée, F4d). Tableaux séparés :
 * le groupe affiché (docs/adr/0024) ; épreuve scindée : sans les tireurs partis (ADR-0039) ;
 * tableau arrêté : restants, éliminés du tableau, autres (ADR-0037). Domaine pur.
 * Licensed under GPL-3.0
 */
import type { PoolRanking } from '../../types';
import { originFinalRanking, type SplitHistoryEntry } from '../formula/splitPlan';
import type { TableauStageRecord } from '../tableau/tableauStage';
import { filterSplitGroup } from './splitGroups';

export interface ResultsRankingInput {
  /** Classement général des poules, complet */
  overallRanking: PoolRanking[];
  postPoolSplitCriteria?: string;
  /** Groupe affiché (tableaux séparés) */
  activeSplitGroup: string | null;
  splitOffCompetitionIds?: Partial<Record<string, string>>;
  stageHistory: TableauStageRecord[];
  splitHistory: readonly SplitHistoryEntry[];
}

/** Classement des poules du classement final et libellés « Tableau de N » des éliminés d'un tableau arrêté */
export function resultsRanking(input: ResultsRankingInput): {
  ranking: PoolRanking[];
  eliminatedAt: Map<string, string>;
} {
  return originFinalRanking(
    filterSplitGroup(
      input.overallRanking,
      input.postPoolSplitCriteria,
      input.activeSplitGroup,
      input.splitOffCompetitionIds
    ),
    input.stageHistory,
    input.splitHistory
  );
}
