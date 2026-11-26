/**
 * Contrôles de structure S1 à S6, remarques situées, mode expert (docs/adr/0041, #2013 F2)
 */
import { describe, expect, it } from 'vitest';
import { Category, CompetitionSettings, Weapon } from '../../types';
import { buildDefaultCompetitionSettings } from '../../utils/defaultCompetitionSettings';
import { simulateFormula } from '../../utils/customRankingCalculator';
import {
  formulaOf,
  type FormulaPhaseV2,
  type FormulaV2,
  type PoolRoundPhase,
  type SplitPhase,
  type TableauPhase,
} from './formulaV2';
import {
  applyOperationsV2,
  formulaV2Issues,
  simulationFormulaOf,
  type FormulaScope,
  splitIssues,
} from './formulaV2Operations';
import { bricksForLevel, formulaNeedsExpert } from './formulaExpert';
import { formulaProgress, remarksMessage } from './formulaRemarks';

let n = 0;
const id = () => `id-${++n}`;
const settings = buildDefaultCompetitionSettings({
  weapon: Weapon.EPEE,
  category: Category.SENIOR,
}) as CompetitionSettings;
const ctx = { weapon: Weapon.EPEE, category: Category.SENIOR, settings };
const scope: FormulaScope = { weapon: Weapon.EPEE };
const base = (): FormulaV2 => formulaOf(ctx);

const pool = (over: Partial<PoolRoundPhase> = {}): PoolRoundPhase => ({
  ...(base().phases.find((p): p is PoolRoundPhase => p.kind === 'pool') as PoolRoundPhase),
  id: id(),
  ...over,
});
const tableau = (over: Partial<TableauPhase> = {}): TableauPhase => ({
  ...(base().phases.find((p): p is TableauPhase => p.kind === 'tableau') as TableauPhase),
  id: id(),
  ...over,
});
const formula = (...phases: FormulaPhaseV2[]): FormulaV2 => ({
  version: 2,
  phases,
  general: {},
});
const codes = (f: FormulaV2, s = scope) => formulaV2Issues(f, s).map(r => r.code);
const rank = (take: number, ...phases: FormulaPhaseV2[]): SplitPhase => ({
  kind: 'split',
  id: id(),
  criterion: 'rank',
  branches: [
    {
      label: 'A',
      phases: phases.length ? phases : [tableau()],
      take: { mode: 'fixed_count', count: take },
    },
    { label: 'B', phases: [tableau()] },
  ],
});

describe('remarques situées (ADR-0041)', () => {
  it('formule par défaut : aucune remarque', () => {
    expect(formulaV2Issues(base(), scope)).toEqual([]);
  });

  it('chaque remarque porte un code snake_case et la clé de sa phase', () => {
    const f = formula(pool({ maxScore: 999 }), pool(), tableau({ timerSeconds: 99999 }));
    const remarks = formulaV2Issues(f, scope);
    expect(remarks.length).toBeGreaterThan(0);
    for (const r of remarks) expect(r.code).toMatch(/^[a-z][a-z0-9_]*$/);
    expect(remarks.find(r => r.code === 'pool_settings')?.phase).toBe('pool-0');
    expect(remarks.find(r => r.code === 'tableau_settings')?.phase).toBe('tableau');
  });

  it('formule entière : phase null', () => {
    const f = formula(pool(), pool(), pool(), pool(), pool(), pool());
    expect(
      formulaV2Issues(f, scope).find(r => r.code === 'too_many_pool_rounds')?.phase
    ).toBeNull();
  });

  it('message du moteur : une remarque par ligne avec la clé de phase', () => {
    const text = remarksMessage([
      { code: 'a', phase: 'pool-1', message: 'tour 2 : x' },
      { code: 'b', phase: null, message: 'y' },
    ]);
    expect(text).toBe('Formule refusée :\n[pool-1] tour 2 : x\n[formule] y');
  });
});

describe('S1 : au moins une phase de combat', () => {
  it('formule sans phase, ou réduite à une scission', () => {
    expect(codes(formula())).toContain('no_fight_phase');
    expect(codes(formula(rank(8)))).toContain('no_fight_phase');
    expect(codes(formula(pool()))).not.toContain('no_fight_phase');
    expect(codes(formula(tableau()))).not.toContain('no_fight_phase');
  });

  it('chaque branche, sur la carte de la scission', () => {
    const s = rank(8);
    s.branches[1] = { ...s.branches[1], phases: [] };
    const r = formulaV2Issues(formula(pool(), s), scope).find(x => x.code === 'no_fight_phase');
    expect(r?.phase).toBe('split');
    expect(r?.message).toContain('branche « B » : au moins une phase de combat');
  });
});

