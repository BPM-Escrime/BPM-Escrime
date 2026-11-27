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
import { replayDraws, useTableauTies } from '../tableauTiesChoice';

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
  options: Omit<TableauRankingOptions, 'ties' | 'random'>;
}): PoolRanking[] {
  const choice = useTableauTies(competitionId);
  const {
    legacyRapieres,
    poolWinnersOnly,
    customFormula,
    tableauQualification,
    postPoolSplitCriteria,
    activeSplitGroup,
    splitOffCompetitionIds,
  } = options;
  // Épreuve enregistrée en mode spécial : mode de tableau hérité (docs/adr/0043, F4e)
  const isLegacy = !!legacyRapieres;
  const legacyMode = legacyRapieres?.mode;
  return useMemo(
    () =>
      tableauRankingOfScreen(
        overallRanking,
        pools,
        {
          legacyRapieres: isLegacy ? { mode: legacyMode } : undefined,
          poolWinnersOnly,
          customFormula,
          tableauQualification,
          ties: choice?.ties,
          // Tirage au sort : même hasard rejoué à chaque calcul (tableau stable)
          random: choice?.draws ? replayDraws(choice.draws) : undefined,
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
      choice,
      isLegacy,
      legacyMode,
      poolWinnersOnly,
      customFormula,
      tableauQualification,
      postPoolSplitCriteria,
      activeSplitGroup,
      splitOffCompetitionIds,
    ]
  );
}
