/**
 * Règle de rencontre des équipes dans la formule v2 (ADR-0044, G0a) : lecture par phase avec
 * repli sur les réglages d'épreuve, réglages plats écrits depuis la règle générale, opérations
 * de la frise, contrôles (briques admises, bornes, S3 et S4 sur l'effectif d'équipes).
 */
import { describe, expect, it } from 'vitest';
import { Category, Weapon } from '../../types';
import {
  flatSettingsOf,
  withFlatSettings,
  type FormulaV2,
  type PoolRoundPhase,
  type TableauPhase,
} from '../formula/formulaV2';
import { applyOperationsV2, formulaV2Issues } from '../formula/formulaV2Operations';
import { FIE_RELAY_ORDER_3, generateRelayOrder } from './teamCalculations';
import {
  relayPairsOf,
  teamFormulaOf,
  teamFormulaIssues,
  teamMatchRuleOf,
  withTeamMatch,
} from './teamMatchRule';

const pool = (over: Partial<PoolRoundPhase> = {}): PoolRoundPhase => ({
  kind: 'pool',
  id: 'p1',
  sizeMin: 3,
  sizeMax: 6,
  maxScore: 45,
  timerSeconds: 180,
  qualification: { mode: 'all' },
  seeding: 'previous_round',
  boutOrder: 'fie',
  ...over,
});
const tableau = (over: Partial<TableauPhase> = {}): TableauPhase => ({
  kind: 'tableau',
  id: 't',
  maxScore: 45,
  timerSeconds: 180,
  thirdPlace: false,
  allPlaces: false,
  ...over,
});
const formula = (phases: FormulaV2['phases'], general: FormulaV2['general'] = {}): FormulaV2 => ({
  version: 2,
  phases,
  general,
});
const RULE = { starters: 3, reserves: 1, relayStep: 5, relayOrder: 'fie' as const };
const team = { isTeamEvent: true, teamFormat: 'fie-relay' as const };
const codes = (f: FormulaV2, scope: Parameters<typeof teamFormulaIssues>[1] = team) =>
  teamFormulaIssues(f, scope).map(r => `${r.code}@${r.phase}`);

describe('teamMatchRuleOf : règle générale, surcharge par phase, repli (ADR-0044)', () => {
  it('formule absente : réglages d’épreuve, défauts 1 remplaçant, palier 5, ordre de l’arme', () => {
    expect(teamMatchRuleOf(undefined, undefined, { minTeamSize: 3 }, Weapon.EPEE)).toEqual(RULE);
    expect(
      teamMatchRuleOf(
        undefined,
        { kind: 'tableau' },
        { minTeamSize: 4, teamReserveCount: 2, teamRelayStepSize: 4 },
        Weapon.SABRE
      )
    ).toEqual({ starters: 4, reserves: 2, relayStep: 4, relayOrder: 'rotation' });
    // Sabre Laser à 3 : rotation (relayOrderFor)
    expect(teamMatchRuleOf(undefined, undefined, {}, Weapon.LASER).relayOrder).toBe('rotation');
  });

  it('règle générale, puis surcharge de la phase champ par champ', () => {
    const f = formula(
      [pool({ teamMatch: { relayStep: 4 } }), tableau({ teamMatch: { reserves: 0 } })],
      {
        teamMatch: { ...RULE, reserves: 2 },
      }
    );
    const settings = { minTeamSize: 2, teamRelayStepSize: 9 };
    expect(teamMatchRuleOf(f, undefined, settings, Weapon.FOIL)).toEqual({ ...RULE, reserves: 2 });
    expect(teamMatchRuleOf(f, { kind: 'pool', round: 0 }, settings, Weapon.FOIL)).toEqual({
      ...RULE,
      reserves: 2,
      relayStep: 4,
    });
    expect(teamMatchRuleOf(f, { kind: 'tableau' }, settings, Weapon.FOIL)).toEqual({
      ...RULE,
      reserves: 0,
    });
  });

  it('ordre non réglé : celui des titulaires de la phase ; « fie » hors 3 titulaires : rotation', () => {
    const f = formula([tableau({ teamMatch: { starters: 4 } })], {
      teamMatch: { starters: 3, reserves: 1, relayStep: 5 } as never,
    });
    expect(teamMatchRuleOf(f, undefined, {}, Weapon.EPEE).relayOrder).toBe('fie');
    expect(teamMatchRuleOf(f, { kind: 'tableau' }, {}, Weapon.EPEE).relayOrder).toBe('rotation');
    const g = formula([tableau({ teamMatch: { starters: 2 } })], { teamMatch: RULE });
    expect(teamMatchRuleOf(g, { kind: 'tableau' }, {}, Weapon.EPEE).relayOrder).toBe('rotation');
  });

  it('paires des relais : ordre FIE o.99.3 ou rotation', () => {
    expect(relayPairsOf(RULE)).toEqual(FIE_RELAY_ORDER_3.map(([a, b]) => [a, b]));
    expect(relayPairsOf({ starters: 3, relayOrder: 'rotation' })).toEqual(generateRelayOrder(3));
    expect(relayPairsOf({ starters: 2, relayOrder: 'rotation' })).toHaveLength(4);
  });
});

