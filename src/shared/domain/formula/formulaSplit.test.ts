/**
 * Brique Scission de la formule v2 (docs/adr/0039 ; ADR-0036 et ADR-0037 amendées le
 * 2026-11-26) : grammaire de la frise, règles, opérations entre deux formules, déroulé.
 */
import { describe, expect, it } from 'vitest';
import { Category, CompetitionSettings, Gender, Weapon } from '../../types';
import { buildDefaultCompetitionSettings } from '../../utils/defaultCompetitionSettings';
import {
  customFormulaOf,
  flatSettingsOf,
  formulaOf,
  type FormulaV2,
  type SplitPhase,
} from './formulaV2';
import {
  addSplitBranch,
  applyOperationsV2,
  branchPhases,
  branchPresetOf,
  removeSplitBranch,
  withSplitCriterion,
  canRemoveV2,
  formulaV2Issues,
  friezeOfV2,
  insertOptionsV2,
  operationsBetweenV2,
  removeV2,
  summarizeFormulaV2,
  simulationFormulaOf,
} from './formulaV2Operations';
import { formulaSegment, formulaSteps, stoppedTableauOf } from './formulaSteps';

let n = 0;
const id = () => `id-${++n}`;
const settings = buildDefaultCompetitionSettings({
  weapon: Weapon.EPEE,
  category: Category.SENIOR,
}) as CompetitionSettings;
const ctx = { weapon: Weapon.EPEE, category: Category.SENIOR, settings };
const scope = { weapon: Weapon.EPEE };
const withFormula = (formula: FormulaV2) => ({ ...ctx, settings: { ...settings, formula } });

/** Poules puis scission par défaut (tableau retiré) */
const afterPools = () =>
  applyOperationsV2(
    ctx,
    [
      { op: 'removePhase', phase: 'tableau' },
      { op: 'insertPhase', brick: 'split', at: 1 },
    ],
    id
  );
/** Poules, tableau arrêté à 8, scission */
const afterStopped = () =>
  applyOperationsV2(
    ctx,
    [
      { op: 'setPhase', phase: 'tableau', settings: { stopAt: 8 } },
      { op: 'insertPhase', brick: 'split', at: 2 },
    ],
    id
  );
const splitOf = (f: FormulaV2) => f.phases.find((p): p is SplitPhase => p.kind === 'split')!;
const withSplit = (f: FormulaV2, patch: Partial<SplitPhase>): FormulaV2 => ({
  ...f,
  phases: f.phases.map(p => (p.kind === 'split' ? { ...p, ...patch } : p)),
});

