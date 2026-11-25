/**
 * Tableau arrêté à N tireurs (docs/adr/0037), base SQLite réelle.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '../../../database';
import { hasNodeSqlite } from '../../../database/testing/nodeSqliteDatabase';
import {
  Category,
  CompetitionSettings,
  Fencer,
  FencerStatus,
  Gender,
  Weapon,
} from '../../../shared/types';
import { buildDefaultCompetitionSettings } from '../../../shared/utils/defaultCompetitionSettings';
import { formulaOf, type FormulaV2 } from '../../../shared/domain/formula/formulaV2';
import type { TableauMatch } from '../../../shared/domain/tableau/tableauTypes';
import type { CommandContext } from './context';
import { invoke } from '../api/engine';

vi.mock('better-sqlite3-multiple-ciphers', async () => ({
  default: (await import('../../../database/testing/nodeSqliteDatabase')).NodeSqliteDatabase,
}));

const d = hasNodeSqlite ? describe : describe.skip;

let db: DatabaseManager;
let ctx: CommandContext;
let competitionId: string;
let fencers: Fencer[];

const base = buildDefaultCompetitionSettings({
  weapon: Weapon.EPEE,
  category: Category.SENIOR,
}) as CompetitionSettings;
/** Poules, tableau arrêté à 2, poule finale */
const stopped = (): FormulaV2 => {
  const f = formulaOf({ weapon: Weapon.EPEE, category: Category.SENIOR, settings: base });
  const pool = f.phases[0];
  const tableau = { ...f.phases[1], stopAt: 2 } as FormulaV2['phases'][number];
  return { ...f, phases: [pool, tableau, { ...pool, id: 'final-pool' }] };
};

let n = 0;
const m = (
  round: number,
  a: Fencer,
  b: Fencer,
  winner: Fencer | null,
  seeds: [number, number] | null = null
): TableauMatch => ({
  id: `m${++n}`,
  round,
  position: n,
  fencerA: a,
  fencerB: b,
  scoreA: null,
  scoreB: null,
  winner,
  isBye: false,
  seedA: seeds?.[0] ?? null,
  seedB: seeds?.[1] ?? null,
});

beforeEach(async () => {
  db = new DatabaseManager(':memory:');
  await db.open(':memory:');
  ctx = { db, emitChange: () => undefined };
  competitionId = db.createCompetition({
    title: 'Arrêt',
    date: new Date('2026-12-06'),
    weapon: Weapon.EPEE,
    gender: Gender.MALE,
    category: Category.SENIOR,
    settings: { ...base, formula: stopped() } as never,
  }).id;
  fencers = ['A', 'B', 'C', 'D'].map(id =>
    db.addFencer(competitionId, { lastName: id, firstName: id, status: FencerStatus.QUALIFIED })
  );
});
afterEach(() => db.close());

const op = (name: string, input: Record<string, unknown>) =>
  invoke(ctx, name as never, { competitionId, ...input } as never) as Promise<any>;

d('closeTableauStage (docs/adr/0037)', () => {
  it('demies jouées : finalistes au tour suivant par rang d’entrée, demi-finalistes éliminés', async () => {
    const [a, b, c, dd] = fencers;
    db.saveSessionState(competitionId, {
      currentPhase: 5,
      currentPoolRound: 1,
      pools: [{ id: 'p1', fencers: [] }],
      tableauMatches: [m(4, a, dd, dd, [1, 4]), m(4, b, c, b, [2, 3]), m(2, dd, b, null)],
    });
    const r = await op('closeTableauStage', {});
    expect(r).toMatchObject({ stopAt: 2, qualified: 2, eliminated: 2 });
    const state = db.getSessionState(competitionId) as Record<string, any>;
    expect(state.tableauMatches).toEqual([]);
    expect(state.currentPoolRound).toBe(2);
    expect(state.poolHistory).toHaveLength(1);
    expect(state.stageHistory[0].eliminated.map((e: { fencerId: string }) => e.fencerId)).toEqual([
      a.id,
      c.id,
    ]);
    expect(db.getFencer(a.id)?.status).toBe(FencerStatus.ELIMINATED);
    // Restants : B (rang 2) puis D (rang 4)
    expect([db.getFencer(b.id)?.ranking, db.getFencer(dd.id)?.ranking]).toEqual([1, 2]);
    const events = db.eventLog.getSince(competitionId, 0).map(e => e.type);
    expect(events).toContain('TableauStageClosed');
  });

  it('refus : demie non jouée, ou formule sans tableau arrêté', async () => {
    const [a, b, c, dd] = fencers;
    db.saveSessionState(competitionId, {
      tableauMatches: [m(4, a, dd, null), m(4, b, c, b)],
    });
    await expect(op('closeTableauStage', {})).rejects.toMatchObject({
      code: 'tableau_stage_not_complete',
    });
    db.updateCompetition(competitionId, { settings: base as never });
    await expect(op('closeTableauStage', {})).rejects.toMatchObject({ code: 'invalid_settings' });
  });
});
