// @vitest-environment jsdom
/**
 * Barre de navigation dérivée de la formule (docs/adr/0037) : les onglets suivent le déroulé
 * `formulaSteps`, par les fonctions de formulaSteps.ts (startsWithTableau, formulaSegment),
 * avant et après la clôture d'un tableau arrêté.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { Category, CompetitionSettings, Weapon } from '../../shared/types';
import { buildDefaultCompetitionSettings } from '../../shared/utils/defaultCompetitionSettings';
import {
  coupledFormula,
  formulaOf,
  playedTableauOf,
  type FormulaV2,
} from '../../shared/domain/formula/formulaV2';
import { applyOperationsV2 } from '../../shared/domain/formula/formulaV2Operations';
import {
  formulaSegment,
  formulaSteps,
  startsWithTableau,
} from '../../shared/domain/formula/formulaSteps';

vi.mock('./useTranslation', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import { useCompetitionPhases } from './useCompetitionPhases';

const settings = buildDefaultCompetitionSettings({
  weapon: Weapon.EPEE,
  category: Category.SENIOR,
}) as CompetitionSettings;
const ctx = { weapon: Weapon.EPEE, category: Category.SENIOR, settings };

/**
 * Onglets attendus du déroulé : une étape « poules » = préparation, poules, classement ; la
 * scission (ADR-0039) n'ajoute pas d'onglet (ses branches sont des compétitions filles)
 */
const expectedTabs = (f: FormulaV2): string[] => {
  const ids = formulaSteps(f).flatMap(s =>
    s.kind === 'split'
      ? []
      : s.kind === 'pools'
        ? ['poolprep', 'pools', 'ranking']
        : s.kind === 'tableau'
          ? startsWithTableau(f)
            ? ['ranking', 'tableau']
            : ['tableau']
          : [s.kind]
  );
  return [...new Set(ids)];
};

/** Onglets de l'écran, réglés comme CompetitionView le fait depuis la formule */
const screenTabs = (f: FormulaV2, closedStages: number): string[] => {
  const segment = formulaSegment(f, closedStages);
  const { result } = renderHook(() =>
    useCompetitionPhases({
      isTeamEvent: false,
      currentPhase: 'checkin',
      setCurrentPhase: () => undefined,
      setRankingValidated: () => undefined,
      rankingValidated: false,
      skipPoolPhase: false,
      poolsLaunched: false,
      pools: [],
      poolHistory: [],
      areAllPoolsComplete: () => false,
      isRapieres: false,
      rapieresWavesEnded: false,
      currentPoolRound: 1,
      poolRounds: segment?.poolRounds ?? f.phases.filter(p => p.kind === 'pool').length,
      // Comme l'écran (réglages plats) : tableau de la formule, ou des branches restées
      hasDirectElimination: segment?.hasDirectElimination ?? !!playedTableauOf(f),
      finalResults: [],
      tableauMatches: [],
      questEnabled: false,
      questNoPool: false,
      questConfig: undefined,
      auditLogEnabled: false,
      refereeFeatureEnabled: false,
      tableauFirst: startsWithTableau(f),
      closedTableau: !!segment && !segment.hasDirectElimination,
    })
  );
  return result.current.phases.map(p => p.id);
};

describe('navigation dérivée de formulaSteps (ADR-0037)', () => {
  it('formule standard', () => {
    const f = formulaOf(ctx);
    expect(screenTabs(f, 0)).toEqual(expectedTabs(f));
  });

  it('0 tour de poules : appel, classement d’entrée, tableau', () => {
    const f = applyOperationsV2(ctx, [{ op: 'removePhase', phase: 'pool-0' }], () => 'x');
    expect(screenTabs(f, 0)).toEqual(expectedTabs(f));
  });

  it('tableau arrêté : mêmes onglets avant et après la clôture (étape close consultable)', () => {
    const f = applyOperationsV2(
      ctx,
      [
        { op: 'setPhase', phase: 'tableau', settings: { stopAt: 4 } },
        { op: 'insertPhase', brick: 'pool', at: 2 },
      ],
      () => 'x'
    );
    expect(screenTabs(f, 0)).toEqual(expectedTabs(f));
    expect(screenTabs(f, 1)).toEqual(expectedTabs(f));
  });

  it('scission après les poules : pas d’onglet de plus (ADR-0039)', () => {
    const f = applyOperationsV2(
      ctx,
      [
        { op: 'removePhase', phase: 'tableau' },
        { op: 'insertPhase', brick: 'split', at: 1 },
      ],
      () => 'x'
    );
    expect(screenTabs(f, 0)).toEqual(expectedTabs(f));
    expect(expectedTabs(f)).not.toContain('split');
  });

  it('tableau arrêté suivi d’une scission : mêmes onglets avant et après la clôture', () => {
    const f = applyOperationsV2(
      ctx,
      [
        { op: 'setPhase', phase: 'tableau', settings: { stopAt: 8 } },
        { op: 'insertPhase', brick: 'split', at: 2 },
      ],
      () => 'x'
    );
    expect(screenTabs(f, 0)).toEqual(expectedTabs(f));
    expect(screenTabs(f, 1)).toEqual(expectedTabs(f));
  });

  it('compétition couplée (branches restées) : onglet Tableau, comme les tableaux séparés', () => {
    const f = coupledFormula(
      formulaOf({ ...ctx, settings: { ...settings, postPoolSplitCriteria: 'gender' } })
    );
    expect(expectedTabs(f)).toContain('tableau');
    expect(screenTabs(f, 0)).toEqual(expectedTabs(f));
  });
});
