import { describe, expect, it } from 'vitest';
import { Category, CompetitionSettings, Weapon } from '../../types';
import { buildDefaultCompetitionSettings } from '../../utils/defaultCompetitionSettings';
import { createDefaultCustomFormula } from '../../utils/tournamentTemplates';
import { flatSettingsOf, phaseSettings } from './formulaV2';
import {
  applyOperationsV2,
  formulaV2Issues,
  formulaViewV2,
  friezeOfV2,
  insertOptionsV2,
} from './formulaV2Operations';

let n = 0;
const id = () => `id-${++n}`;
const epee = (patch: Partial<CompetitionSettings> = {}) => ({
  weapon: Weapon.EPEE,
  category: Category.SENIOR,
  settings: {
    ...(buildDefaultCompetitionSettings({
      weapon: Weapon.EPEE,
      category: Category.SENIOR,
    }) as CompetitionSettings),
    ...patch,
  },
});

describe('frise sur la formule v2 (ADR-0036)', () => {
  it('mêmes briques autorisées que la frise de l’écran', () => {
    const v = formulaViewV2(epee());
    expect(v.phases.map(p => p.key)).toEqual(['pool-0', 'tableau']);
    expect(v.insertOptions).toEqual([['pool'], ['pool'], []]);
    const laser = formulaViewV2({ weapon: Weapon.LASER, category: Category.SENIOR });
    expect(laser.insertOptions[1]).toContain('quest');
  });

  it('chaque tour se règle séparément (noms v2)', () => {
    const f = applyOperationsV2(
      epee(),
      [
        { op: 'insertPhase', brick: 'pool', at: 1 },
        {
          op: 'setPhase',
          phase: 'pool-1',
          settings: { maxScore: 4, timerSeconds: 120, sizeMin: 6, sizeMax: 8 },
        },
        { op: 'setPhase', phase: 'pool-0', settings: { qualifiers: 24 } },
      ],
      id
    );
    expect(phaseSettings(f, { kind: 'pool', round: 0 })).toMatchObject({
      maxScore: 5,
      qualification: { mode: 'fixed_count', count: 24 },
    });
    expect(phaseSettings(f, { kind: 'pool', round: 1 })).toMatchObject({
      maxScore: 4,
      timerSeconds: 120,
      sizeMin: 6,
      sizeMax: 8,
    });
    // Réglages plats : ceux du premier tour (lecteurs non migrés)
    expect(flatSettingsOf(f, Weapon.EPEE)).toMatchObject({
      poolRounds: 2,
      defaultPoolMaxScore: 5,
      poolRoundQualifiers: [24],
    });
  });

  it('anciens noms de l’écran : réglage commun à tous les tours', () => {
    const two = applyOperationsV2(epee(), [{ op: 'insertPhase', brick: 'pool', at: 1 }], id);
    const f = applyOperationsV2(
      { ...epee(), settings: { ...epee().settings, formula: two } },
      [{ op: 'setPhase', phase: 'pool-0', settings: { poolMaxScore: 4, poolWinnersOnly: true } }],
      id
    );
    expect(phaseSettings(f, { kind: 'pool', round: 0 }).maxScore).toBe(4);
    expect(phaseSettings(f, { kind: 'pool', round: 1 }).maxScore).toBe(4);
    expect(phaseSettings(f, { kind: 'pool', round: 1 }).qualification).toEqual({
      mode: 'pool_winner',
    });
  });

  it('tableau retiré puis remis : réglages enregistrés repris', () => {
    const ctx = epee({ defaultTableMaxScore: 10, thirdPlaceMatch: true });
    const f = applyOperationsV2(
      ctx,
      [
        { op: 'removePhase', phase: 'tableau' },
        { op: 'insertPhase', brick: 'tableau', at: 1 },
      ],
      id
    );
    expect(phaseSettings(f, { kind: 'tableau' })).toMatchObject({ maxScore: 10, thirdPlace: true });
  });

  it('refus : brique mal placée, phase inconnue, réglage d’une autre phase', () => {
    expect(() =>
      applyOperationsV2(epee(), [{ op: 'insertPhase', brick: 'tableau', at: 1 }], id)
    ).toThrow(/interdit/);
    expect(() => applyOperationsV2(epee(), [{ op: 'removePhase', phase: 'pool-4' }], id)).toThrow(
      /inconnue/
    );
    expect(() =>
      applyOperationsV2(
        epee(),
        [{ op: 'setPhase', phase: 'tableau', settings: { sizeMin: 3 } }],
        id
      )
    ).toThrow(/non modifiable/);
  });

  it('bornes jugées tour par tour', () => {
    const f = applyOperationsV2(
      epee(),
      [
        { op: 'insertPhase', brick: 'pool', at: 1 },
        { op: 'setPhase', phase: 'pool-1', settings: { maxScore: 40 } },
      ],
      id
    );
    expect(formulaV2Issues(f, { weapon: Weapon.EPEE })).toEqual([
      expect.stringMatching(/^tour 2 : defaultPoolMaxScore/),
    ]);
  });

  it('arme « Autre » : mêmes opérations, barème du tour 2', () => {
    const ctx = {
      weapon: Weapon.CUSTOM,
      category: Category.SENIOR,
      settings: { customFormula: createDefaultCustomFormula() },
    };
    const f = applyOperationsV2(
      ctx,
      [
        { op: 'insertPhase', brick: 'pool', at: 1 },
        {
          op: 'setPhase',
          phase: 'pool-1',
          settings: { maxScore: 3, advancementRule: { mode: 'percentage', percentage: 50 } },
        },
        { op: 'setGeneral', settings: { ruleSet: 'modern' } },
      ],
      id
    );
    expect(friezeOfV2(f).map(p => p.key)).toEqual(['pool-0', 'pool-1', 'tableau']);
    const flat = flatSettingsOf(f, Weapon.CUSTOM);
    expect(flat.customFormula?.ruleSet).toBe('modern');
    expect(flat.customFormula?.phases[1].config).toMatchObject({
      maxScore: 3,
      advancementRule: { mode: 'percentage', percentage: 50 },
    });
  });

  it('Sabre Laser : Tour Quest au plus après un tour de poules', () => {
    const laser = { weapon: Weapon.LASER, category: Category.SENIOR };
    const two = applyOperationsV2(laser, [{ op: 'insertPhase', brick: 'pool', at: 1 }], id);
    expect(insertOptionsV2(two, Weapon.LASER, 2)).not.toContain('quest');
    const f = applyOperationsV2(laser, [{ op: 'insertPhase', brick: 'quest', at: 1 }], id);
    expect(flatSettingsOf(f, Weapon.LASER).questConfig).toMatchObject({
      enabled: true,
      hasPreliminaryPools: true,
    });
  });
});
