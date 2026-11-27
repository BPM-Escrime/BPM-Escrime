import { describe, expect, it } from 'vitest';
import {
  Category,
  CompetitionSettings,
  CustomDEConfig,
  CustomPoolRoundConfig,
  Weapon,
} from '../../types';
import { buildDefaultCompetitionSettings } from '../../utils/defaultCompetitionSettings';
import { createDefaultCustomFormula } from '../../utils/tournamentTemplates';
import { draftFromSettings, draftToSettings } from './formulaDraft';
import { normalizeCustomFormula } from './formulaFrieze';
import {
  filterTemplates,
  formulaDeviations,
  standardTemplate,
  templateIssues,
  templateMatches,
  templateToSettings,
  validatePersonalTemplates,
  type FormulaTemplate,
} from './formulaTemplate';
import { applyFormulaOperations, formulaOperationsBetween, formulaView } from './formulaOperations';
import { providedTemplates } from './presets/bpmTemplates';

const defaults = (weapon: Weapon, category: Category, isTeamEvent = false) =>
  buildDefaultCompetitionSettings({ weapon, category, isTeamEvent }) as CompetitionSettings;

describe('catalogue fourni (docs/adr/0033)', () => {
  const all = providedTemplates();

  it('identifiants uniques, modèles valides, lecture seule', () => {
    expect(new Set(all.map(t => t.id)).size).toBe(all.length);
    for (const t of all) expect(templateIssues(t)).toEqual([]);
    expect(Object.isFrozen(all)).toBe(true);
  });

  it('un standard par arme × catégorie × type, égal aux défauts de création', () => {
    for (const weapon of [Weapon.EPEE, Weapon.FOIL, Weapon.SABRE, Weapon.LASER])
      for (const category of Object.values(Category))
        for (const isTeamEvent of [false, true]) {
          const std = standardTemplate(all, { weapon, category, isTeamEvent });
          expect(std, `${weapon} ${category} ${isTeamEvent}`).toBeDefined();
          const settings = defaults(weapon, category, isTeamEvent);
          const comp = {
            weapon,
            category,
            settings: { ...settings, ...templateToSettings(std!, weapon, settings) },
          };
          expect(formulaDeviations(comp, all).state).toBe('standard');
        }
  });

  it('épée M13 : standard 4 / 8 touches', () => {
    const std = standardTemplate(all, { weapon: Weapon.EPEE, category: Category.U13 })!;
    expect(std.body.kind).toBe('draft');
    if (std.body.kind === 'draft') {
      expect(std.body.draft.poolMaxScore).toBe(4);
      expect(std.body.draft.tableMaxScore).toBe(8);
    }
  });

  it('arme « Autre » : standard et Tournoi des rapières, rien d’autre', () => {
    const other = filterTemplates(all, { weapon: Weapon.CUSTOM, category: Category.SENIOR });
    expect(other.map(t => t.code)).toEqual(['standard', 'rapieres']);
    const rap = other[1];
    const s = templateToSettings(rap, Weapon.CUSTOM, undefined);
    // Formule en briques, plus de mode spécial (docs/adr/0043, F4e)
    expect(s.specialMode).toBeUndefined();
    expect(s.customFormula?.phases.map(p => p.type)).toEqual(['pool_round', 'direct_elimination']);
    expect(s.formula?.phases.map(p => p.kind)).toEqual(['pool', 'tableau']);
    expect(s.poolBoutOrder).toBe('waves');
    expect(s.formula?.general.entry).toMatchObject({ kind: 'team', size: 2 });
  });

  it('recherche sans accents ni casse', () => {
    const r = filterTemplates(all, { text: 'RAPIERES' });
    expect(r.map(t => t.id)).toEqual(['bpm/C/rapieres']);
  });
});

