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
  type PoolRanking,
} from '../../../shared/types';
import { buildDefaultCompetitionSettings } from '../../../shared/utils/defaultCompetitionSettings';
import {
  flatSettingsOf,
  formulaOf,
  type FormulaV2,
} from '../../../shared/domain/formula/formulaV2';
import type { TableauMatch } from '../../../shared/domain/tableau/tableauTypes';
import type { CommandContext } from './context';
import { invoke } from '../api/engine';
import { resultsData } from './sport';
import { resultsXml } from './exportResults';

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

  it('tours après l’arrêt : score refusé, écran comme tablettes (ADR-0037)', async () => {
    const [a, b, c, dd] = fencers;
    const final = m(2, dd, b, null);
    db.saveSessionState(competitionId, {
      currentPhase: 5,
      tableauMatches: [m(4, a, dd, dd, [1, 4]), m(4, b, c, b, [2, 3]), final],
    });
    await expect(
      op('recordScore', { matchId: final.id, scoreA: 15, scoreB: 3 })
    ).rejects.toMatchObject({ code: 'tableau_round_after_stop' });
  });

  it('pilotage hors écran (MCP) : plusieurs tours de poules plus refusés (ADR-0042)', async () => {
    // Réglages plats écrits avec la formule (writeFormula) : 2 tours de poules
    db.updateCompetition(competitionId, {
      settings: { ...base, ...flatSettingsOf(stopped(), Weapon.EPEE), formula: stopped() } as never,
    });
    // Plus de refus de format : le moteur contrôle les poules (parcours complet : multiRound.test.ts)
    await expect(op('generateTableau', {})).rejects.toMatchObject({
      code: 'pools_not_complete',
    });
  });

  it('publication du moteur (GREG / FTP) : restants, éliminés du tableau, puis des poules', async () => {
    // 10 tireurs : 8 au tableau (rang d'entrée = rang après poules), 2 éliminés des poules
    const more = ['E', 'F', 'G', 'H', 'I', 'J'].map(id =>
      db.addFencer(competitionId, {
        lastName: id,
        firstName: id,
        status: ['I', 'J'].includes(id) ? FencerStatus.ELIMINATED : FencerStatus.QUALIFIED,
      })
    );
    const all = [...fencers, ...more];
    const [a, b, c, dd, e, f, g, h] = all;
    const row = (fencer: Fencer, rank: number): PoolRanking => ({
      fencer,
      rank,
      victories: 10 - rank,
      defeats: rank,
      matchesPlayed: 10,
      touchesScored: 0,
      touchesReceived: 0,
      index: 0,
      ratio: 0,
    });
    db.saveSessionState(competitionId, {
      currentPhase: 5,
      currentPoolRound: 1,
      pools: [{ id: 'p1', fencers: [] }],
      overallRanking: all.map((x, i) => row(x, i + 1)),
      tableauMatches: [
        // Tableau de 8 : surprises au tour de 8 (5 bat 4, 6 bat 3) et de 4 (5 bat 1)
        m(8, a, h, a, [1, 8]),
        m(8, dd, e, e, [4, 5]),
        m(8, c, f, f, [3, 6]),
        m(8, b, g, b, [2, 7]),
        m(4, a, e, e, [1, 5]),
        m(4, f, b, b, [6, 2]),
        m(2, e, b, null),
      ],
    });
    expect(await op('closeTableauStage', {})).toMatchObject({ qualified: 2, eliminated: 6 });
    // Restants (ordre du classement reçu), éliminés au tour de 4, au tour de 8 (rang
    // d'entrée), puis éliminés des poules
    const expected = ['B', 'E', 'A', 'F', 'C', 'D', 'G', 'H', 'I', 'J'];
    const ranking = resultsData(ctx, competitionId).overallRanking;
    expect(ranking.map(r => r.fencer.lastName)).toEqual(expected);
    expect(ranking.map(r => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // XML publié (GREG, FTP) : même ordre, même classement
    const xml = resultsXml(resultsData(ctx, competitionId));
    const tireurs = xml.slice(xml.indexOf('<Tireurs>'), xml.indexOf('</Tireurs>'));
    const published = [...tireurs.matchAll(/Classement="(\d*)" Nom="([^"]*)"/g)].map(x => [
      x[2],
      Number(x[1]),
    ]);
    expect(published).toEqual(expected.map((name, i) => [name, i + 1]));
  });
});
