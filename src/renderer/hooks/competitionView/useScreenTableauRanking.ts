/**
 * BPM - Escrime - Classement du tableau de l'écran (#2013 étape F1, docs/adr/0040) :
 * classement, PDF et résultats. Avant le tirage : choix des ex aequo fait au passage au
 * tableau (tableauTiesChoice), sinon la formule ; tableau tiré : coupe figée par le tableau.
 * Licensed under GPL-3.0
 */
import { useMemo } from 'react';
import type { Pool, PoolRanking } from '../../../shared/types';
import type { TableauMatch } from '../../../shared/domain/tableau/tableauTypes';
import {
  tableauRankingOfScreen,
  type TableauRankingOptions,
} from '../../../shared/domain/ranking/tableauRanking';
import { useTableauTies } from '../tableauTiesChoice';

export function useScreenTableauRanking({
  competitionId,
  overallRanking,
  pools,
  tableauMatches,
  options,
}: {
  competitionId: string;
  overallRanking: PoolRanking[];
  pools: Pool[];
  tableauMatches: TableauMatch[];
  options: Omit<TableauRankingOptions, 'ties'>;
}): PoolRanking[] {
  const ties = useTableauTies(competitionId);
  const {
    isRapieres,
    rapieresTableauMode,
    poolWinnersOnly,
    customFormula,
    tableauQualification,
    postPoolSplitCriteria,
    activeSplitGroup,
    splitOffCompetitionIds,
  } = options;
  return useMemo(
    () =>
      tableauRankingOfScreen(
        overallRanking,
        pools,
        {
          isRapieres,
          rapieresTableauMode,
          poolWinnersOnly,
          customFormula,
          tableauQualification,
          ties,
          postPoolSplitCriteria,
          activeSplitGroup,
          splitOffCompetitionIds,
        },
        tableauMatches
      ),
    [
      overallRanking,
      pools,
      tableauMatches,
      ties,
      isRapieres,
      rapieresTableauMode,
      poolWinnersOnly,
      customFormula,
      tableauQualification,
      postPoolSplitCriteria,
      activeSplitGroup,
      splitOffCompetitionIds,
    ]
  );
}