describe('S3 : le nombre fixé suffit à la phase suivante', () => {
  const rule = (count: number, mode: 'fixed_count' | 'fixed_bracket' = 'fixed_count') => ({
    mode,
    count,
  });

  it('tour de poules suivi de poules : au moins sizeMin', () => {
    const f = formula(
      pool({ qualification: rule(3) }),
      pool({ sizeMin: 5, sizeMax: 7 }),
      tableau()
    );
    const r = formulaV2Issues(f, scope).find(x => x.code === 'qualified_below_pool_min');
    expect(r?.phase).toBe('pool-0');
    expect(r?.message).toContain('tour 1');
  });

  it('suivi d’un tableau : au moins 2', () => {
    const f = formula(pool({ qualification: rule(1) }), tableau());
    expect(codes(f)).toContain('qualified_below_tableau_min');
    expect(codes(formula(pool({ qualification: rule(2) }), tableau()))).toEqual([]);
  });

  it('suivi d’un tableau arrêté : plus de stopAt', () => {
    const stopped = tableau({ stopAt: 8 });
    const f = formula(pool({ qualification: rule(8) }), stopped, pool());
    expect(codes(f)).toContain('qualified_not_above_stop');
    const ok = formula(pool({ qualification: rule(16, 'fixed_bracket') }), stopped, pool());
    expect(codes(ok)).not.toContain('qualified_not_above_stop');
  });

  it('un pourcentage ne bloque pas (avertissement de la simulation)', () => {
    const f = formula(pool({ qualification: { mode: 'percentage', percentage: 5 } }), tableau());
    expect(codes(f)).toEqual([]);
  });

  it('part d’une branche par rang vers sa première phase', () => {
    const f = formula(pool(), rank(1));
    const r = formulaV2Issues(f, scope).find(x => x.code === 'qualified_below_tableau_min');
    expect(r?.phase).toBe('split');
    expect(r?.message).toContain('branche « A »');
    const toPools = formula(pool(), rank(3, pool({ sizeMin: 5, sizeMax: 7 })));
    expect(codes(toPools)).toContain('qualified_below_pool_min');
  });
});

describe('S4 : le nombre se répartit en poules de sizeMin à sizeMax', () => {
  it('8 qualifiés ne font pas des poules de 5 à 7 ; 10 et 16 oui', () => {
    const next = pool({ sizeMin: 5, sizeMax: 7 });
    const withN = (count: number) =>
      formula(pool({ qualification: { mode: 'fixed_count', count } }), next, tableau());
    expect(codes(withN(8))).toContain('qualified_not_poolable');
    expect(codes(withN(10))).not.toContain('qualified_not_poolable');
    expect(codes(withN(16))).not.toContain('qualified_not_poolable');
  });

  it('part d’une branche vers un tour de poules', () => {
    const f = formula(pool(), rank(8, pool({ sizeMin: 5, sizeMax: 7 })));
    expect(codes(f)).toContain('qualified_not_poolable');
  });

  it('somme des parts sous l’effectif connu', () => {
    const s = rank(20);
    const f = formula(pool(), s);
    expect(codes(f, { ...scope, fencerCount: 12 })).toContain('split_takes_exceed');
    expect(codes(f, { ...scope, fencerCount: 21 })).not.toContain('split_takes_exceed');
    // effectif inconnu : pas de blocage
    expect(codes(f)).not.toContain('split_takes_exceed');
  });

  it('splitIssues rend aussi des remarques situées sur la scission', () => {
    const r = splitIssues(rank(20), { ...scope, fencerCount: 10 });
    expect(r.every(x => x.phase === 'split')).toBe(true);
    expect(r.map(x => x.code)).toContain('split_takes_exceed');
  });
});

describe('S5 : chaque branche finit par une phase qui classe', () => {
  it('branche terminée par un tableau arrêté', () => {
    const s = rank(16);
    s.branches[0] = { ...s.branches[0], phases: [pool(), tableau({ stopAt: 4 })] };
    const r = formulaV2Issues(formula(pool(), s), scope).filter(
      x => x.code === 'ends_with_stopped_tableau'
    );
    expect(r).toHaveLength(1);
    expect(r[0].phase).toBe('split');
    expect(r[0].message).toContain('branche « A »');
  });

  it('branche : tableau arrêté suivi de poules, valide', () => {
    const s = rank(16);
    s.branches[0] = { ...s.branches[0], phases: [pool(), tableau({ stopAt: 4 }), pool()] };
    expect(codes(formula(pool(), s))).not.toContain('ends_with_stopped_tableau');
  });
});

