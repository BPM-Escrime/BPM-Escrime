/**
 * Scission par sexe restée dans l'épreuve (docs/adr/0039, amendée le 2026-11-26, étape E3) :
 * grammaire de `stayInCompetition` (critère sexe, branches réduites à un tableau, toutes ou aucune :
 * pas de mélange d'une branche restée et d'une fille, amendement du 2026-11-26), reprise de la
 * compétition couplée (`postPoolSplitCriteria = 'gender'`) dans la formule, aller-retour avec
 * les réglages plats et non-régression des tableaux séparés (ADR-0024).
 */
import { describe, expect, it } from 'vitest';
import { Category, CompetitionSettings, Gender, Weapon } from '../../types';
import { buildDefaultCompetitionSettings } from '../../utils/defaultCompetitionSettings';
import { draftFromSettings, draftToSettings } from './formulaDraft';
import {
  coupledFormula,
  flatSettingsOf,
  formulaOf,
  isCoupledSplit,
  pendingSplitOf,
  phaseSettings,
  splitOf,
  tableauQualificationOf,
  uncoupledFormula,
  type FormulaV2,
  type SplitPhase,
  type TableauPhase,
} from './formulaV2';
import {
  applyOperationsV2,
  formulaV2Issues as formulaRemarks,
  friezeOfV2,
  operationsBetweenV2,
  summarizeFormulaV2,
  withSplitCriterion,
} from './formulaV2Operations';
import { formulaSteps } from './formulaSteps';

/** Messages des remarques (les codes et les phases ont leurs propres tests) */
const formulaV2Issues = (...args: Parameters<typeof formulaRemarks>) =>
  formulaRemarks(...args).map(r => r.message);

let n = 0;
const id = () => `id-${++n}`;
const scope = { weapon: Weapon.EPEE };
const base = (weapon = Weapon.EPEE, category = Category.U15) =>
  buildDefaultCompetitionSettings({ weapon, category }) as CompetitionSettings;
const coupledSettings = (extra: Partial<CompetitionSettings> = {}) => ({
  ...base(),
  postPoolSplitCriteria: 'gender' as const,
  ...extra,
});
const src = (settings: Partial<CompetitionSettings>, weapon = Weapon.EPEE) => ({
  weapon,
  category: Category.U15,
  settings,
});
const split = (f: FormulaV2) => splitOf(f)!;
const withBranches = (f: FormulaV2, branches: SplitPhase['branches']): FormulaV2 => ({
  ...f,
  phases: f.phases.map(p => (p.kind === 'split' ? { ...p, branches } : p)),
});

