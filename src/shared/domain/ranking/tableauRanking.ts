/**
 * BPM - Escrime - Classement effectif du tableau et progression des matchs
 * Règles pures (#1979, docs/adr/0002), lues par l'écran et le moteur (MCP, sport.ts).
 * Licensed under GPL-3.0
 */
import { MatchStatus } from '../../types';
import type { AdvancementRule, Pool, PoolRanking } from '../../types';
import { filterPoolWinners } from '../../utils/poolCalculations';
import { countTableauBouts } from '../../utils/tableauBouts';
import { applyTableauAdvancement, getTableauAdvancement } from '../../utils/customFormulaSettings';
import type { getActiveFormula } from '../../utils/customFormulaSettings';
import { rapieresTableauQualifiers, type RapieresTableauMode } from '../rapieres/tableauQualifiers';
import type { TableauMatch } from '../tableau/tableauTypes';
import { filterSplitGroup } from './splitGroups';

export interface MatchProgress {
  done: number;
  total: number;
  label: 'poules' | 'tableau';
}

/** Progression des matchs : poules si elles existent, sinon tableau, sinon null. */
export function computeMatchProgress(
  pools: Pool[],
  tableauMatches: TableauMatch[]
): MatchProgress | null {
  if (pools.length > 0) {
    const total = pools.reduce((s, p) => s + p.matches.length, 0);
    const done = pools.reduce(
      (s, p) => s + p.matches.filter(m => m.status === MatchStatus.FINISHED).length,
      0
    );
    return { done, total, label: 'poules' };
  }
  if (tableauMatches.length > 0) {
    // Exempts hors décompte ; tours suivants comptés même sans tireurs connus (#1817)
    const { done, total } = countTableauBouts(tableauMatches);
    return { done, total, label: 'tableau' };
  }
  return null;
}

export interface TableauRankingOptions {
  isRapieres: boolean;
  rapieresTableauMode: RapieresTableauMode | undefined;
  poolWinnersOnly: boolean;
  customFormula: ReturnType<typeof getActiveFormula>;
  /** Qualification du dernier tour vers le tableau, formule v2 (`tableauQualificationOf`) */
  tableauQualification?: AdvancementRule;
  postPoolSplitCriteria: string | undefined;
  activeSplitGroup: string | null;
  splitOffCompetitionIds: Partial<Record<string, string>> | undefined;
}

/** Classement effectif pour le tableau (filtré par vainqueurs de poule et/ou groupe actif). */
export function computeEffectiveTableauRanking(
  overallRanking: PoolRanking[],
  pools: Pool[],
  {
    isRapieres,
    rapieresTableauMode,
    poolWinnersOnly,
    customFormula,
    tableauQualification,
    postPoolSplitCriteria,
    activeSplitGroup,
    splitOffCompetitionIds,
  }: TableauRankingOptions
): PoolRanking[] {
  let ranking = overallRanking;
  if (isRapieres && pools.length > 0) {
    // Rapières : toutes les équipes, ou les 4 demi-finalistes (#1441)
    ranking = rapieresTableauQualifiers(pools, ranking, rapieresTableauMode);
  } else if (poolWinnersOnly && pools.length > 0) {
    ranking = filterPoolWinners(pools, ranking);
  } else if (customFormula || tableauQualification) {
    // Qualifiés pour le tableau selon la formule (pourcentage, nombre, taille de tableau) :
    // arme « Autre » (v1), sinon formule v2 pour toutes les armes (#2013 R1)
    ranking = applyTableauAdvancement(
      ranking,
      customFormula ? getTableauAdvancement(customFormula) : tableauQualification
    );
  }
  // Tableaux séparés : groupe affiché, ou groupes extraits écartés (docs/adr/0024)
  return filterSplitGroup(ranking, postPoolSplitCriteria, activeSplitGroup, splitOffCompetitionIds);
}
