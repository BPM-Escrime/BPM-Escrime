/**
 * Phases commencées vues par l'écran (S6, docs/adr/0041) : tirage non lancé pas commencé,
 * tour joué, tableau tiré.
 */
import { describe, expect, it } from 'vitest';
import type { Pool } from '../../../shared/types';
import type { FormulaV2 } from '../../../shared/domain/formula/formulaV2';
import type { TableauMatch } from '../../../shared/domain/tableau/tableauTypes';
import { screenFormulaProgress } from './screenFormulaProgress';

const formula = {
  version: 2,
  general: {},
  phases: [
    { kind: 'pool', id: 'p1' },
    { kind: 'pool', id: 'p2' },
    { kind: 'tableau', id: 't' },
  ],
} as unknown as FormulaV2;
const pool = {} as Pool;
const base = {
  formula,
  poolsLaunched: false,
  pools: [] as Pool[],
  poolHistory: [] as Pool[][],
  tableauMatches: [] as TableauMatch[],
  stageHistory: [],
  splitHistory: [],
  currentPhase: 'poolprep',
};

describe('screenFormulaProgress (S6, ADR-0041)', () => {
  it('poules tirées mais non lancées : rien de commencé', () => {
    expect(screenFormulaProgress({ ...base, pools: [pool] })).toEqual([]);
  });

  it('tour 1 lancé, puis tour 1 joué et tour 2 lancé', () => {
    expect(screenFormulaProgress({ ...base, poolsLaunched: true, pools: [pool] })).toEqual([
      'pool',
    ]);
    expect(
      screenFormulaProgress({ ...base, poolsLaunched: true, pools: [pool], poolHistory: [[pool]] })
    ).toEqual(['pool', 'pool']);
  });

  it('tableau tiré après deux tours', () => {
    expect(
      screenFormulaProgress({
        ...base,
        poolHistory: [[pool], [pool]],
        tableauMatches: [{ id: '8-0' } as TableauMatch],
        currentPhase: 'tableau',
      })
    ).toEqual(['pool', 'pool', 'tableau']);
  });
});