describe('compatibilité, modèles personnels', () => {
  const perso: FormulaTemplate = {
    id: 'perso/1',
    source: 'personal',
    name: 'Mon club',
    body: {
      kind: 'draft',
      draft: draftFromSettings(
        Weapon.EPEE,
        Category.SENIOR,
        defaults(Weapon.EPEE, Category.SENIOR)
      ),
    },
  };

  it('un modèle « draft » ne s’applique pas à l’arme « Autre », ni l’inverse', () => {
    expect(templateMatches(perso, { weapon: Weapon.CUSTOM })).toBe(false);
    expect(templateMatches(perso, { weapon: Weapon.FOIL })).toBe(true);
  });

  it('personnels après les fournis', () => {
    const list = filterTemplates([perso, ...providedTemplates()], {
      weapon: Weapon.EPEE,
      category: Category.SENIOR,
    });
    expect(list[list.length - 1].id).toBe('perso/1');
  });

  it('bibliothèque validée : formule hors bornes refusée', () => {
    expect(validatePersonalTemplates([perso])).toHaveLength(1);
    const bad = {
      ...perso,
      body: { kind: 'draft', draft: { ...(perso.body as { draft: object }).draft, poolRounds: 9 } },
    };
    expect(() => validatePersonalTemplates([bad])).toThrow(/poolRounds/);
    expect(() => validatePersonalTemplates([{ ...perso, name: '' }])).toThrow(/name/);
  });

  it('état : libre sans origine, adaptée avec écart', () => {
    const settings = defaults(Weapon.EPEE, Category.SENIOR);
    expect(
      formulaDeviations({ weapon: Weapon.EPEE, category: Category.SENIOR, settings }, [perso]).state
    ).toBe('free');
    const applied = { ...settings, ...templateToSettings(perso, Weapon.EPEE, settings) };
    const r = formulaDeviations(
      {
        weapon: Weapon.EPEE,
        category: Category.SENIOR,
        settings: { ...applied, defaultTableMaxScore: 10 },
      },
      [perso]
    );
    expect(r.state).toBe('adapted');
    expect(r.deviations).toEqual([{ field: 'tableMaxScore', expected: 15, actual: 10 }]);
  });
});

describe('opérations de formule (updateCompetitionFormula)', () => {
  let n = 0;
  const id = () => `x${++n}`;
  const epee = {
    weapon: Weapon.EPEE,
    category: Category.SENIOR,
    settings: defaults(Weapon.EPEE, Category.SENIOR),
  };

  it('insère un tour, règle les qualifiés et le tableau, tout ou rien', () => {
    const out = applyFormulaOperations(
      epee,
      [
        { op: 'insertPhase', brick: 'pool', at: 1 },
        { op: 'setPhase', phase: 'pool-0', settings: { qualifiers: 24 } },
        {
          op: 'setPhase',
          phase: 'tableau',
          settings: { tableMaxScore: 10, thirdPlaceMatch: true },
        },
      ],
      id
    );
    expect(out).toMatchObject({
      poolRounds: 2,
      poolRoundQualifiers: [24],
      defaultTableMaxScore: 10,
      thirdPlaceMatch: true,
    });
  });

  it('refus : brique interdite, phase inconnue, réglage non modifiable ici', () => {
    expect(() =>
      applyFormulaOperations(epee, [{ op: 'insertPhase', brick: 'tableau', at: 1 }], id)
    ).toThrow(/interdit en position 1/);
    expect(() =>
      applyFormulaOperations(epee, [{ op: 'removePhase', phase: 'pool-3' }], id)
    ).toThrow(/inconnue/);
    expect(() =>
      applyFormulaOperations(
        epee,
        [{ op: 'setPhase', phase: 'pool-0', settings: { tableMaxScore: 3 } }],
        id
      )
    ).toThrow(/non modifiable/);
    expect(() =>
      applyFormulaOperations(
        epee,
        [{ op: 'setPhase', phase: 'pool-0', settings: { qualifiers: 8 } }],
        id
      )
    ).toThrow(/qualifiers/);
  });

  it('arme « Autre » : barème et règles, classement final implicite', () => {
    const other = {
      weapon: Weapon.CUSTOM,
      category: Category.SENIOR,
      settings: { customFormula: createDefaultCustomFormula() } as Partial<CompetitionSettings>,
    };
    const out = applyFormulaOperations(
      other,
      [
        { op: 'setPhase', phase: 'tableau', settings: { maxScore: 10 } },
        { op: 'setGeneral', settings: { ruleSet: 'modern' } },
      ],
      id
    );
    expect(out.defaultTableMaxScore).toBe(10);
    expect(out.customFormula?.ruleSet).toBe('modern');
    expect(out.customFormula?.phases.some(p => p.type === 'classification')).toBe(false);
  });

  it('vue : briques autorisées à chaque position, relevé de cohérence', () => {
    const v = formulaView({ ...epee, category: Category.U13 });
    expect(v.phases.map(p => p.key)).toEqual(['pool-0', 'tableau']);
    expect(v.insertOptions).toEqual([['pool'], ['pool'], []]);
    expect(v.coherence.map(c => c.field).sort()).toEqual(['poolMaxScore', 'tableMaxScore']);
  });
});

