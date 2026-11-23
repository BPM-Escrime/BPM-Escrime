/**
 * validateFormulaSettings (docs/adr/0012) : bornes, cohérence, formule à la carte, champs jugés.
 */
import { describe, it, expect } from 'vitest';
import { maxScoreLimits, validateFormulaSettings } from './validateFormulaSettings';
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
        if (created) expect(validateFormulaSettings(created, undefined, { weapon })).toEqual([]);
        expect(
          validateFormulaSettings(getFallbackCompetitionSettings(weapon, category), undefined, {
            weapon,
          })
        ).toEqual([]);
        const team = buildDefaultCompetitionSettings({ weapon, category, isTeamEvent: true });
        if (team) {
          expect(validateFormulaSettings(team, undefined, { weapon, isTeamEvent: true })).toEqual(
            []
          );
        }
      }
    }
  });

  it('bornes : score de poule, tours, tailles de poule', () => {
    expect(
      fields({ ...base(), defaultPoolMaxScore: 16, poolRounds: 6, poolSizeMin: 7, poolSizeMax: 5 })
    ).toEqual(['defaultPoolMaxScore', 'poolRounds', 'poolSizeMax']);
    expect(fields({ ...base(), defaultTableMaxScore: 2.5 })).toEqual(['defaultTableMaxScore']);
  });

  it('score max du Sabre Laser individuel : 15 à 50 (#2208) ; équipes et olympique : 1-15', () => {
    const laser = (v: number, isTeamEvent = false) =>
      validateFormulaSettings({ defaultPoolMaxScore: v, defaultTableMaxScore: v }, undefined, {
        weapon: Weapon.LASER,
        isTeamEvent,
      }).map(i => i.field);
    expect(laser(25)).toEqual([]);
    expect(laser(30)).toEqual([]);
    expect(laser(15)).toEqual([]);
    expect(laser(50)).toEqual([]);
    expect(laser(14)).toEqual(['defaultPoolMaxScore', 'defaultTableMaxScore']);
    expect(laser(51)).toEqual(['defaultPoolMaxScore', 'defaultTableMaxScore']);
    expect(laser(5, true)).toEqual([]);
    expect(laser(25, true)).toEqual(['defaultPoolMaxScore']);
    expect(
      validateFormulaSettings({ defaultPoolMaxScore: 16 }, undefined, { weapon: Weapon.EPEE })
    ).toHaveLength(1);
    expect(maxScoreLimits({ weapon: Weapon.CUSTOM }).pool).toEqual({ min: 1, max: 15 });
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
