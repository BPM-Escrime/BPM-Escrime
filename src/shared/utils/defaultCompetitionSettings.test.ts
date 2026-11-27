import { describe, it, expect } from 'vitest';
import { Category, Weapon } from '../types';
import { buildDefaultCompetitionSettings } from './defaultCompetitionSettings';
import { createDefaultCustomFormula } from './tournamentTemplates';
import { deriveSettingsFromFormula } from './customFormulaSettings';

describe('buildDefaultCompetitionSettings', () => {
  it('arme olympique individuelle : scores selon la catégorie', () => {
    const s = buildDefaultCompetitionSettings({ weapon: Weapon.EPEE, category: Category.SENIOR });
    expect(s).toMatchObject({
      defaultPoolMaxScore: 5,
      defaultTableMaxScore: 15,
      defaultPoolTimerSeconds: 180,
      defaultTableTimerSeconds: 180,
      poolRounds: 1,
      hasDirectElimination: true,
      thirdPlaceMatch: false,
      minTeamSize: 3,
    });
    expect(s).not.toHaveProperty('teamReserveCount');
  });

  it('M9 : 3 touches en poule, 6 au tableau', () => {
    const s = buildDefaultCompetitionSettings({ weapon: Weapon.FOIL, category: Category.U9 });
    expect(s?.defaultPoolMaxScore).toBe(3);
    expect(s?.defaultTableMaxScore).toBe(6);
  });

  it('équipe : taille et remplaçants repris', () => {
    const s = buildDefaultCompetitionSettings({
      weapon: Weapon.SABRE,
      category: Category.SENIOR,
      isTeamEvent: true,
      teamSize: 4,
      teamReserveCount: 2,
    });
    expect(s).toMatchObject({ minTeamSize: 4, teamReserveCount: 2, defaultTableMaxScore: 15 });
    expect(s).not.toHaveProperty('laserTeamMode');
  });

  it('Sabre Laser équipe : mode et format', () => {
    const s = buildDefaultCompetitionSettings({
      weapon: Weapon.LASER,
      category: Category.SENIOR,
      isTeamEvent: true,
      teamFormat: 'laser-arena',
    });
    expect(s).toMatchObject({ laserTeamMode: 'touches', teamFormat: 'laser-arena' });
  });

  it('Sabre Laser individuel : score max 25 / 25 (provisoire, #2208)', () => {
    expect(
      buildDefaultCompetitionSettings({ weapon: Weapon.LASER, category: Category.SENIOR })
    ).toMatchObject({ defaultPoolMaxScore: 25, defaultTableMaxScore: 25, thirdPlaceMatch: false });
  });

  it('arme personnalisée : formule et réglages dérivés', () => {
    const customFormula = createDefaultCustomFormula();
    const s = buildDefaultCompetitionSettings({
      weapon: Weapon.CUSTOM,
      category: Category.SENIOR,
      customFormula,
    });
    expect(s?.customFormula).toBe(customFormula);
    // Le mode spécial n'est plus écrit (docs/adr/0043, F4e)
    expect(s?.specialMode).toBeUndefined();
    expect(s).toMatchObject(deriveSettingsFromFormula(customFormula));
  });
});