describe('Formule d’équipe : marque `general.teamMatch` (ADR-0044)', () => {
  const settings = { minTeamSize: 3, formula: formula([pool(), tableau()]) };
  it('formule « individuelle » enregistrée ou arène : pas de formule d’équipe', () => {
    expect(teamFormulaOf({ isTeamEvent: true, settings })).toBeUndefined();
    expect(teamFormulaOf({ isTeamEvent: true, settings: undefined })).toBeUndefined();
    const stamped = { ...settings, formula: formula([tableau()], { teamMatch: RULE }) };
    expect(teamFormulaOf({ isTeamEvent: true, settings: stamped })).toBe(stamped.formula);
    expect(
      teamFormulaOf({ isTeamEvent: true, settings: { ...stamped, teamFormat: 'laser-arena' } })
    ).toBeUndefined();
    expect(teamFormulaOf({ isTeamEvent: false, settings: stamped })).toBeUndefined();
  });

  it('withTeamMatch pose la règle des réglages d’une épreuve par équipes en relais FIE', () => {
    const f = formula([tableau()]);
    const comp = { weapon: Weapon.EPEE, isTeamEvent: true, settings: { minTeamSize: 3 } };
    expect(withTeamMatch(f, comp).general.teamMatch).toEqual(RULE);
    expect(withTeamMatch(f, { ...comp, isTeamEvent: false })).toBe(f);
    expect(
      withTeamMatch(f, { ...comp, settings: { minTeamSize: 3, teamFormat: 'laser-arena' } })
    ).toBe(f);
    const own = formula([tableau()], { teamMatch: { ...RULE, reserves: 0 } });
    expect(withTeamMatch(own, comp)).toBe(own);
  });
});

describe('Réglages plats depuis la règle générale (flatSettingsOf, withFlatSettings)', () => {
  it('flatSettingsOf écrit minTeamSize, teamReserveCount, teamRelayStepSize', () => {
    const f = formula([pool(), tableau()], {
      teamMatch: { ...RULE, starters: 4, reserves: 2, relayStep: 4 },
    });
    expect(flatSettingsOf(f, Weapon.EPEE)).toMatchObject({
      minTeamSize: 4,
      teamReserveCount: 2,
      teamRelayStepSize: 4,
    });
    expect(flatSettingsOf(f, Weapon.CUSTOM)).toMatchObject({ minTeamSize: 4 });
    expect(flatSettingsOf(formula([tableau()]), Weapon.EPEE)).not.toHaveProperty('minTeamSize');
  });

  it('withFlatSettings reporte les réglages d’équipe dans la règle générale', () => {
    const f = formula([tableau()], { teamMatch: RULE });
    expect(
      withFlatSettings(f, { teamRelayStepSize: 3, minTeamSize: 4 })?.general.teamMatch
    ).toEqual({ ...RULE, relayStep: 3, starters: 4 });
    // Sans règle générale : formule gardée telle quelle (la règle se lit dans les réglages)
    const plain = formula([tableau()]);
    expect(withFlatSettings(plain, { minTeamSize: 4 })).toEqual(plain);
  });
});

describe('Opérations de la frise : teamMatch général et par phase', () => {
  const ctx = {
    weapon: Weapon.EPEE,
    category: Category.SENIOR,
    settings: { formula: formula([pool(), tableau()]) },
  };
  it('setGeneral et setPhase posent puis retirent la règle (null)', () => {
    let n = 0;
    const id = () => `x${n++}`;
    const f = applyOperationsV2(
      ctx,
      [
        { op: 'setGeneral', settings: { teamMatch: RULE } },
        { op: 'setPhase', phase: 'pool-0', settings: { teamMatch: { relayStep: 4 } } },
        { op: 'setPhase', phase: 'tableau', settings: { teamMatch: { reserves: 0 } } },
      ] as never,
      id
    );
    expect(f.general.teamMatch).toEqual(RULE);
    expect((f.phases[0] as PoolRoundPhase).teamMatch).toEqual({ relayStep: 4 });
    expect((f.phases[1] as TableauPhase).teamMatch).toEqual({ reserves: 0 });
    const g = applyOperationsV2(
      { ...ctx, settings: { formula: f } },
      [
        { op: 'setGeneral', settings: { teamMatch: null } },
        { op: 'setPhase', phase: 'pool-0', settings: { teamMatch: null } },
      ] as never,
      id
    );
    expect(g.general).not.toHaveProperty('teamMatch');
    expect(g.phases[0]).not.toHaveProperty('teamMatch');
    expect(() =>
      applyOperationsV2(ctx, [{ op: 'setGeneral', settings: { teamMatch: 3 } }] as never, id)
    ).toThrow(/teamMatch/);
  });
});