describe('S6 : phases commencées', () => {
  const f = formula(pool(), pool(), tableau());

  it('rien de commencé, ou structure respectée : aucune remarque', () => {
    expect(formulaV2Issues(f, scope, [])).toEqual([]);
    expect(formulaV2Issues(f, scope, ['pool', 'pool'])).toEqual([]);
    expect(formulaV2Issues(f, scope, ['pool', 'pool', 'tableau'])).toEqual([]);
  });

  it('une phase commencée ne se retire pas', () => {
    const r = formulaV2Issues(formula(pool(), tableau()), scope, ['pool', 'pool']);
    expect(r.map(x => [x.code, x.phase])).toEqual([['started_phase_moved', 'pool-1']]);
    const gone = formulaV2Issues(formula(pool()), scope, ['pool', 'pool']);
    expect(gone.map(x => [x.code, x.phase])).toEqual([['started_phase_removed', 'pool-1']]);
    expect(codes(formula(pool()), scope)).toEqual([]);
  });

  it('ne change pas de nature, rien ne s’insère avant elle', () => {
    // Tableau inséré avant un tour commencé
    const r = formulaV2Issues(formula(tableau(), pool()), scope, ['pool']);
    expect(r.map(x => x.code)).toContain('started_phase_moved');
    expect(r.find(x => x.code === 'started_phase_moved')?.phase).toBe('pool-0');
  });

  it('un tour inséré après la dernière phase commencée est permis', () => {
    expect(formulaV2Issues(formula(pool(), pool(), pool(), tableau()), scope, ['pool'])).toEqual(
      []
    );
  });
});

describe('formulaProgress : phases commencées d’après l’état de session', () => {
  const stopped = formula(pool(), tableau({ stopAt: 8 }), pool(), tableau());
  const full = formula(pool(), pool(), tableau());

  it('rien : aucune phase', () => {
    expect(formulaProgress(full, {})).toEqual([]);
    expect(formulaProgress(full, { pools: [], poolsLaunched: false })).toEqual([]);
  });

  it('poules du tour courant lancées, ou tours clos dans l’historique', () => {
    expect(formulaProgress(full, { pools: [{}] })).toEqual(['pool']);
    expect(formulaProgress(full, { poolsLaunched: true })).toEqual(['pool']);
    // Tirage non lancé (état de session, moteur comme écran) : pas encore commencé
    expect(formulaProgress(full, { pools: [{}], poolsLaunched: false })).toEqual([]);
    expect(formulaProgress(full, { poolHistory: [[{}]], pools: [{}] })).toEqual(['pool', 'pool']);
    expect(formulaProgress(full, { poolHistory: [[{}], [{}]] })).toEqual(['pool', 'pool']);
  });

  it('tableau tiré : les tours qui le précèdent sont commencés', () => {
    expect(
      formulaProgress(full, { pools: [{}], poolHistory: [[{}]], tableauMatches: [{}] })
    ).toEqual(['pool', 'pool', 'tableau']);
  });

  it('tableau tiré dans un groupe (tableaux séparés)', () => {
    expect(
      formulaProgress(full, {
        poolHistory: [[{}], [{}]],
        groupTableaux: { M: { tableauMatches: [{}] } },
      })
    ).toEqual(['pool', 'pool', 'tableau']);
  });

  it('étape close : tableau arrêté commencé, tour d’après en cours', () => {
    expect(formulaProgress(stopped, { stageHistory: [{}], poolHistory: [[{}]] })).toEqual([
      'pool',
      'tableau',
    ]);
    expect(
      formulaProgress(stopped, { stageHistory: [{}], poolHistory: [[{}]], pools: [{}] })
    ).toEqual(['pool', 'tableau', 'pool']);
  });

  it('scission faite', () => {
    const withSplit = formula(pool(), rank(8));
    expect(formulaProgress(withSplit, { poolHistory: [[{}]] })).toEqual(['pool']);
    expect(
      formulaProgress(withSplit, { poolHistory: [[{}]], splitHistory: [{ label: 'A' }] })
    ).toEqual(['pool', 'split']);
  });

  it('Tour Quest ouvert', () => {
    const quest = formula(
      pool(),
      { kind: 'quest', id: id(), config: { enabled: true } } as FormulaPhaseV2,
      tableau()
    );
    expect(formulaProgress(quest, { pools: [{}] })).toEqual(['pool']);
    expect(formulaProgress(quest, { pools: [{}], questStarted: true })).toEqual(['pool', 'quest']);
    expect(formulaProgress(quest, { poolHistory: [[{}]], tableauMatches: [{}] })).toEqual([
      'pool',
      'quest',
      'tableau',
    ]);
  });
});