describe('grammaire de la scission (ADR-0039)', () => {
  it('« ＋ » : scission en fin de frise après un tour de poules ou un tableau arrêté', () => {
    const base = formulaOf(ctx);
    // Tableau jusqu'à la finale : pas de scission après lui
    expect(insertOptionsV2(base, Weapon.EPEE, 2)).not.toContain('split');
    const pools = applyOperationsV2(ctx, [{ op: 'removePhase', phase: 'tableau' }], id);
    expect(insertOptionsV2(pools, Weapon.EPEE, 1)).toContain('split');
    // Pas au milieu de la frise
    expect(insertOptionsV2(pools, Weapon.EPEE, 0)).not.toContain('split');
    const stopped = applyOperationsV2(
      ctx,
      [{ op: 'setPhase', phase: 'tableau', settings: { stopAt: 8 } }],
      id
    );
    expect(insertOptionsV2(stopped, Weapon.EPEE, 2)).toContain('split');
  });

  it('scission par défaut : par rang, « Tableau A » (16) et « Tableau B » (le reste)', () => {
    const f = afterPools();
    expect(friezeOfV2(f).map(p => p.key)).toEqual(['pool-0', 'split']);
    const split = splitOf(f);
    expect(split.criterion).toBe('rank');
    expect(split.branches.map(b => b.label)).toEqual(['Tableau A', 'Tableau B']);
    expect(split.branches[0].take).toEqual({ mode: 'fixed_count', count: 16 });
    expect(split.branches[1].take).toBeUndefined();
    expect(split.branches.every(b => b.phases.map(p => p.kind).join() === 'tableau')).toBe(true);
    expect(formulaV2Issues(f, scope)).toEqual([]);
  });

  it('toujours la dernière phase : rien ne s’insère après elle, une seule scission', () => {
    const f = afterPools();
    expect(insertOptionsV2(f, Weapon.EPEE, 2)).toEqual([]);
    // Un tour de poules peut encore s'insérer avant elle
    expect(insertOptionsV2(f, Weapon.EPEE, 1)).toEqual(['pool']);
    const g = afterStopped();
    expect(insertOptionsV2(g, Weapon.EPEE, 3)).toEqual([]);
    expect(insertOptionsV2(g, Weapon.EPEE, 2)).toEqual(['pool']);
    expect(() =>
      applyOperationsV2(withFormula(f), [{ op: 'insertPhase', brick: 'tableau', at: 2 }], id)
    ).toThrow(/interdit/);
    const moved = { ...f, phases: [splitOf(f), ...f.phases.filter(p => p.kind !== 'split')] };
    expect(formulaV2Issues(moved, scope)).toContain('scission : toujours la dernière phase');
  });

  it('pas de Tour Quest avec une scission', () => {
    const laser = { weapon: Weapon.LASER, category: Category.SENIOR };
    const quest = applyOperationsV2(laser, [{ op: 'insertPhase', brick: 'quest', at: 1 }], id);
    const at = friezeOfV2(quest).length;
    expect(insertOptionsV2(quest, Weapon.LASER, at)).not.toContain('split');
    const f = applyOperationsV2(
      laser,
      [
        { op: 'removePhase', phase: 'tableau' },
        { op: 'insertPhase', brick: 'split', at: 1 },
      ],
      id
    );
    expect(insertOptionsV2(f, Weapon.LASER, 1)).not.toContain('quest');
  });

  it('scission après un tableau jusqu’à la finale : refusée', () => {
    const f = afterStopped();
    const full = {
      ...f,
      phases: f.phases.map(p => (p.kind === 'tableau' ? { ...p, stopAt: undefined } : p)),
    };
    expect(formulaV2Issues(full, scope)).toContain(
      'scission : après un tour de poules ou un tableau arrêté à N tireurs'
    );
  });

  it('tableau arrêté suivi d’une scission : valide, compte comme arrêté (ADR-0037 amendée)', () => {
    const f = afterStopped();
    expect(formulaV2Issues(f, scope)).toEqual([]);
    expect(stoppedTableauOf(f)?.stopAt).toBe(8);
  });

  it('retrait de la scission qui suit un tableau arrêté : le tableau redevient complet', () => {
    const f = removeV2(afterStopped(), { kind: 'split', key: 'split' });
    expect(f.phases.map(p => p.kind)).toEqual(['pool', 'tableau']);
    expect(f.phases[1]).not.toHaveProperty('stopAt');
  });

  it('retrait d’une phase qui laisserait la scission mal placée : refusé', () => {
    const f = afterPools();
    expect(canRemoveV2(f, { kind: 'pool', round: 0, key: 'pool-0' })).toBe(false);
    expect(canRemoveV2(f, { kind: 'split', key: 'split' })).toBe(true);
    const g = afterStopped();
    // Tableau arrêté retiré : la scission suit le tour de poules
    expect(canRemoveV2(g, { kind: 'tableau', key: 'tableau' })).toBe(true);
    // Dernier tour d'après retiré, scission après le tableau : l'arrêt reste
    const h = applyOperationsV2(withFormula(g), [{ op: 'insertPhase', brick: 'pool', at: 2 }], id);
    expect(friezeOfV2(h).map(p => p.key)).toEqual(['pool-0', 'tableau', 'pool-1', 'split']);
    const back = removeV2(h, { kind: 'pool', round: 1, key: 'pool-1' });
    expect(back.phases[1]).toMatchObject({ stopAt: 8 });
  });
});

