/**
 * Avancement d'une épreuve par équipes pour le verrou S6 (docs/adr/0041, ADR-0044) : faits lus
 * dans les rencontres d'équipe.
 */
import { describe, it, expect } from 'vitest';
import type { FormulaV2 } from '../formula/formulaV2';
import { teamFormulaProgress, teamProgressFacts } from './teamFormulaProgress';

const pool = { kind: 'pool', id: 'pool-1', qualification: { mode: 'all' } };
const tableau = { kind: 'tableau', id: 'tableau', thirdPlace: false, allPlaces: false };
const formula = (...phases: unknown[]) =>
  ({ version: 2, phases, general: {} }) as unknown as FormulaV2;
const finished = { status: 'finished' };
const playing = { status: 'in_progress' };

describe('teamFormulaProgress (S6, ADR-0041, ADR-0044)', () => {
  it('rien de tiré : rien de commencé', () => {
    expect(
      teamFormulaProgress(formula(pool, tableau), { poolMatches: [], tableauMatches: [] })
    ).toEqual({ phases: [], closedRounds: 0 });
  });

  it('poules d’équipes tirées : tour de poules commencé, non clos', () => {
    const facts = { poolMatches: [playing], tableauMatches: [] };
    expect(teamFormulaProgress(formula(pool, tableau), facts)).toEqual({
      phases: ['pool'],
      closedRounds: 0,
    });
    // Toutes jouées, tableau pas tiré : tour pas encore clos
    expect(
      teamFormulaProgress(formula(pool, tableau), { poolMatches: [finished], tableauMatches: [] })
    ).toEqual({ phases: ['pool'], closedRounds: 0 });
  });

  it('rencontres de poule finies et tableau tiré : tour clos, tableau commencé', () => {
    const facts = { poolMatches: [finished, finished], tableauMatches: [{}] };
    expect(teamProgressFacts(facts)).toMatchObject({ poolsLaunched: false });
    expect(teamFormulaProgress(formula(pool, tableau), facts)).toEqual({
      phases: ['pool', 'tableau'],
      closedRounds: 1,
    });
  });

  it('tableau seul tiré : tableau commencé', () => {
    expect(
      teamFormulaProgress(formula(tableau), { poolMatches: [], tableauMatches: [{}] })
    ).toEqual({ phases: ['tableau'], closedRounds: 0 });
  });
});
