/**
 * validateFormulaSettings (docs/adr/0012) : bornes, cohérence, formule à la carte, champs jugés.
 */
import { describe, it, expect } from 'vitest';
import { validateFormulaSettings } from './validateFormulaSettings';
import {
  buildDefaultCompetitionSettings,
  getFallbackCompetitionSettings,
} from '../../utils/defaultCompetitionSettings';
import { Category, Weapon, type CompetitionSettings } from '../../types';

const base = () =>
  buildDefaultCompetitionSettings({ weapon: Weapon.EPEE, category: Category.SENIOR })!;
const fields = (s: Partial<CompetitionSettings>, f?: Array<keyof CompetitionSettings>) =>
  validateFormulaSettings(s, f).map(i => i.field);

describe('validateFormulaSettings', () => {
  it('réglages par défaut et de repli : conformes pour toutes les armes et catégories', () => {
    for (const weapon of Object.values(Weapon)) {
      for (const category of Object.values(Category)) {
        const created = buildDefaultCompetitionSettings({ weapon, category });
        if (created) expect(validateFormulaSettings(created)).toEqual([]);
        expect(validateFormulaSettings(getFallbackCompetitionSettings(weapon, category))).toEqual(
          []
        );
        const team = buildDefaultCompetitionSettings({ weapon, category, isTeamEvent: true });
        if (team) expect(validateFormulaSettings(team)).toEqual([]);
      }
    }
  });

  it('bornes : score de poule, tours, tailles de poule', () => {
    expect(
      fields({ ...base(), defaultPoolMaxScore: 16, poolRounds: 6, poolSizeMin: 7, poolSizeMax: 5 })
    ).toEqual(['defaultPoolMaxScore', 'poolRounds', 'poolSizeMax']);
    expect(fields({ ...base(), defaultTableMaxScore: 2.5 })).toEqual(['defaultTableMaxScore']);
  });

  it('qualifiés : pas plus de valeurs que de tours suivants', () => {
    expect(fields({ ...base(), poolRounds: 2, poolRoundQualifiers: [12] })).toEqual([]);
    expect(fields({ ...base(), poolRounds: 2, poolRoundQualifiers: [12, 6] })).toEqual([
      'poolRoundQualifiers',
    ]);
  });

  it('formule à la carte : version, phases, règles de passage, taille de tableau', () => {
    const issues = fields({
      ...base(),
      customFormula: {
        version: 1,
        phases: [
          {
            id: 'p1',
            type: 'pool_round',
            config: {
              maxScore: 5,
              timerSeconds: 180,
              minPoolSize: 6,
              maxPoolSize: 5,
              advancementRule: { mode: 'percentage', percentage: 150 },
            },
          },
          { id: 'p1', type: 'direct_elimination', config: { bracketSizeOverride: 24 } },
        ],
      } as never,
    });
    expect(issues).toEqual([
      'customFormula.phases[0].config.maxPoolSize',
      'customFormula.phases[0].config.advancementRule.percentage',
      'customFormula.phases[1].config.bracketSizeOverride',
      'customFormula.phases',
    ]);
    expect(fields({ ...base(), customFormula: { version: 1, phases: [] } as never })).toEqual([
      'customFormula.phases',
    ]);
  });

  it('champs jugés : un réglage ancien hors bornes ne bloque pas une autre modification', () => {
    const legacy = { ...base(), defaultPoolMaxScore: 21 }; // épreuve 2.0
    expect(fields(legacy, ['thirdPlaceMatch'])).toEqual([]);
    expect(fields(legacy, ['defaultPoolMaxScore'])).toEqual(['defaultPoolMaxScore']);
    // Changer le nombre de tours juge aussi les qualifiés
    expect(fields({ ...base(), poolRounds: 1, poolRoundQualifiers: [8] }, ['poolRounds'])).toEqual([
      'poolRoundQualifiers',
    ]);
  });
});