describe('opérations entre deux formules (écran → updateCompetitionFormula)', () => {
  let n = 0;
  const id = () => `y${++n}`;
  const roundTrip = (
    weapon: Weapon,
    category: Category,
    from: Partial<CompetitionSettings>,
    to: Partial<CompetitionSettings>
  ) => {
    const ctx = { weapon, category, settings: from };
    const ops = formulaOperationsBetween(ctx, to);
    const out = ops.length ? applyFormulaOperations(ctx, ops, id) : {};
    return { ops, result: { ...from, ...out } };
  };

  it('épée : aucune modification, aucune opération', () => {
    const s = defaults(Weapon.EPEE, Category.SENIOR);
    expect(
      formulaOperationsBetween({ weapon: Weapon.EPEE, category: Category.SENIOR, settings: s }, s)
    ).toEqual([]);
  });

  it.each([
    [
      '2 tours, 24 qualifiés, tableau en 10',
      { poolRounds: 2, poolRoundQualifiers: [24], defaultTableMaxScore: 10 },
    ],
    [
      'poules seules, poules de 6 à 8',
      { hasDirectElimination: false, poolSizeMin: 6, poolSizeMax: 8 },
    ],
    [
      '3 tours puis retour à 1 avec repos 30 s',
      { poolRounds: 3, poolRoundQualifiers: [0, 16], restTimeSeconds: 30 },
    ],
  ])('épée : %s', (_label, patch) => {
    const from = defaults(Weapon.EPEE, Category.SENIOR);
    const target = draftToSettings(
      { ...draftFromSettings(Weapon.EPEE, Category.SENIOR, from), ...patchToDraft(patch) },
      Weapon.EPEE,
      undefined
    );
    const { result } = roundTrip(Weapon.EPEE, Category.SENIOR, from, target);
    expect(draftFromSettings(Weapon.EPEE, Category.SENIOR, result as CompetitionSettings)).toEqual(
      draftFromSettings(Weapon.EPEE, Category.SENIOR, { ...from, ...target } as CompetitionSettings)
    );
  });

  it('Sabre Laser : Tour Quest ajouté', () => {
    const from = defaults(Weapon.LASER, Category.SENIOR);
    const d = draftFromSettings(Weapon.LASER, Category.SENIOR, from);
    const target = draftToSettings(
      { ...d, questEnabled: true, questHasPools: true, poolRounds: 1, questQualifiers: 12 },
      Weapon.LASER,
      undefined
    );
    const { result } = roundTrip(Weapon.LASER, Category.SENIOR, from, target);
    const r = draftFromSettings(Weapon.LASER, Category.SENIOR, result as CompetitionSettings);
    expect(r.questEnabled).toBe(true);
    expect(r.questQualifiers).toBe(12);
  });

  it('arme « Autre » : tour ajouté, barème et règles', () => {
    const base = normalizeCustomFormula(createDefaultCustomFormula());
    const [pool, de] = base.phases;
    const to = {
      ...base,
      ruleSet: 'modern' as const,
      phases: [
        pool,
        {
          ...pool,
          id: 'p2',
          config: {
            ...(pool.config as CustomPoolRoundConfig),
            roundIndex: 1,
            maxScore: 4,
            advancementRule: { mode: 'fixed_count' as const, count: 8 },
          },
        },
        { ...de, config: { ...(de.config as CustomDEConfig), maxScore: 10 } },
      ],
    };
    const { result } = roundTrip(
      Weapon.CUSTOM,
      Category.SENIOR,
      { customFormula: base },
      { customFormula: to }
    );
    const f = result.customFormula!;
    expect(f.ruleSet).toBe('modern');
    expect(f.phases.map(p => p.type)).toEqual(['pool_round', 'pool_round', 'direct_elimination']);
    expect((f.phases[1].config as CustomPoolRoundConfig).advancementRule).toEqual({
      mode: 'fixed_count',
      count: 8,
    });
    expect((f.phases[1].config as CustomPoolRoundConfig).maxScore).toBe(4);
    expect((f.phases[2].config as CustomDEConfig).maxScore).toBe(10);
  });
});

/** Réglages plats d'un test → champs du brouillon */
function patchToDraft(
  p: Partial<CompetitionSettings>
): Partial<import('./formulaDraft').FormulaDraft> {
  return {
    ...(p.poolRounds !== undefined ? { poolRounds: p.poolRounds } : {}),
    ...(p.poolRoundQualifiers ? { poolRoundQualifiers: p.poolRoundQualifiers } : {}),
    ...(p.defaultTableMaxScore !== undefined ? { tableMaxScore: p.defaultTableMaxScore } : {}),
    ...(p.hasDirectElimination !== undefined
      ? { hasDirectElimination: p.hasDirectElimination }
      : {}),
    ...(p.poolSizeMin !== undefined ? { poolSizeMin: p.poolSizeMin } : {}),
    ...(p.poolSizeMax !== undefined ? { poolSizeMax: p.poolSizeMax } : {}),
    ...(p.restTimeSeconds !== undefined ? { restTimeSeconds: p.restTimeSeconds } : {}),
  };
}
