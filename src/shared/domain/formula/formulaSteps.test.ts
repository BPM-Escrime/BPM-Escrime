import { describe, expect, it } from 'vitest';
import { Category, CompetitionSettings, Weapon } from '../../types';
import { buildDefaultCompetitionSettings } from '../../utils/defaultCompetitionSettings';
import { formulaOf } from './formulaV2';
import { applyOperationsV2 } from './formulaV2Operations';
import { formulaSteps, startsWithTableau } from './formulaSteps';

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
