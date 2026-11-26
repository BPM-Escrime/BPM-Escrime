/**
 * BPM - Escrime - Phases commencées vues par l'écran (S6, docs/adr/0041) : faits lus dans
 * l'état de l'épreuve, passés à formulaProgress (domaine). Un tirage de poules non lancé n'est
 * pas encore commencé.
 * Licensed under GPL-3.0
 */
import type { Pool } from '../../../shared/types';
import type { FormulaV2 } from '../../../shared/domain/formula/formulaV2';
import type { TableauMatch } from '../../../shared/domain/tableau/tableauTypes';
import {
  formulaProgress,
  type FormulaProgress,
} from '../../../shared/domain/formula/formulaRemarks';

export function screenFormulaProgress(input: {
  formula: FormulaV2;
  poolsLaunched: boolean;
  pools: Pool[];
  poolHistory: Pool[][];
  tableauMatches: TableauMatch[];
  stageHistory: unknown[];
  splitHistory: unknown[];
  currentPhase: string;
}): FormulaProgress {
  return formulaProgress(input.formula, {
    pools: input.poolsLaunched ? input.pools : [],
    poolHistory: input.poolHistory,
    tableauMatches: input.tableauMatches,
    stageHistory: input.stageHistory,
    splitHistory: input.splitHistory,
    questStarted: input.currentPhase === 'quest',
  });
}
