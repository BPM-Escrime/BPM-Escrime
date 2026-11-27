import { describe, expect, it } from 'vitest';
import { Category, CompetitionSettings, Weapon } from '../../types';
import { buildDefaultCompetitionSettings } from '../../utils/defaultCompetitionSettings';
import { createDefaultCustomFormula } from '../../utils/tournamentTemplates';
import { flatSettingsOf, formulaOf, phaseSettings, rankingFiltersOf } from './formulaV2';
import { formulaNeedsExpert } from './formulaExpert';
import {
  applyOperationsV2,
  canRemoveV2,
  formulaV2Issues as formulaRemarks,
  formulaViewV2,
  friezeOfV2,
  insertOptionsV2,
  operationsBetweenV2,
  removeV2,
} from './formulaV2Operations';

/** Messages des remarques (les codes et les phases ont leurs propres tests) */
const formulaV2Issues = (...args: Parameters<typeof formulaRemarks>) =>
  formulaRemarks(...args).map(r => r.message);

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

describe('tableau arrêté à N (ADR-0037, D2)', () => {
  const stopped = () =>
    applyOperationsV2(
      epee(),
      [
        { op: 'setPhase', phase: 'tableau', settings: { stopAt: 8 } },
        { op: 'insertPhase', brick: 'pool', at: 2 },
      ],
      id
    );

  it('« ＋ » après le tableau seulement s’il est arrêté', () => {
    expect(insertOptionsV2(formulaOf(epee()), Weapon.EPEE, 2)).toEqual([]);
    const f = applyOperationsV2(
      epee(),
      [{ op: 'setPhase', phase: 'tableau', settings: { stopAt: 8 } }],
      id
    );
    // Tour de poules ou scission après un tableau arrêté (ADR-0037 amendée, ADR-0039)
    expect(insertOptionsV2(f, Weapon.EPEE, 2)).toEqual(['pool', 'split']);
    expect(formulaV2Issues(f, { weapon: Weapon.EPEE })).toEqual([
      'tableau arrêté à 8 : ajouter un tour de poules ou une scission après le tableau',
    ]);
  });

  it('tours d’après : formule valide, tours numérotés à la suite', () => {
    const f = stopped();
    expect(friezeOfV2(f).map(p => p.key)).toEqual(['pool-0', 'tableau', 'pool-1']);
    expect(formulaV2Issues(f, { weapon: Weapon.EPEE })).toEqual([]);
  });

  it('arrêt refusé hors puissances de 2 ; 0 : jusqu’à la finale', () => {
    expect(() =>
      applyOperationsV2(epee(), [{ op: 'setPhase', phase: 'tableau', settings: { stopAt: 6 } }], id)
    ).toThrow(/stopAt/);
    const f = applyOperationsV2(
      epee(),
      [{ op: 'setPhase', phase: 'tableau', settings: { stopAt: 0 } }],
      id
    );
    expect(f.phases.find(p => p.kind === 'tableau')).not.toHaveProperty('stopAt');
  });

  it('bornes de l’arrêt : 2 et 128 acceptés', () => {
    for (const stopAt of [2, 128]) {
      const f = applyOperationsV2(
        epee(),
        [{ op: 'setPhase', phase: 'tableau', settings: { stopAt } }],
        id
      );
      expect(f.phases.find(p => p.kind === 'tableau')).toMatchObject({ stopAt });
    }
  });

  it('pas de Tour Quest avec un tableau arrêté', () => {
    const laser = { weapon: Weapon.LASER, category: Category.SENIOR };
    const withQuest = applyOperationsV2(laser, [{ op: 'insertPhase', brick: 'quest', at: 1 }], id);
    const at = withQuest.phases.findIndex(p => p.kind === 'tableau');
    const stoppedQuest = {
      ...withQuest,
      phases: withQuest.phases.map((p, i) => (i === at ? { ...p, stopAt: 4 } : p)),
    } as typeof withQuest;
    expect(insertOptionsV2(stoppedQuest, Weapon.LASER, at + 1)).not.toContain('pool');
    expect(formulaV2Issues(stoppedQuest, { weapon: Weapon.LASER })).toContain(
      'tableau arrêté : sans Tour Quest'
    );
    // Arrêt posé : le « ＋ » ne propose plus le Tour Quest
    const stopped = applyOperationsV2(
      epee(),
      [{ op: 'setPhase', phase: 'tableau', settings: { stopAt: 8 } }],
      id
    );
    expect(insertOptionsV2(stopped, Weapon.LASER, 1)).not.toContain('quest');
  });

  it('dernier tour d’après retiré : le tableau va de nouveau jusqu’à la finale', () => {
    const f = removeV2(stopped(), { kind: 'pool', round: 1, key: 'pool-1' });
    expect(f.phases.find(p => p.kind === 'tableau')).not.toHaveProperty('stopAt');
    expect(canRemoveV2(stopped(), { kind: 'pool', round: 0, key: 'pool-0' })).toBe(false);
  });

  it('opérations entre deux formules : aller et retour', () => {
    const base = formulaOf(epee());
    const f = stopped();
    const there = operationsBetweenV2(base, f);
    expect(there).toEqual([
      { op: 'setPhase', phase: 'tableau', settings: { stopAt: 8 } },
      { op: 'insertPhase', brick: 'pool', at: 2 },
    ]);
    const settings = { ...epee().settings, formula: f };
    const back = operationsBetweenV2(f, base);
    const again = applyOperationsV2({ ...epee(), settings }, back, id);
    expect(again.phases.map(p => p.kind)).toEqual(['pool', 'tableau']);
    expect(again.phases[1]).not.toHaveProperty('stopAt');
  });

  it('entrée en équipes et répartition par niveau : aller et retour (docs/adr/0043)', () => {
    const base = formulaOf(epee());
    const levels = ['Expert', 'Débutant'];
    const f = applyOperationsV2(
      epee(),
      [
        { op: 'setGeneral', settings: { entry: { kind: 'team', size: 2, levels } } },
        { op: 'setPhase', phase: 'pool-0', settings: { distribution: 'byLevel' } },
      ],
      id
    );
    expect(f.general.entry).toEqual({ kind: 'team', size: 2, levels });
    expect(phaseSettings(f, { kind: 'pool', round: 0 }).distribution).toBe('byLevel');
    const there = operationsBetweenV2(base, f);
    expect(there).toEqual([
      { op: 'setPhase', phase: 'pool-0', settings: { distribution: 'byLevel' } },
      { op: 'setGeneral', settings: { entry: { kind: 'team', size: 2, levels } } },
    ]);
    // Retour : les réglages sont retirés (défauts : serpentin, entrée individuelle)
    const back = operationsBetweenV2(f, base);
    const again = applyOperationsV2(
      { ...epee(), settings: { ...epee().settings, formula: f } },
      back,
      id
    );
    expect(again.general).not.toHaveProperty('entry');
    expect(phaseSettings(again, { kind: 'pool', round: 0 })).not.toHaveProperty('distribution');
  });

  it('entrée ou répartition invalide : remarque bloquante sur la formule', () => {
    const f = formulaOf(epee());
    const bad = {
      ...f,
      general: { ...f.general, entry: { kind: 'team', size: 2, levels: ['A', 'A'] } as never },
    };
    expect(formulaV2Issues(bad, { weapon: Weapon.EPEE })).toEqual([
      'entrée : équipe : libellés de niveau distincts',
    ]);
    const bad2 = {
      ...f,
      phases: f.phases.map(p => (p.kind === 'pool' ? { ...p, distribution: 'x' as never } : p)),
    };
    expect(formulaV2Issues(bad2, { weapon: Weapon.EPEE })).toEqual([
      'tour 1 : répartition inconnue',
    ]);
  });

  it('filtres du classement final : aller et retour, ordre canonique, vide = retiré (docs/adr/0043, F4d)', () => {
    const base = formulaOf(epee());
    const f = applyOperationsV2(
      epee(),
      [{ op: 'setGeneral', settings: { rankingFilters: ['handicap', 'category'] } }],
      id
    );
    expect(f.general.rankingFilters).toEqual(['category', 'handicap']);
    expect(formulaNeedsExpert(f)).toBe(true);
    expect(formulaNeedsExpert(base)).toBe(false);
    const there = operationsBetweenV2(base, f);
    expect(there).toEqual([
      { op: 'setGeneral', settings: { rankingFilters: ['category', 'handicap'] } },
    ]);
    // Retour : réglage retiré (null), liste vide aussi
    const back = operationsBetweenV2(f, base);
    expect(back).toEqual([{ op: 'setGeneral', settings: { rankingFilters: null } }]);
    const withFilters = { ...epee(), settings: { ...epee().settings, formula: f } };
    for (const empty of [null, []]) {
      const again = applyOperationsV2(
        withFilters,
        [{ op: 'setGeneral', settings: { rankingFilters: empty } }],
        id
      );
      expect('rankingFilters' in again.general).toBe(false);
    }
    expect(rankingFiltersOf(f)).toEqual(['category', 'handicap']);
    expect(rankingFiltersOf(base)).toEqual([]);
  });

  it('filtres du classement final invalides : refus de l’opération et remarque bloquante', () => {
    expect(() =>
      applyOperationsV2(epee(), [{ op: 'setGeneral', settings: { rankingFilters: ['club'] } }], id)
    ).toThrow(/rankingFilters/);
    expect(() =>
      applyOperationsV2(
        epee(),
        [{ op: 'setGeneral', settings: { rankingFilters: ['level', 'level'] } }],
        id
      )
    ).toThrow(/distincts/);
    const f = formulaOf(epee());
    const bad = { ...f, general: { ...f.general, rankingFilters: ['x'] as never } };
    expect(formulaV2Issues(bad, { weapon: Weapon.EPEE })).toEqual([
      'filtres du classement : critère inconnu (category | gender | level | handicap)',
    ]);
  });

  it('réglages plats : vainqueurs de poule lus au tour qui précède le tableau', () => {
    const f = applyOperationsV2(
      epee(),
      [
        { op: 'setPhase', phase: 'tableau', settings: { stopAt: 8 } },
        { op: 'insertPhase', brick: 'pool', at: 2 },
        { op: 'setPhase', phase: 'pool-0', settings: { poolWinnersOnly: true } },
      ],
      id
    );
    expect(flatSettingsOf(f, Weapon.EPEE).poolWinnersOnly).toBe(true);
  });
});