describe('règles de la scission (formulaV2Issues, ADR-0039)', () => {
  const f = afterPools();
  const branches = splitOf(f).branches;

  it('deux branches au moins, chacune avec une phase, sans scission ni Tour Quest', () => {
    expect(formulaV2Issues(withSplit(f, { branches: [branches[1]] }), scope)).toContain(
      'scission : deux branches au moins'
    );
    const empty = withSplit(f, { branches: [branches[0], { ...branches[1], phases: [] }] });
    expect(formulaV2Issues(empty, scope)).toContain('branche « Tableau B » : au moins une phase');
    const nested = withSplit(f, {
      branches: [branches[0], { ...branches[1], phases: [splitOf(f)] }],
    });
    expect(formulaV2Issues(nested, scope)).toContain(
      'branche « Tableau B » : ni scission ni Tour Quest dans une branche'
    );
  });

  it('libellés non vides et distincts', () => {
    const same = withSplit(f, { branches: [branches[0], { ...branches[1], label: 'Tableau A' }] });
    expect(formulaV2Issues(same, scope)).toContain('scission : libellés des branches distincts');
    const blank = withSplit(f, { branches: [branches[0], { ...branches[1], label: ' ' }] });
    expect(formulaV2Issues(blank, scope)).toContain('scission : chaque branche a un libellé');
  });

  it('rang : « take » sur toutes les branches sauf la dernière, qui prend le reste', () => {
    const noTake = withSplit(f, { branches: [{ ...branches[0], take: undefined }, branches[1]] });
    expect(formulaV2Issues(noTake, scope)).toContain(
      'branche « Tableau A » : nombre ou pourcentage de tireurs requis (« take »)'
    );
    const lastTake = withSplit(f, {
      branches: [branches[0], { ...branches[1], take: { mode: 'fixed_count', count: 8 } }],
    });
    expect(formulaV2Issues(lastTake, scope)).toContain(
      'branche « Tableau B » : la dernière branche prend le reste (sans « take »)'
    );
    const pct = withSplit(f, {
      branches: [{ ...branches[0], take: { mode: 'percentage', percentage: 50 } }, branches[1]],
    });
    expect(formulaV2Issues(pct, scope)).toEqual([]);
    const winners = withSplit(f, {
      branches: [{ ...branches[0], take: { mode: 'pool_winner' } }, branches[1]],
    });
    expect(formulaV2Issues(winners, scope)).toContain(
      'branche « Tableau A » : nombre ou pourcentage de tireurs requis (« take »)'
    );
  });

  it('sexe : un sexe par branche, distinct', () => {
    const ok = withSplit(f, {
      criterion: 'gender',
      branches: [
        { label: 'Dames', phases: branches[0].phases, gender: Gender.FEMALE },
        { label: 'Hommes', phases: branches[1].phases, gender: Gender.MALE },
      ],
    });
    expect(formulaV2Issues(ok, scope)).toEqual([]);
    const twice = withSplit(ok, {
      branches: splitOf(ok).branches.map(b => ({ ...b, gender: Gender.MALE })),
    });
    expect(formulaV2Issues(twice, scope)).toContain(
      'scission par sexe : un sexe n’appartient qu’à une branche'
    );
    const none = withSplit(ok, {
      branches: splitOf(ok).branches.map(b => ({ ...b, gender: undefined })),
    });
    expect(formulaV2Issues(none, scope)).toContain('scission par sexe : un sexe par branche');
  });

  it('catégorie : catégories non vides et disjointes', () => {
    const ok = withSplit(f, {
      criterion: 'category',
      branches: [
        { label: 'V1', phases: branches[0].phases, categories: [Category.V1] },
        { label: 'V3-V4', phases: branches[1].phases, categories: [Category.V3, Category.V4] },
      ],
    });
    expect(formulaV2Issues(ok, scope)).toEqual([]);
    const overlap = withSplit(ok, {
      branches: [
        splitOf(ok).branches[0],
        { ...splitOf(ok).branches[1], categories: [Category.V1] },
      ],
    });
    expect(formulaV2Issues(overlap, scope)).toContain(
      'scission par catégorie : une catégorie n’appartient qu’à une branche'
    );
    const empty = withSplit(ok, {
      branches: [splitOf(ok).branches[0], { ...splitOf(ok).branches[1], categories: [] }],
    });
    expect(formulaV2Issues(empty, scope)).toContain(
      'scission par catégorie : au moins une catégorie par branche'
    );
  });

  it('rester dans l’épreuve : refusé jusqu’à l’étape E3', () => {
    const stay = withSplit(f, {
      branches: [{ ...branches[0], stayInCompetition: true }, branches[1]],
    });
    expect(formulaV2Issues(stay, scope)).toContain(
      "branche « Tableau A » : rester dans l'épreuve, à partir de l'étape E3"
    );
  });

  it('bornes des phases d’une branche jugées comme celles de l’épreuve', () => {
    const bad = withSplit(f, {
      branches: [
        branches[0],
        { ...branches[1], phases: [{ ...branches[1].phases[0], maxScore: 999 } as never] },
      ],
    });
    expect(
      formulaV2Issues(bad, scope).some(m => m.startsWith('branche « Tableau B » : tableau'))
    ).toBe(true);
  });
});

