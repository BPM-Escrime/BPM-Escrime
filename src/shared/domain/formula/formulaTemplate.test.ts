import { describe, expect, it } from 'vitest';
import { Category, CompetitionSettings, Weapon } from '../../types';
import { buildDefaultCompetitionSettings } from '../../utils/defaultCompetitionSettings';
import { createDefaultCustomFormula } from '../../utils/tournamentTemplates';
import { draftFromSettings } from './formulaDraft';
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
import { applyFormulaOperations, formulaView } from './formulaOperations';
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
    expect(s.specialMode).toBe('rapieres');
    expect(s.customFormula?.phases.map(p => p.type)).toEqual(['pool_round', 'direct_elimination']);
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