describe('rester dans l’épreuve : grammaire (ADR-0039, E3)', () => {
  const f = formulaOf(src(coupledSettings()));

  it('scission par sexe, branches réduites à un tableau : acceptée', () => {
    expect(split(f).criterion).toBe('gender');
    expect(split(f).branches.every(b => b.stayInCompetition)).toBe(true);
    expect(formulaV2Issues(f, scope)).toEqual([]);
  });

  it('branche avec des poules : refusée', () => {
    const [h, d] = split(f).branches;
    const pools = withBranches(f, [
      h,
      { ...d, phases: [f.phases[0], ...d.phases] as SplitPhase['branches'][0]['phases'] },
    ]);
    expect(formulaV2Issues(pools, scope)).toContain(
      'branche « Dames » : rester dans l’épreuve, seulement une branche réduite à un tableau'
    );
  });

  it('toutes restées : deux branches, Hommes et Dames, seulement', () => {
    const [h, d] = split(f).branches;
    const three = withBranches(f, [h, d, { ...d, label: 'Mixte', gender: Gender.MIXED }]);
    expect(formulaV2Issues(three, scope)).toContain(
      'rester dans l’épreuve : deux branches, Hommes et Dames'
    );
    const mixte = withBranches(f, [h, { ...d, gender: Gender.MIXED }]);
    expect(formulaV2Issues(mixte, scope)).toContain(
      'rester dans l’épreuve : deux branches, Hommes et Dames'
    );
  });

  it('critère autre que le sexe : refusé', () => {
    const rank: FormulaV2 = {
      ...f,
      phases: f.phases.map(p =>
        p.kind === 'split'
          ? {
              ...p,
              criterion: 'rank',
              branches: [
                { ...p.branches[0], gender: undefined, take: { mode: 'fixed_count', count: 8 } },
                { ...p.branches[1], gender: undefined },
              ],
            }
          : p
      ),
    };
    expect(formulaV2Issues(rank, scope)).toContain(
      'branche « Hommes » : rester dans l’épreuve, seulement pour une scission par sexe'
    );
  });

  it('après un tableau arrêté : refusée (tableaux séparés après les poules)', () => {
    const t = (split(f).branches[0].phases[0] as TableauPhase) ?? null;
    const stopped: FormulaV2 = {
      ...f,
      phases: [f.phases[0], { ...t, id: 'stage', stopAt: 8 }, split(f)],
    };
    expect(formulaV2Issues(stopped, scope)).toContain(
      'scission : rester dans l’épreuve seulement après un tour de poules'
    );
  });

  it('branches restées : un seul jeu de réglages du tableau', () => {
    const [h, d] = split(f).branches;
    const t = d.phases[0] as TableauPhase;
    const diff = withBranches(f, [h, { ...d, phases: [{ ...t, maxScore: 10 }] }]);
    expect(formulaV2Issues(diff, scope)).toContain(
      'rester dans l’épreuve : mêmes réglages de tableau pour les branches restées'
    );
  });

  it('critère changé : « rester dans l’épreuve » retiré hors du sexe', () => {
    const rank = withSplitCriterion(split(f), 'rank');
    expect(rank.branches.some(b => b.stayInCompetition)).toBe(false);
    const gender = withSplitCriterion(split(f), 'gender');
    expect(gender.branches.every(b => b.stayInCompetition)).toBe(true);
  });
});