describe('opérations sur la scission (ADR-0039)', () => {
  it('setPhase règle le critère et les branches ; forme contrôlée', () => {
    const f = afterPools();
    const branches = [
      { label: 'Dames', phases: branchPhases('pools_tableau', ctx, id), gender: Gender.FEMALE },
      { label: 'Hommes', phases: branchPhases('tableau', ctx, id), gender: Gender.MALE },
    ];
    const g = applyOperationsV2(
      withFormula(f),
      [{ op: 'setPhase', phase: 'split', settings: { criterion: 'gender', branches } }],
      id
    );
    expect(splitOf(g)).toMatchObject({ criterion: 'gender', branches });
    expect(formulaV2Issues(g, scope)).toEqual([]);
    const bad = (settings: Record<string, unknown>) => () =>
      applyOperationsV2(withFormula(f), [{ op: 'setPhase', phase: 'split', settings }], id);
    expect(bad({ criterion: 'age' })).toThrow(/criterion/);
    expect(bad({ branches: [{ label: 'A', phases: [], color: 'red' }] })).toThrow(/color/);
    expect(bad({ branches: [{ label: 'A', phases: [], gender: 'Z' }] })).toThrow(/gender/);
    expect(bad({ branches: [{ label: 'A', phases: [], categories: ['V9'] }] })).toThrow(
      /categories/
    );
    expect(bad({ branches: [{ label: 'A', phases: [{ kind: 'x' }] }] })).toThrow(/phases/);
  });

  it('removePhase split', () => {
    const g = applyOperationsV2(
      withFormula(afterPools()),
      [{ op: 'removePhase', phase: 'split' }],
      id
    );
    expect(g.phases.map(p => p.kind)).toEqual(['pool']);
  });

  it('modèle de branche : phases par défaut de l’arme', () => {
    expect(branchPhases('tableau', ctx, id).map(p => p.kind)).toEqual(['tableau']);
    expect(branchPhases('pools', ctx, id).map(p => p.kind)).toEqual(['pool']);
    const both = branchPhases('pools_tableau', ctx, id);
    expect(both.map(p => p.kind)).toEqual(['pool', 'tableau']);
    expect(both[0]).toMatchObject({ qualification: { mode: 'all' } });
    expect(new Set(both.map(p => p.id)).size).toBe(2);
  });

  const roundTrip = (from: FormulaV2, to: FormulaV2) => {
    const ops = operationsBetweenV2(from, to);
    const got = applyOperationsV2(withFormula(from), ops, id);
    const shape = (f: FormulaV2) =>
      f.phases.map(p =>
        p.kind === 'split'
          ? { kind: p.kind, criterion: p.criterion, branches: p.branches }
          : p.kind === 'tableau'
            ? { kind: p.kind, stopAt: p.stopAt }
            : { kind: p.kind }
      );
    expect(shape(got)).toEqual(shape(to));
    return ops;
  };

  it('aller-retour : ajout et retrait d’une scission après les poules', () => {
    const base = applyOperationsV2(ctx, [{ op: 'removePhase', phase: 'tableau' }], id);
    const f = afterPools();
    const there = roundTrip(base, f);
    expect(there[0]).toEqual({ op: 'insertPhase', brick: 'split', at: 1 });
    expect(roundTrip(f, base)).toEqual([{ op: 'removePhase', phase: 'split' }]);
  });

  it('aller-retour : tableau complet ↔ tableau arrêté suivi d’une scission', () => {
    const base = formulaOf(ctx);
    const f = afterStopped();
    expect(roundTrip(base, f).slice(0, 2)).toEqual([
      { op: 'setPhase', phase: 'tableau', settings: { stopAt: 8 } },
      { op: 'insertPhase', brick: 'split', at: 2 },
    ]);
    roundTrip(f, base);
  });

  it('aller-retour : tour d’après ↔ scission après le tableau arrêté', () => {
    const pool = applyOperationsV2(
      ctx,
      [
        { op: 'setPhase', phase: 'tableau', settings: { stopAt: 8 } },
        { op: 'insertPhase', brick: 'pool', at: 2 },
      ],
      id
    );
    const split = afterStopped();
    roundTrip(pool, split);
    roundTrip(split, pool);
  });

  it('modification de la scission gardée : setPhase seul ; tableau ajouté avant elle', () => {
    const f = afterPools();
    const g = withSplit(f, { criterion: 'manual' });
    expect(operationsBetweenV2(f, g)).toEqual([
      { op: 'setPhase', phase: 'split', settings: { criterion: 'manual' } },
    ]);
    // Tableau arrêté inséré avant la scission : retirée puis remise en dernier
    const h = afterStopped();
    const ops = roundTrip(f, h);
    expect(ops[0]).toEqual({ op: 'removePhase', phase: 'split' });
  });
});