describe('avertissements de la simulation (ADR-0041)', () => {
  const warn = (f: FormulaV2, count: number) =>
    simulateFormula(count, simulationFormulaOf(f), 'E').warnings;

  it('poules de moins de 4 tireurs', () => {
    const f = formula(pool({ sizeMin: 3, sizeMax: 3 }), tableau());
    expect(warn(f, 9).some(w => w.includes('poule de 3 tireurs'))).toBe(true);
    expect(warn(formula(pool({ sizeMin: 4, sizeMax: 4 }), tableau()), 8)).toEqual([]);
  });

  it('moins de 4 qualifiés', () => {
    const f = formula(pool({ qualification: { mode: 'fixed_count', count: 3 } }), tableau());
    expect(warn(f, 20).some(w => w.includes('moins de 4 qualifiés'))).toBe(true);
    const ok = formula(pool({ qualification: { mode: 'fixed_count', count: 8 } }), tableau());
    expect(warn(ok, 20).some(w => w.includes('moins de 4 qualifiés'))).toBe(false);
  });

  it('plus de la moitié d’exempts au premier tour du tableau (taille automatique)', () => {
    const exempts = (count: number) =>
      warn(formula(tableau()), count).filter(w => w.includes('exemptions'));
    // 17 tireurs : tableau de 32, 15 exempts > 8,5
    expect(exempts(17)).toHaveLength(1);
    expect(exempts(17)[0]).toContain('15 exemptions pour 17 tireurs (tableau de 32)');
    // 24 tireurs : tableau de 32, 8 exempts ≤ 12
    expect(exempts(24)).toEqual([]);
    expect(exempts(32)).toEqual([]);
  });

  it('taille de tableau imposée : la taille effective compte', () => {
    const forced = formula(tableau({ legacy: { bracketSizeOverride: 32, placesToFence: [] } }));
    expect(warn(forced, 10).some(w => w.includes('22 exemptions pour 10 tireurs'))).toBe(true);
  });

  it('plus de 3 tours de poules', () => {
    const four = formula(pool(), pool(), pool(), pool(), tableau());
    expect(warn(four, 40).some(w => w.includes('4 tours de poules'))).toBe(true);
    expect(
      warn(formula(pool(), pool(), pool(), tableau()), 40).some(w => w.includes('tours de poules'))
    ).toBe(false);
  });
});

describe('tour en vagues : poules de 2 à 10 (docs/adr/0043, F4a)', () => {
  const waves = (over: Partial<PoolRoundPhase> = {}) =>
    formula(pool({ boutOrder: 'waves', sizeMin: 2, sizeMax: 10, ...over }), tableau());

  it('poules de 2 à 10 admises pour « waves » et « waves_classic »', () => {
    expect(formulaV2Issues(waves(), scope)).toEqual([]);
    expect(formulaV2Issues(waves({ boutOrder: 'waves_classic' }), scope)).toEqual([]);
  });

  it('au-delà de 10, ou sous 2 : remarque sur le tour', () => {
    expect(codes(waves({ sizeMax: 11 }))).toEqual(['pool_settings']);
    expect(codes(waves({ sizeMin: 1 }))).toEqual(['pool_settings']);
    const [remark] = formulaV2Issues(waves({ sizeMax: 11 }), scope);
    expect(remark.phase).toBe('pool-0');
    expect(remark.message).toContain('2 à 10');
  });

  it('vagues classiques : jusqu’à 15 ; « waves » reste borné à 10', () => {
    expect(formulaV2Issues(waves({ boutOrder: 'waves_classic', sizeMax: 15 }), scope)).toEqual([]);
    expect(codes(waves({ boutOrder: 'waves_classic', sizeMax: 16 }))).toEqual(['pool_settings']);
    expect(codes(waves({ boutOrder: 'waves', sizeMax: 11 }))).toEqual(['pool_settings']);
    expect(codes(waves({ boutOrder: 'waves', sizeMax: 15 }))).toEqual(['pool_settings']);
  });

  it('borne basse 2 pour ce seul ordre : sous 3, FIE et libre refusés', () => {
    expect(codes(formula(pool({ boutOrder: 'fie', sizeMin: 2, sizeMax: 6 }), tableau()))).toEqual([
      'pool_settings',
    ]);
    expect(codes(formula(pool({ boutOrder: 'free', sizeMin: 2, sizeMax: 6 }), tableau()))).toEqual([
      'pool_settings',
    ]);
  });

  it('chaque tour jugé avec son ordre : un tour en vagues à côté d’un tour FIE', () => {
    const f = formula(
      pool({ boutOrder: 'waves', sizeMin: 2, sizeMax: 10 }),
      pool({ boutOrder: 'fie', sizeMin: 5, sizeMax: 7 }),
      tableau()
    );
    expect(formulaV2Issues(f, scope).filter(r => r.code === 'pool_settings')).toEqual([]);
  });
});