describe('reprise de la compétition couplée (ADR-0039, E3)', () => {
  it('postPoolSplitCriteria = gender, sans formule enregistrée : scission Hommes / Dames restée', () => {
    const f = formulaOf(src(coupledSettings({ defaultTableMaxScore: 10, thirdPlaceMatch: true })));
    expect(f.general.postPoolSplitCriteria).toBeUndefined();
    expect(friezeOfV2(f).map(p => p.key)).toEqual(['pool-0', 'split']);
    expect(split(f).branches.map(b => [b.label, b.gender, b.phases.map(p => p.kind)])).toEqual([
      ['Hommes', Gender.MALE, ['tableau']],
      ['Dames', Gender.FEMALE, ['tableau']],
    ]);
    expect(isCoupledSplit(split(f))).toBe(true);
    expect(pendingSplitOf(f)).toBeUndefined();
    expect(phaseSettings(f, { kind: 'tableau' })).toMatchObject({
      maxScore: 10,
      thirdPlace: true,
    });
    expect(summarizeFormulaV2(f).map(p => p.kind)).toEqual(['pools', 'tableau']);
    // Déroulé : les branches restées jouent un tableau dans l'épreuve (ADR-0037, onglets)
    expect(formulaSteps(f).map(s => s.kind)).toEqual(['checkin', 'pools', 'tableau', 'results']);
  });

  it('flatSettingsOf : mêmes réglages plats qu’aujourd’hui, tableaux séparés gardés', () => {
    for (const weapon of [Weapon.EPEE, Weapon.FOIL, Weapon.SABRE, Weapon.LASER])
      for (const extra of [
        {},
        { poolRounds: 3, poolRoundQualifiers: [0, 16] },
        { poolWinnersOnly: true, playAllPositions: true, thirdPlaceMatch: true },
        { defaultTableMaxScore: 10, restTimeSeconds: 30 },
      ] as Partial<CompetitionSettings>[]) {
        const settings = { ...base(weapon), postPoolSplitCriteria: 'gender' as const, ...extra };
        const flat = flatSettingsOf(formulaOf(src(settings, weapon)), weapon);
        const today = draftToSettings(
          draftFromSettings(weapon, Category.U15, settings),
          weapon,
          settings.questConfig
        );
        for (const k of Object.keys(today) as Array<keyof CompetitionSettings>)
          expect(flat[k], `${weapon} ${JSON.stringify(extra)} · ${k}`).toEqual(today[k]);
        expect(flat.postPoolSplitCriteria).toBe('gender');
        expect(flat.hasDirectElimination).toBe(true);
      }
  });

  it('aller-retour : réglages plats → formule → réglages plats → formule', () => {
    const f = formulaOf(src(coupledSettings({ poolRounds: 2, poolRoundQualifiers: [20] })));
    const flat = flatSettingsOf(f, Weapon.EPEE);
    const again = formulaOf(src({ ...coupledSettings(), ...flat }));
    expect(again).toEqual(f);
    expect(tableauQualificationOf(f)).toBeUndefined();
  });

  it('qualification du tour qui précède la scission restée : celle du tableau', () => {
    const f = formulaOf(src(coupledSettings({ poolWinnersOnly: true })));
    expect(tableauQualificationOf(f)).toEqual({ mode: 'pool_winner' });
  });

  it('formule enregistrée avant E3 (ancienne forme) : relue comme la scission', () => {
    const flat = formulaOf(src(base()));
    const legacy: FormulaV2 = {
      ...flat,
      general: { ...flat.general, postPoolSplitCriteria: 'gender' },
    };
    const read = formulaOf(src({ ...base(), formula: legacy }));
    expect(isCoupledSplit(splitOf(read))).toBe(true);
    expect(flatSettingsOf(read, Weapon.EPEE).postPoolSplitCriteria).toBe('gender');
  });

  it('sans place pour la scission (Tour Quest, pas de tableau) : ancienne forme gardée', () => {
    const quest: FormulaV2 = {
      version: 2,
      phases: [
        {
          kind: 'quest',
          id: 'q',
          config: { enabled: true, hasPreliminaryPools: false, opponentConstraint: 'none' },
        },
        {
          kind: 'tableau',
          id: 't',
          maxScore: 15,
          timerSeconds: 180,
          thirdPlace: false,
          allPlaces: false,
        },
      ],
      general: { postPoolSplitCriteria: 'gender' },
    };
    expect(coupledFormula(quest)).toBe(quest);
    expect(flatSettingsOf(quest, Weapon.LASER).postPoolSplitCriteria).toBe('gender');
  });

  it('sans place pour la scission (pas de tour de poules juste avant le tableau) : ancienne forme gardée', () => {
    const tableauFirst: FormulaV2 = {
      version: 2,
      phases: [
        {
          kind: 'tableau',
          id: 't',
          maxScore: 15,
          timerSeconds: 180,
          thirdPlace: false,
          allPlaces: false,
        },
      ],
      general: { postPoolSplitCriteria: 'gender' },
    };
    expect(coupledFormula(tableauFirst)).toBe(tableauFirst);
    expect(flatSettingsOf(tableauFirst, Weapon.EPEE).postPoolSplitCriteria).toBe('gender');
  });

  it('scission sans branche restée : pas de tableaux séparés', () => {
    const f = formulaOf(src(coupledSettings()));
    const daughters = withBranches(
      f,
      split(f).branches.map(b => ({ ...b, stayInCompetition: undefined }))
    );
    expect(flatSettingsOf(daughters, Weapon.EPEE).postPoolSplitCriteria).toBeUndefined();
    expect(flatSettingsOf(daughters, Weapon.EPEE).hasDirectElimination).toBe(false);
    expect(pendingSplitOf(daughters)).toBeDefined();
  });

  it('une branche reste, l’autre part : refusée, pas de tableaux séparés écrits', () => {
    const f = formulaOf(src(coupledSettings()));
    const [h, d] = split(f).branches;
    for (const mixed of [
      withBranches(f, [h, { ...d, stayInCompetition: false }]),
      withBranches(f, [{ ...h, stayInCompetition: undefined }, d]),
    ]) {
      expect(formulaV2Issues(mixed, scope)).toContain(
        'rester dans l’épreuve : toutes les branches ou aucune (dès qu’une branche part en compétition fille, toutes partent)'
      );
      expect(isCoupledSplit(split(mixed))).toBe(false);
      expect(flatSettingsOf(mixed, Weapon.EPEE).postPoolSplitCriteria).toBeUndefined();
      // Relue sans `postPoolSplitCriteria` : la scission reste celle de la formule
      const again = formulaOf(
        src({ ...base(), ...flatSettingsOf(mixed, Weapon.EPEE), formula: mixed })
      );
      expect(isCoupledSplit(splitOf(again))).toBe(false);
    }
  });

  it('aller-retour de la compétition couplée : postPoolSplitCriteria écrit puis relu', () => {
    const f = formulaOf(src(coupledSettings()));
    const flat = flatSettingsOf(f, Weapon.EPEE);
    expect(flat.postPoolSplitCriteria).toBe('gender');
    // Sans formule enregistrée : relue depuis le seul réglage plat
    const { formula: _f, ...noFormula } = { ...base(), ...flat } as CompetitionSettings;
    expect(isCoupledSplit(splitOf(formulaOf(src(noFormula))))).toBe(true);
  });
});