describe('déroulé et lecteurs (ADR-0039)', () => {
  it('formulaSteps : étape scission avant les résultats', () => {
    expect(formulaSteps(afterPools()).map(s => s.kind)).toEqual([
      'checkin',
      'pools',
      'split',
      'results',
    ]);
    expect(formulaSteps(afterStopped())).toEqual([
      { kind: 'checkin' },
      { kind: 'pools', rounds: 1 },
      { kind: 'tableau', stopAt: 8 },
      { kind: 'split' },
      { kind: 'results' },
    ]);
  });

  it('formulaSegment : tableau arrêté puis scission ; après clôture, pas de tableau', () => {
    const f = afterStopped();
    expect(formulaSegment(f, 0)).toEqual({ poolRounds: 1, hasDirectElimination: true, stopAt: 8 });
    expect(formulaSegment(f, 1)).toEqual({ poolRounds: 1, hasDirectElimination: false });
  });

  it('réglages plats, résumé et simulation ignorent la scission', () => {
    const f = afterPools();
    expect(flatSettingsOf(f, Weapon.EPEE)).toMatchObject({
      poolRounds: 1,
      hasDirectElimination: false,
    });
    expect(summarizeFormulaV2(f).map(p => p.kind)).toEqual(['pools']);
    expect(simulationFormulaOf(f).phases.map(p => p.type)).toEqual(['pool_round']);
    expect(customFormulaOf(afterStopped()).phases.map(p => p.type)).toEqual([
      'pool_round',
      'direct_elimination',
    ]);
    expect(flatSettingsOf(afterStopped(), Weapon.CUSTOM)).toHaveProperty('customFormula');
  });
});

describe('édition de la scission à l’écran (ADR-0039, étape E2b)', () => {
  const split = () => splitOf(afterPools());

  it('modèle de branche lu depuis ses phases', () => {
    expect(branchPresetOf(branchPhases('tableau', ctx, id))).toBe('tableau');
    expect(branchPresetOf(branchPhases('pools_tableau', ctx, id))).toBe('pools_tableau');
    expect(branchPresetOf(branchPhases('pools', ctx, id))).toBe('pools');
    const [pool, tableau] = branchPhases('pools_tableau', ctx, id);
    expect(branchPresetOf([tableau, pool])).toBeNull();
  });

  it('critère changé : champs de l’ancien critère retirés, ceux du nouveau posés', () => {
    const byGender = withSplitCriterion(split(), 'gender');
    expect(byGender.branches.map(b => [b.gender, b.take, b.categories])).toEqual([
      [Gender.MALE, undefined, undefined],
      [Gender.FEMALE, undefined, undefined],
    ]);
    expect(formulaV2Issues(withSplit(afterPools(), byGender), scope)).toEqual([]);
    const byCategory = withSplitCriterion(byGender, 'category');
    expect(byCategory.branches.map(b => [b.gender, b.categories])).toEqual([
      [undefined, []],
      [undefined, []],
    ]);
    const byRank = withSplitCriterion(byCategory, 'rank');
    expect(byRank.branches.map(b => b.take)).toEqual([
      { mode: 'fixed_count', count: 16 },
      undefined,
    ]);
    expect(formulaV2Issues(withSplit(afterPools(), byRank), scope)).toEqual([]);
  });

  it('branche ajoutée : « le reste » par rang, l’ancienne dernière reçoit une part', () => {
    const three = addSplitBranch(split(), ctx, id);
    expect(three.branches.map(b => b.label)).toEqual(['Tableau A', 'Tableau B', 'Tableau C']);
    expect(three.branches.map(b => b.take?.mode)).toEqual([
      'fixed_count',
      'fixed_count',
      undefined,
    ]);
    expect(formulaV2Issues(withSplit(afterPools(), three), scope)).toEqual([]);
  });

  it('branche retirée : deux au moins, la nouvelle dernière prend le reste', () => {
    const three = addSplitBranch(split(), ctx, id);
    const two = removeSplitBranch(three, 2);
    expect(two.branches.map(b => [b.label, b.take?.mode])).toEqual([
      ['Tableau A', 'fixed_count'],
      ['Tableau B', undefined],
    ]);
    expect(removeSplitBranch(two, 0)).toBe(two);
  });
});
