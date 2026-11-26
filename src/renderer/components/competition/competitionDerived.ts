/**
 * BPM - Escrime - Valeurs dérivées de la vue compétition (extrait de CompetitionView, #1599)
 * Les règles de classement sont dans src/shared/domain/ranking/tableauRanking.ts (#1979).
 * Licensed under GPL-3.0
 */
import type { Pool } from '../../../shared/types';
import { getPoolWinnerIds } from '../../../shared/utils/poolCalculations';
import {
  pendingSplitOf,
  stayingBranches,
  type FormulaV2,
} from '../../../shared/domain/formula/formulaV2';

type TranslateFn = (key: string, params?: { [key: string]: string | number }) => string;

/**
 * Action « tableau » de la barre du haut sur l'étape Classement (#2008).
 * null : tour intermédiaire, pas d'élimination directe, tour passé consulté
 * ou séparation par genre (boutons par groupe restés sous le classement).
 */
export function rankingTableauNavAction(params: {
  t: TranslateFn;
  hasDirectElimination: boolean;
  hasNextRound: boolean;
  viewingPastRound: boolean;
  splitByGender: boolean;
  frozen: boolean;
  poolWinnersOnly: boolean;
  pools: Pool[];
  onGoToTableau: () => void;
}): { label: string; action: () => void } | null {
  const { t, pools } = params;
  if (
    !params.hasDirectElimination ||
    params.hasNextRound ||
    params.viewingPastRound ||
    params.splitByGender
  ) {
    return null;
  }
  const label = params.frozen
    ? t('poolRanking.see_tableau')
    : params.poolWinnersOnly
      ? t('poolRanking.go_tableau_winners', {
          n: pools.length > 0 ? getPoolWinnerIds(pools).size : '?',
        })
      : t('poolRanking.go_tableau');
  return { label, action: params.onGoToTableau };
}

/**
 * Action « suite » sous le classement des poules : tour suivant, ou lancement de la scission
 * (docs/adr/0039). Scission en attente : phase qui la précède close (dernier tour de poules),
 * branches pas encore parties (`splitHistory` vide). Compétition couplée (branches toutes
 * restées, E3) : rien à lancer, tableaux séparés (ADR-0024). Une branche reste en tableau
 * séparé, l'autre part : la scission d'abord, puis le tableau.
 */
export function rankingNextRoundAction(params: {
  t: TranslateFn;
  formula: FormulaV2 | undefined;
  splitDone: boolean;
  isLastPoolRound: boolean;
  hasPools: boolean;
  canAdvanceFromPools: boolean;
  currentPoolRound: number;
  hasDirectElimination: boolean;
  onNextRound: () => void;
  onLaunchSplit: () => void;
}): { label: string; onClick: () => void; testId?: string } | undefined {
  const { t } = params;
  if (!params.isLastPoolRound && params.hasPools && params.canAdvanceFromPools) {
    return {
      label: t('pools.next_round_n', { n: params.currentPoolRound + 1 }),
      onClick: params.onNextRound,
    };
  }
  const pendingSplit =
    params.formula && !params.splitDone ? pendingSplitOf(params.formula) : undefined;
  if (!pendingSplit || !params.isLastPoolRound) return undefined;
  const splitKeepsTableau = stayingBranches(pendingSplit).length > 0;
  if (params.hasDirectElimination && !splitKeepsTableau) return undefined;
  return { label: t('splitLaunch.action'), onClick: params.onLaunchSplit, testId: 'split-launch' };
}
