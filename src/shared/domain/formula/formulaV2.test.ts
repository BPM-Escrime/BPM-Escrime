/**
 * Formule v2 (ADR-0036) : non-régression. Pour chaque épreuve du corpus, la formule construite à
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
  playedTableauOf,
  poolBoutOrderOfRound,
  tableauQualificationOf,
  tieBreakByVictoryOf,
  withFlatSettings,
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
    const { customFormula: _cf, playAllPositions, ...derived } = flat;
    expect(derived).toEqual(deriveSettingsFromFormula(custom));
    // « Toutes les places » lu dans la brique tableau (#2013, F4g) : absent de la v1
    expect(playAllPositions).toBe(
      custom.phases.some(p => p.type === 'direct_elimination') ? false : undefined
    );
  });

  it('« toutes les places » de la brique tableau projeté sur les réglages plats (#2013, F4g)', () => {
    const v2 = formulaFromCustom(formulas[0][1]);
    const on: FormulaV2 = {
      ...v2,
      phases: v2.phases.map(p => (p.kind === 'tableau' ? { ...p, allPlaces: true } : p)),
    };
    expect(flatSettingsOf(on, Weapon.CUSTOM).playAllPositions).toBe(true);
    expect(flatSettingsOf(v2, Weapon.CUSTOM).playAllPositions).toBe(false);
    // Sans formule v2 enregistrée : réglage plat relu, pas effacé à la réécriture
    const read = formulaOf({
      weapon: Weapon.CUSTOM,
      category: Category.SENIOR,
      settings: { customFormula: formulas[0][1], playAllPositions: true },
    });
    expect(playedTableauOf(read)?.allPlaces).toBe(true);
    expect(flatSettingsOf(read, Weapon.CUSTOM).playAllPositions).toBe(true);
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

describe('qualification vers le tableau (#2013 R1)', () => {
  const pool = (id: string, qualification: object) =>
    ({ kind: 'pool', id, qualification }) as unknown as FormulaV2['phases'][number];
  const tableau = { kind: 'tableau', id: 'tableau' } as unknown as FormulaV2['phases'][number];
  const f = (...phases: FormulaV2['phases']): FormulaV2 =>
    ({ version: 2, phases, general: {} }) as FormulaV2;
  const pct = { mode: 'percentage', percentage: 80 };

  it('règle du tour juste avant le tableau', () => {
    expect(
      tableauQualificationOf(f(pool('p1', { mode: 'all' }), pool('p2', pct), tableau))
    ).toEqual(pct);
  });

  it('tous qualifiés, sans tableau ou tableau en tête : aucune', () => {
    expect(tableauQualificationOf(f(pool('p1', { mode: 'all' }), tableau))).toBeUndefined();
    expect(tableauQualificationOf(f(pool('p1', pct)))).toBeUndefined();
    expect(tableauQualificationOf(f(tableau))).toBeUndefined();
  });

  it('Tour Quest avant le tableau : aucune', () => {
    const quest = { kind: 'quest', id: 'quest' } as unknown as FormulaV2['phases'][number];
    expect(tableauQualificationOf(f(pool('p1', pct), quest, tableau))).toBeUndefined();
  });

  it('épreuve sans formule v2 : réglages plats, aucune qualification en % (comportement historique)', () => {
    const settings = buildDefaultCompetitionSettings({
      weapon: Weapon.EPEE,
      category: Category.SENIOR,
    }) as CompetitionSettings;
    const built = formulaOf({ weapon: Weapon.EPEE, category: Category.SENIOR, settings });
    expect(tableauQualificationOf(built)).toBeUndefined();
  });
});

describe('ordre des matchs du tour tiré (ADR-0042 : réglages du tour)', () => {
  it('réglage du tour dans la formule, sinon le réglage plat', () => {
    const f: FormulaV2 = {
      version: 2,
      general: {},
      phases: [
        { kind: 'pool', id: 'p1', boutOrder: 'fie' } as never,
        { kind: 'pool', id: 'p2', boutOrder: 'free' } as never,
      ],
    };
    expect(poolBoutOrderOfRound({ formula: f }, 1)).toBe('fie');
    expect(poolBoutOrderOfRound({ formula: f }, 2)).toBe('free');
    expect(poolBoutOrderOfRound({ poolBoutOrder: 'free' }, 1)).toBe('free');
    expect(poolBoutOrderOfRound(undefined, 1)).toBeUndefined();
  });
});

describe('départage par vainqueur désigné : tieBreakByVictoryOf (docs/adr/0043, F4e)', () => {
  const withGeneral = (general: FormulaV2['general']): Partial<CompetitionSettings> => ({
    formula: { version: 2, general, phases: [] },
  });

  it('armes olympiques et Sabre Laser : toujours, quelle que soit la formule', () => {
    for (const weapon of [Weapon.EPEE, Weapon.FOIL, Weapon.SABRE, Weapon.LASER]) {
      expect(tieBreakByVictoryOf(weapon, undefined)).toBe(true);
      expect(tieBreakByVictoryOf(weapon, withGeneral({}))).toBe(true);
    }
  });

  it('arme « Autre » : par défaut non, oui si la formule le demande (valeur lue)', () => {
    expect(tieBreakByVictoryOf(Weapon.CUSTOM, undefined)).toBe(false);
    expect(tieBreakByVictoryOf(Weapon.CUSTOM, {})).toBe(false);
    expect(tieBreakByVictoryOf(Weapon.CUSTOM, withGeneral({}))).toBe(false);
    expect(tieBreakByVictoryOf(Weapon.CUSTOM, withGeneral({ tieBreakByVictory: true }))).toBe(true);
    expect(tieBreakByVictoryOf(Weapon.CUSTOM, withGeneral({ tieBreakByVictory: false }))).toBe(
      false
    );
    expect(tieBreakByVictoryOf(undefined, withGeneral({ tieBreakByVictory: true }))).toBe(true);
  });

  it('ancienne épreuve rapières (specialMode, sans formule) : lue comme la formule des rapières', () => {
    const legacy: Partial<CompetitionSettings> = { specialMode: 'rapieres' };
    expect(tieBreakByVictoryOf(Weapon.CUSTOM, legacy)).toBe(true);
    // Même avec des réglages plats enregistrés, sans formule
    expect(tieBreakByVictoryOf(Weapon.CUSTOM, { ...legacy, defaultPoolMaxScore: 5 })).toBe(true);
    // Une épreuve « Autre » sans mode spécial reste au défaut
    expect(tieBreakByVictoryOf(Weapon.CUSTOM, { defaultPoolMaxScore: 5 })).toBe(false);
  });
});

describe('withFlatSettings : réglages plats reportés dans la formule (ADR-0036 amendée)', () => {
  const twoRounds = (): FormulaV2 => {
    const f = formulaOf({
      weapon: Weapon.EPEE,
      category: Category.SENIOR,
      settings: {
        ...buildDefaultCompetitionSettings({ weapon: Weapon.EPEE, category: Category.SENIOR }),
        poolRounds: 2,
      },
    });
    return {
      ...f,
      phases: f.phases.map((p, i) =>
        i === 0 && p.kind === 'pool'
          ? { ...p, qualification: { mode: 'fixed_count' as const, count: 10 } }
          : p
      ),
    };
  };

  it('scores, durées, tailles des poules (tous les tours), tableau et repos ; le reste gardé', () => {
    const f = twoRounds();
    const out = withFlatSettings(f, {
      defaultPoolMaxScore: 4,
      poolSizeMax: 8,
      poolBoutOrder: 'waves',
      defaultTableTimerSeconds: 240,
      playAllPositions: true,
      restTimeSeconds: 90,
    })!;
    const pools = out.phases.filter(p => p.kind === 'pool');
    expect(pools.map(p => [p.maxScore, p.sizeMax, p.boutOrder])).toEqual([
      [4, 8, 'waves'],
      [4, 8, 'waves'],
    ]);
    expect(pools[0]).toMatchObject({ qualification: { mode: 'fixed_count', count: 10 } });
    expect(playedTableauOf(out)).toMatchObject({ timerSeconds: 240, allPlaces: true });
    expect(out.general.restTimeSeconds).toBe(90);
  });

  it('structure ou phase absente : null (formule retirée, relue à plat)', () => {
    const f = twoRounds();
    expect(withFlatSettings(f, { poolRounds: 1 })).toBeNull();
    expect(withFlatSettings(f, { poolWinnersOnly: true })).toBeNull();
    expect(withFlatSettings(f, { hasDirectElimination: false })).toBeNull();
    const noTableau = { ...f, phases: f.phases.filter(p => p.kind !== 'tableau') };
    expect(withFlatSettings(noTableau, { thirdPlaceMatch: true })).toBeNull();
  });

  it('compétition couplée : tableau des branches restées mis à jour', () => {
    const f = formulaOf({
      weapon: Weapon.EPEE,
      category: Category.SENIOR,
      settings: {
        ...buildDefaultCompetitionSettings({ weapon: Weapon.EPEE, category: Category.SENIOR }),
        postPoolSplitCriteria: 'gender',
      },
    });
    const out = withFlatSettings(f, { thirdPlaceMatch: true })!;
    expect(playedTableauOf(out)).toMatchObject({ thirdPlace: true });
  });
});