describe('Contrôles d’une épreuve par équipes en relais FIE (ADR-0044)', () => {
  it('formule admise : un tour de poules puis un tableau, ou un tableau seul', () => {
    expect(codes(formula([pool(), tableau()], { teamMatch: RULE }))).toEqual([]);
    expect(codes(formula([tableau({ thirdPlace: true })], { teamMatch: RULE }))).toEqual([]);
  });

  it('team_brick_unsupported : Quest, scission, vagues, têtes de poule, binômes, 2 tours, toutes les places', () => {
    const quest = { kind: 'quest', id: 'q', config: { enabled: true } } as never;
    const split = { kind: 'split', id: 's', criterion: 'rank', branches: [] } as never;
    expect(codes(formula([pool(), quest, tableau()]))).toContain('team_brick_unsupported@quest');
    expect(codes(formula([pool(), split]))).toContain('team_brick_unsupported@split');
    expect(codes(formula([pool({ boutOrder: 'waves' }), tableau()]))).toEqual([
      'team_brick_unsupported@pool-0',
    ]);
    expect(
      codes(formula([pool({ qualification: { mode: 'pool_heads', count: 4 } }), tableau()]))
    ).toEqual(['team_brick_unsupported@pool-0']);
    expect(
      codes(formula([tableau()], { entry: { kind: 'team', size: 2, levels: ['A'] } }))
    ).toEqual(['team_brick_unsupported@null']);
    expect(codes(formula([pool(), pool(), tableau()]))).toEqual(['team_brick_unsupported@pool-1']);
    expect(codes(formula([pool(), tableau({ allPlaces: true })]))).toEqual([
      'team_brick_unsupported@tableau',
    ]);
    expect(codes(formula([pool()]))).toEqual(['team_brick_unsupported@null']);
    expect(codes(formula([pool({ qualification: { mode: 'pool_winner' } }), tableau()]))).toEqual([
      'team_brick_unsupported@pool-0',
    ]);
  });

  it('arène Sabre Laser et épreuve individuelle : aucune remarque d’équipe', () => {
    const f = formula([pool(), pool(), tableau({ allPlaces: true })]);
    expect(codes(f, { isTeamEvent: true, teamFormat: 'laser-arena' })).toEqual([]);
    expect(codes(f, { isTeamEvent: false })).toEqual([]);
  });

  it('bornes de la règle : titulaires 2-4, remplaçants 0-2, palier ≥ 1, ordre FIE à 3', () => {
    expect(
      codes(
        formula([tableau()], {
          teamMatch: { starters: 5, reserves: 3, relayStep: 0, relayOrder: 'x' } as never,
        })
      )
    ).toEqual([
      'invalid_team_match@null',
      'invalid_team_match@null',
      'invalid_team_match@null',
      'invalid_team_match@null',
    ]);
    expect(codes(formula([tableau()], { teamMatch: { ...RULE, starters: 4 } }))).toEqual([
      'invalid_team_match@null',
    ]);
    // Surcharge de phase : titulaires 2 avec l'ordre FIE hérité de la règle générale
    expect(
      codes(formula([pool({ teamMatch: { starters: 2 } }), tableau()], { teamMatch: RULE }))
    ).toEqual(['invalid_team_match@pool-0']);
    expect(
      codes(
        formula([pool(), tableau({ teamMatch: { reserves: 2, relayStep: 3 } })], {
          teamMatch: RULE,
        })
      )
    ).toEqual([]);
  });

  it('S3, S4 sur l’effectif d’équipes : poules réalisables, 2 équipes pour un tableau', () => {
    const f = formula([pool({ sizeMin: 4, sizeMax: 5 }), tableau()], { teamMatch: RULE });
    expect(codes(f, { ...team, teamCount: 3 })).toEqual(['teams_below_pool_min@pool-0']);
    expect(codes(f, { ...team, teamCount: 7 })).toEqual(['teams_not_poolable@pool-0']);
    expect(codes(f, { ...team, teamCount: 9 })).toEqual([]);
    expect(codes(formula([tableau()], { teamMatch: RULE }), { ...team, teamCount: 1 })).toEqual([
      'teams_below_tableau_min@tableau',
    ]);
  });

  it('formulaV2Issues applique les contrôles d’équipe (scope teamFormat, teamCount)', () => {
    const f = formula([pool(), pool(), tableau()], { teamMatch: RULE });
    const scope = { weapon: Weapon.EPEE, isTeamEvent: true, teamFormat: 'fie-relay' as const };
    expect(formulaV2Issues(f, scope).map(r => r.code)).toContain('team_brick_unsupported');
    expect(
      formulaV2Issues(f, { ...scope, teamFormat: 'laser-arena' }).map(r => r.code)
    ).not.toContain('team_brick_unsupported');
  });
});
