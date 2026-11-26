import { describe, expect, it } from 'vitest';
import {
  Category,
  Gender,
  Weapon,
  type CompetitionSettings,
  type Pool,
} from '../../../shared/types';
import { buildDefaultCompetitionSettings } from '../../../shared/utils/defaultCompetitionSettings';
import { formulaOf, type FormulaV2 } from '../../../shared/domain/formula/formulaV2';
import {
  applyOperationsV2,
  branchPhases,
} from '../../../shared/domain/formula/formulaV2Operations';
import { rankingNextRoundAction, rankingTableauNavAction } from './competitionDerived';

describe('rankingTableauNavAction (#2008)', () => {
  const t = (key: string) => key;
  const base = {
    t,
    hasDirectElimination: true,
    hasNextRound: false,
    viewingPastRound: false,
    splitByGender: false,
    frozen: false,
    poolWinnersOnly: false,
    pools: [] as Pool[],
    onGoToTableau: () => {},
  };

  it('libellé « Voir le tableau » quand le classement est figé', () => {
    expect(rankingTableauNavAction({ ...base, frozen: true })?.label).toBe(
      'poolRanking.see_tableau'
    );
  });

  it('libellé « Passer au tableau » sinon', () => {
    expect(rankingTableauNavAction(base)?.label).toBe('poolRanking.go_tableau');
  });

  it('déclenche le passage au tableau', () => {
    let called = false;
    rankingTableauNavAction({ ...base, onGoToTableau: () => (called = true) })?.action();
    expect(called).toBe(true);
  });

  it.each([
    ['sans élimination directe', { hasDirectElimination: false }],
    ['tour suivant à lancer', { hasNextRound: true }],
    ['tour passé consulté', { viewingPastRound: true }],
    ['séparation par genre', { splitByGender: true }],
  ])('aucun bouton : %s', (_label, over) => {
    expect(rankingTableauNavAction({ ...base, ...over })).toBeNull();
  });
});

describe('rankingNextRoundAction (docs/adr/0039)', () => {
  const t = (key: string) => key;
  const weapon = Weapon.EPEE;
  const settings = buildDefaultCompetitionSettings({
    weapon,
    category: Category.SENIOR,
  }) as CompetitionSettings;
  const fctx = { weapon, category: Category.SENIOR, settings };
  let n = 0;
  const newId = () => `ph-${++n}`;
  /** Poules, puis scission par sexe : Hommes (restés ou non), Dames en fille */
  const genderSplit = (menStay: boolean, womenStay: boolean): FormulaV2 => {
    const f = applyOperationsV2(
      fctx,
      [
        { op: 'removePhase', phase: 'tableau' },
        { op: 'insertPhase', brick: 'split', at: 1 },
      ],
      newId
    );
    return {
      ...f,
      phases: f.phases.map(p =>
        p.kind === 'split'
          ? {
              ...p,
              criterion: 'gender' as const,
              branches: [
                {
                  label: 'Hommes',
                  gender: Gender.MALE,
                  phases: branchPhases('tableau', fctx, newId),
                  stayInCompetition: menStay,
                },
                {
                  label: 'Dames',
                  gender: Gender.FEMALE,
                  phases: branchPhases('tableau', fctx, newId),
                  stayInCompetition: womenStay,
                },
              ],
            }
          : p
      ),
    };
  };
  const coupled = formulaOf({
    ...fctx,
    settings: { ...settings, postPoolSplitCriteria: 'gender' },
  });
  const base = {
    t,
    formula: genderSplit(false, false) as FormulaV2 | undefined,
    splitDone: false,
    isLastPoolRound: true,
    hasPools: true,
    canAdvanceFromPools: true,
    currentPoolRound: 1,
    hasDirectElimination: false,
    onNextRound: () => {},
    onLaunchSplit: () => {},
  };

  it('compétition couplée (les deux branches restent) : pas de scission proposée', () => {
    expect(coupled.phases.some(p => p.kind === 'split')).toBe(true);
    expect(
      rankingNextRoundAction({ ...base, formula: coupled, hasDirectElimination: true })
    ).toBeUndefined();
    expect(
      rankingNextRoundAction({
        ...base,
        formula: genderSplit(true, true),
        hasDirectElimination: true,
      })
    ).toBeUndefined();
  });

  it('scission vers des filles en attente : action « split-launch »', () => {
    let launched = false;
    const action = rankingNextRoundAction({ ...base, onLaunchSplit: () => (launched = true) });
    expect(action).toMatchObject({ label: 'splitLaunch.action', testId: 'split-launch' });
    action!.onClick();
    expect(launched).toBe(true);
  });

  it('mélange (une branche reste en tableau séparé) : la scission d’abord', () => {
    expect(
      rankingNextRoundAction({
        ...base,
        formula: genderSplit(true, false),
        hasDirectElimination: true,
      })?.testId
    ).toBe('split-launch');
  });

  it('déjà scindée (splitHistory non vide) : pas d’action', () => {
    expect(rankingNextRoundAction({ ...base, splitDone: true })).toBeUndefined();
    expect(
      rankingNextRoundAction({
        ...base,
        formula: genderSplit(true, false),
        hasDirectElimination: true,
        splitDone: true,
      })
    ).toBeUndefined();
  });

  it('poules non finies / pas le dernier tour : tour suivant, sinon rien', () => {
    expect(rankingNextRoundAction({ ...base, isLastPoolRound: false })).toMatchObject({
      label: 'pools.next_round_n',
    });
    expect(rankingNextRoundAction({ ...base, isLastPoolRound: false })?.testId).toBeUndefined();
    expect(
      rankingNextRoundAction({ ...base, isLastPoolRound: false, canAdvanceFromPools: false })
    ).toBeUndefined();
    expect(
      rankingNextRoundAction({ ...base, isLastPoolRound: false, hasPools: false })
    ).toBeUndefined();
  });

  it('sans formule, ou scission sans branche restée et tableau de la formule : pas d’action', () => {
    expect(rankingNextRoundAction({ ...base, formula: undefined })).toBeUndefined();
    expect(rankingNextRoundAction({ ...base, hasDirectElimination: true })).toBeUndefined();
  });
});