describe('opérations sur la compétition couplée (contrat, ADR-0039 E3)', () => {
  const plain = { ...src(base()) };

  it('setGeneral postPoolSplitCriteria : scission restée posée, puis retirée', () => {
    const on = applyOperationsV2(
      plain,
      [{ op: 'setGeneral', settings: { postPoolSplitCriteria: 'gender' } }],
      id
    );
    expect(isCoupledSplit(splitOf(on))).toBe(true);
    expect(on.general.postPoolSplitCriteria).toBeUndefined();
    const off = applyOperationsV2(
      { ...plain, settings: { ...base(), formula: on } },
      [{ op: 'setGeneral', settings: { postPoolSplitCriteria: null as never } }],
      id
    );
    expect(splitOf(off)).toBeUndefined();
    expect(friezeOfV2(off).map(p => p.key)).toEqual(['pool-0', 'tableau']);
    expect(uncoupledFormula(on)).toEqual(off);
  });

  it('setPhase tableau : réglé pour chaque branche restée', () => {
    const f = applyOperationsV2(
      src(coupledSettings()),
      [{ op: 'setPhase', phase: 'tableau', settings: { maxScore: 10 } }],
      id
    );
    expect(split(f).branches.map(b => (b.phases[0] as TableauPhase).maxScore)).toEqual([10, 10]);
    expect(formulaV2Issues(f, scope)).toEqual([]);
  });

  it('opérations entre deux formules : couplée ↔ tableau unique', () => {
    const coupled = formulaOf(src(coupledSettings()));
    const single = uncoupledFormula(coupled);
    const ctxCoupled = { ...src(base()), settings: { ...base(), formula: coupled } };
    const ctxSingle = { ...src(base()), settings: { ...base(), formula: single } };
    const toSingle = applyOperationsV2(ctxCoupled, operationsBetweenV2(coupled, single), id);
    expect(flatSettingsOf(toSingle, Weapon.EPEE).postPoolSplitCriteria).toBeUndefined();
    expect(flatSettingsOf(toSingle, Weapon.EPEE).hasDirectElimination).toBe(true);
    const toCoupled = applyOperationsV2(ctxSingle, operationsBetweenV2(single, coupled), id);
    expect(isCoupledSplit(splitOf(toCoupled))).toBe(true);
    expect(flatSettingsOf(toCoupled, Weapon.EPEE).postPoolSplitCriteria).toBe('gender');
  });
});
