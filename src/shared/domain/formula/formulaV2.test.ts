/**
 * Formule v2 (ADR-0034) : non-régression. Pour chaque épreuve du corpus, la formule construite à
 * la lecture redonne exactement les réglages que le moteur lit aujourd'hui, et la formule v1 de
 * l'arme « Autre » fait l'aller-retour sans perte.
 */
import { describe, expect, it } from 'vitest';
import {
  Category,
  CompetitionSettings,
  CustomDEConfig,
  CustomFormulaConfig,
  CustomPoolRoundConfig,
  Weapon,
} from '../../types';
import { buildDefaultCompetitionSettings } from '../../utils/defaultCompetitionSettings';
import { deriveSettingsFromFormula } from '../../utils/customFormulaSettings';
import { createDefaultCustomFormula } from '../../utils/tournamentTemplates';
import { draftFromSettings, draftToSettings } from './formulaDraft';
import { normalizeCustomFormula } from './formulaFrieze';
import {
  customFormulaOf,
  flatSettingsOf,
  formulaFromCustom,
  formulaOf,
  phaseSettings,
  type FormulaV2,
} from './formulaV2';

type Case = {
  label: string;
  weapon: Weapon;
  category: Category;
  settings?: Partial<CompetitionSettings>;
};

const OLYMPIC = [Weapon.EPEE, Weapon.FOIL, Weapon.SABRE, Weapon.LASER];

/** Corpus : défauts de création, épreuves 2.0 sans réglages, variantes de structure */
function corpus(): Case[] {
  const cases: Case[] = [];
  for (const weapon of OLYMPIC)
    for (const category of Object.values(Category))
      for (const isTeamEvent of [false, true]) {
        const base = buildDefaultCompetitionSettings({
          weapon,
          category,
          isTeamEvent,
        }) as CompetitionSettings;
        const tag = `${weapon} ${category}${isTeamEvent ? ' équipes' : ''}`;
        cases.push({ label: `${tag} défauts`, weapon, category, settings: base });
        cases.push({
          label: `${tag} 3 tours`,
          weapon,
          category,
          settings: {
            ...base,
            poolRounds: 3,
            poolRoundQualifiers: [0, 16],
            poolSizeMin: 6,
            poolSizeMax: 8,
          },
        });
        cases.push({
          label: `${tag} poules seules`,
          weapon,
          category,
          settings: { ...base, hasDirectElimination: false, poolWinnersOnly: false },
        });
        cases.push({
          label: `${tag} vainqueurs de poule, toutes les places`,
          weapon,
          category,
          settings: {
            ...base,
            poolWinnersOnly: true,
            playAllPositions: true,
            thirdPlaceMatch: true,
          },
        });
      }
  for (const weapon of OLYMPIC)
    cases.push({ label: `${weapon} épreuve 2.0 sans réglages`, weapon, category: Category.SENIOR });
  const laser = buildDefaultCompetitionSettings({
    weapon: Weapon.LASER,
    category: Category.SENIOR,
  }) as CompetitionSettings;
  cases.push({
    label: 'Sabre Laser Tour Quest sans poules',
    weapon: Weapon.LASER,
    category: Category.SENIOR,
    settings: {
      ...laser,
      poolRounds: 0,
      questConfig: {
        enabled: true,
        hasPreliminaryPools: false,
        opponentConstraint: 'club',
        fightsPerFencer: 4,
      },
    },
  });
  cases.push({
    label: 'Sabre Laser Tour Quest avec poules',
    weapon: Weapon.LASER,
    category: Category.SENIOR,
    settings: {
      ...laser,
      poolRounds: 1,
      questConfig: {
        enabled: true,
        hasPreliminaryPools: true,
        qualifiersCount: 12,
        opponentConstraint: 'none',
      },
    },
  });
  cases.push({
    label: 'épée compétition couplée',
    weapon: Weapon.EPEE,
    category: Category.U15,
    settings: {
      ...(buildDefaultCompetitionSettings({
        weapon: Weapon.EPEE,
        category: Category.U15,
      }) as CompetitionSettings),
      postPoolSplitCriteria: 'gender',
      restTimeSeconds: 30,
    },
  });
  return cases;
}

/** Ce que le moteur lit aujourd'hui : les réglages réécrits par l'écran depuis le brouillon */
const today = (c: Case) =>
  draftToSettings(
    draftFromSettings(c.weapon, c.category, c.settings as CompetitionSettings),
    c.weapon,
    c.settings?.questConfig
  );

