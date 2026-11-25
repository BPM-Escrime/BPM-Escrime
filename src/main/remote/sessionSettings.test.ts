/**
 * Tablettes et arène : chrono et score max du tour de poules en cours (docs/adr/0036).
 */
import { describe, expect, it } from 'vitest';
import { Category, Competition, CompetitionSettings, Gender, Weapon } from '../../shared/types';
import { buildDefaultCompetitionSettings } from '../../shared/utils/defaultCompetitionSettings';
import { applyOperationsV2 } from '../../shared/domain/formula/formulaV2Operations';
import { applyCompetitionSettings, type SessionSettingsContext } from './sessionSettings';

const base = buildDefaultCompetitionSettings({
  weapon: Weapon.EPEE,
  category: Category.SENIOR,
}) as CompetitionSettings;

const competition = (settings: Partial<CompetitionSettings>) =>
  ({
    id: 'c1',
    weapon: Weapon.EPEE,
    gender: Gender.MALE,
    category: Category.SENIOR,
    settings: { ...base, ...settings },
  }) as unknown as Competition;

const ctxAt = (round: number) =>
  ({
    db: { getSessionState: () => ({ currentPoolRound: round }) },
  }) as unknown as SessionSettingsContext;

describe('applyCompetitionSettings : tour de poules en cours', () => {
  const formula = applyOperationsV2(
    { weapon: Weapon.EPEE, category: Category.SENIOR, settings: base },
    [
      { op: 'insertPhase', brick: 'pool', at: 1 },
      { op: 'setPhase', phase: 'pool-1', settings: { maxScore: 4, timerSeconds: 120 } },
    ],
    () => 'x'
  );

  it('tour 1 puis tour 2 : réglages du tour', () => {
    const c1 = ctxAt(1);
    applyCompetitionSettings(c1, competition({ formula }));
    expect([c1.sessionPoolMaxScore, c1.sessionPoolTimerSeconds]).toEqual([5, 180]);
    const c2 = ctxAt(2);
    applyCompetitionSettings(c2, competition({ formula }));
    expect([c2.sessionPoolMaxScore, c2.sessionPoolTimerSeconds]).toEqual([4, 120]);
    expect(c2.sessionTableMaxScore).toBe(15);
  });

  it('sans formule enregistrée : réglages communs, comme avant', () => {
    const c = ctxAt(2);
    applyCompetitionSettings(c, competition({ defaultPoolMaxScore: 4 }));
    expect(c.sessionPoolMaxScore).toBe(4);
  });
});
