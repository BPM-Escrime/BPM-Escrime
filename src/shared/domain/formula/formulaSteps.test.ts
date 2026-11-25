import { describe, expect, it } from 'vitest';
import { Category, CompetitionSettings, Weapon } from '../../types';
import { buildDefaultCompetitionSettings } from '../../utils/defaultCompetitionSettings';
import { formulaOf } from './formulaV2';
import { applyOperationsV2 } from './formulaV2Operations';
import { formulaSegment, formulaSteps, startsWithTableau, stoppedTableauOf } from './formulaSteps';

const settings = buildDefaultCompetitionSettings({
  weapon: Weapon.EPEE,
  category: Category.SENIOR,
}) as CompetitionSettings;
const ctx = { weapon: Weapon.EPEE, category: Category.SENIOR, settings };

describe('déroulé dérivé de la formule (ADR-0037)', () => {
  it('standard : appel, poules, tableau, résultats', () => {
    expect(formulaSteps(formulaOf(ctx))).toEqual([
      { kind: 'checkin' },
      { kind: 'pools', rounds: 1 },
      { kind: 'tableau' },
      { kind: 'results' },
    ]);
    expect(startsWithTableau(formulaOf(ctx))).toBe(false);
  });

  it('tours consécutifs regroupés ; 5 tours', () => {
    const f = applyOperationsV2(
      ctx,
      [1, 2, 3, 4].map(at => ({ op: 'insertPhase' as const, brick: 'pool' as const, at })),
      () => 'x'
    );
    expect(formulaSteps(f)[1]).toEqual({ kind: 'pools', rounds: 5 });
  });

  it('0 tour de poules : le tableau suit l’appel', () => {
    const f = applyOperationsV2(ctx, [{ op: 'removePhase', phase: 'pool-0' }], () => 'x');
    expect(formulaSteps(f).map(s => s.kind)).toEqual(['checkin', 'tableau', 'results']);
    expect(startsWithTableau(f)).toBe(true);
  });
});

describe('tableau arrêté à N, tours après le tableau (ADR-0037, D2)', () => {
  const stopped = applyOperationsV2(
    ctx,
    [
      { op: 'setPhase', phase: 'tableau', settings: { stopAt: 8 } },
      { op: 'insertPhase', brick: 'pool', at: 2 },
    ],
    () => 'x'
  );

  it('déroulé : poules, tableau arrêté, poules des restants', () => {
    expect(formulaSteps(stopped)).toEqual([
      { kind: 'checkin' },
      { kind: 'pools', rounds: 1 },
      { kind: 'tableau', stopAt: 8 },
      { kind: 'pools', rounds: 1 },
      { kind: 'results' },
    ]);
    expect(stoppedTableauOf(stopped)?.stopAt).toBe(8);
  });

  it('partie en cours : avant la clôture, tours d’avant et tableau ; après, plus de tableau', () => {
    expect(formulaSegment(stopped, 0)).toEqual({
      poolRounds: 1,
      hasDirectElimination: true,
      stopAt: 8,
    });
    expect(formulaSegment(stopped, 1)).toEqual({ poolRounds: 2, hasDirectElimination: false });
    expect(formulaSegment(formulaOf(ctx), 0)).toBeNull();
  });
});