describe('formule v2 construite à la lecture (épée… Sabre Laser)', () => {
  it.each(corpus().map(c => [c.label, c] as const))(
    '%s : mêmes réglages qu’aujourd’hui',
    (_l, c) => {
      const flat = flatSettingsOf(formulaOf(c), c.weapon);
      const expected = today(c);
      // Sans tableau (ou sans tour de poules), ses réglages n'ont pas de sens
      const TABLEAU = [
        'thirdPlaceMatch',
        'playAllPositions',
        'defaultTableMaxScore',
        'defaultTableTimerSeconds',
      ];
      const POOL = [
        'poolBoutOrder',
        'poolSizeMin',
        'poolSizeMax',
        'defaultPoolMaxScore',
        'defaultPoolTimerSeconds',
      ];
      const keys = Object.keys(expected).filter(
        k =>
          (expected.hasDirectElimination || !TABLEAU.includes(k)) &&
          (expected.poolRounds !== 0 || !POOL.includes(k))
      ) as Array<keyof CompetitionSettings>;
      for (const k of keys) expect(flat[k], `${c.label} · ${k}`).toEqual(expected[k]);
    }
  );

  it('lecture par phase : chaque tour et le tableau', () => {
    const settings = {
      ...(buildDefaultCompetitionSettings({
        weapon: Weapon.EPEE,
        category: Category.SENIOR,
      }) as CompetitionSettings),
      poolRounds: 2,
      poolRoundQualifiers: [24],
    };
    const f = formulaOf({ weapon: Weapon.EPEE, category: Category.SENIOR, settings });
    expect(phaseSettings(f, { kind: 'pool', round: 0 }).qualification).toEqual({
      mode: 'fixed_count',
      count: 24,
    });
    expect(phaseSettings(f, { kind: 'pool', round: 1 }).maxScore).toBe(5);
    // Tour au-delà de la formule : réglages du dernier tour
    expect(phaseSettings(f, { kind: 'pool', round: 7 }).id).toBe('pool-2');
    expect(phaseSettings(f, { kind: 'tableau' })?.maxScore).toBe(15);
  });

  it('formule enregistrée prioritaire sur les réglages plats', () => {
    const stored: FormulaV2 = { version: 2, phases: [], general: { restTimeSeconds: 0 } };
    expect(
      formulaOf({ weapon: Weapon.EPEE, category: Category.SENIOR, settings: { formula: stored } })
    ).toBe(stored);
  });
});

describe('arme « Autre » : customFormula v1 ↔ v2', () => {
  const base = createDefaultCustomFormula();
  const [pool, de] = base.phases;
  const poolCfg = pool.config as CustomPoolRoundConfig;
  const deCfg = de.config as CustomDEConfig;
  const formulas: Array<[string, CustomFormulaConfig]> = [
    ['défaut (avec « Classement final »)', base],
    [
      '3 tours, %, zones, règles modernes, repos',
      {
        ...base,
        ruleSet: 'modern',
        restTimeSeconds: 45,
        notes: 'club',
        phases: [
          {
            ...pool,
            label: 'Tour A',
            config: { ...poolCfg, advancementRule: { mode: 'percentage', percentage: 70 } },
          },
          {
            ...pool,
            id: 'p2',
            config: {
              ...poolCfg,
              roundIndex: 1,
              maxScore: 4,
              advancementRule: { mode: 'fixed_count', count: 8 },
            },
          },
          {
            ...pool,
            id: 'p3',
            config: {
              ...poolCfg,
              roundIndex: 2,
              scoring: {
                type: 'zones',
                maxScore: 10,
                zones: [{ id: 'z', label: 'Tête', points: 3 }],
              },
              advancementRule: { mode: 'pool_winner' },
            },
          },
          {
            ...de,
            config: {
              ...deCfg,
              bracketSizeOverride: 16,
              fifthPlaceMatch: true,
              placesToFence: [1, 3, 5],
            },
          },
        ],
      },
    ],
    ['poules seules', { ...base, phases: [pool] }],
    [
      'deux tableaux (le second n’était pas exécuté)',
      { ...base, phases: [pool, de, { ...de, id: 'de2' }] },
    ],
  ];

  it.each(formulas)('%s : aller-retour sans perte, mêmes réglages dérivés', (_l, custom) => {
    const v2 = formulaFromCustom(custom);
    expect(customFormulaOf(v2)).toEqual(normalizeCustomFormula(custom));
    const flat = flatSettingsOf(v2, Weapon.CUSTOM);
    expect(flat.customFormula).toEqual(normalizeCustomFormula(custom));
    const { customFormula: _cf, ...derived } = flat;
    expect(derived).toEqual(deriveSettingsFromFormula(custom));
  });

  it('lecture par phase : touches du tour 2 distinctes du tour 1', () => {
    const v2 = formulaOf({
      weapon: Weapon.CUSTOM,
      category: Category.SENIOR,
      settings: { customFormula: formulas[1][1] },
    });
    expect(phaseSettings(v2, { kind: 'pool', round: 0 }).maxScore).toBe(5);
    expect(phaseSettings(v2, { kind: 'pool', round: 1 }).maxScore).toBe(4);
    expect(phaseSettings(v2, { kind: 'pool', round: 2 }).scoring?.type).toBe('zones');
  });
});