describe('mode expert : briques et réglages', () => {
  it('une formule reste valide quel que soit le mode : le jugement ignore le mode expert', () => {
    // Formule experte valide (tableau arrêté suivi d'un tour) : aucune remarque, sans mode
    const f = formula(pool(), tableau({ stopAt: 8 }), pool({ sizeMin: 4, sizeMax: 4 }));
    expect(formulaNeedsExpert(f)).toBe(true);
    expect(formulaV2Issues(f, scope)).toEqual([]);
    // formulaV2Issues ne prend aucun paramètre de mode (scope, progress seulement)
    expect(formulaV2Issues.length).toBeLessThanOrEqual(3);
  });

  it('formule par défaut : simple', () => {
    expect(formulaNeedsExpert(base())).toBe(false);
  });

  it('ordre des matchs en vagues : réglage avancé (docs/adr/0043)', () => {
    expect(formulaNeedsExpert(formula(pool({ boutOrder: 'waves' }), tableau()))).toBe(true);
    expect(formulaNeedsExpert(formula(pool({ boutOrder: 'waves_classic' }), tableau()))).toBe(true);
    expect(formulaNeedsExpert(formula(pool({ boutOrder: 'fie' }), tableau()))).toBe(false);
  });

  it('scission, Tour Quest, tableau arrêté', () => {
    expect(formulaNeedsExpert(formula(pool(), rank(8)))).toBe(true);
    expect(
      formulaNeedsExpert(
        formula(pool(), { kind: 'quest', id: id(), config: { enabled: true } } as FormulaPhaseV2)
      )
    ).toBe(true);
    expect(formulaNeedsExpert(formula(pool(), tableau({ stopAt: 8 }), pool()))).toBe(true);
  });

  it('réglages avancés : ex aequo, cumul, ordre libre, barème à zones', () => {
    expect(
      formulaNeedsExpert(formula(pool({ qualification: { mode: 'all', ties: 'draw' } })))
    ).toBe(true);
    expect(formulaNeedsExpert(formula(pool({ qualification: { mode: 'all', ties: 'all' } })))).toBe(
      false
    );
    expect(formulaNeedsExpert(formula(pool(), pool({ seeding: 'cumulative' })))).toBe(true);
    expect(formulaNeedsExpert(formula(pool({ boutOrder: 'free' })))).toBe(true);
    expect(
      formulaNeedsExpert(formula(pool({ scoring: { type: 'zones', maxScore: 15, zones: [] } })))
    ).toBe(true);
    expect(formulaNeedsExpert(formula(pool({ scoring: { type: 'standard', maxScore: 5 } })))).toBe(
      false
    );
  });

  it('formule rendue par les opérations (aucun expert par défaut)', () => {
    const f = applyOperationsV2(ctx, [{ op: 'insertPhase', brick: 'pool', at: 1 }], id);
    expect(formulaNeedsExpert(f)).toBe(false);
  });

  it('briques proposées : le niveau simple retire Tour Quest et scission', () => {
    expect(bricksForLevel(['pool', 'quest', 'tableau', 'split'], false)).toEqual([
      'pool',
      'tableau',
    ]);
    expect(bricksForLevel(['pool', 'quest', 'tableau', 'split'], true)).toEqual([
      'pool',
      'quest',
      'tableau',
      'split',
    ]);
  });
});
