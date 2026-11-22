/**
 * Classement de saison (docs/adr/0018) : commandes du contrat, base SQLite réelle.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '../../../database';
import { hasNodeSqlite } from '../../../database/testing/nodeSqliteDatabase';
import { Category, Gender, Weapon } from '../../../shared/types';
import { buildDefaultCompetitionSettings } from '../../../shared/utils/defaultCompetitionSettings';
import type { CommandContext } from './context';
import { invoke } from '../api/engine';

vi.mock('better-sqlite3-multiple-ciphers', async () => ({
  default: (await import('../../../database/testing/nodeSqliteDatabase')).NodeSqliteDatabase,
}));

const d = hasNodeSqlite ? describe : describe.skip;

let db: DatabaseManager;
let ctx: CommandContext;
let competitionId: string;
const changes: string[] = [];

beforeEach(async () => {
  db = new DatabaseManager(':memory:');
  await db.open(':memory:');
  changes.length = 0;
  ctx = { db, emitChange: c => changes.push(c.scope) };
  competitionId = db.createCompetition({
    title: 'Inscription',
    date: new Date('2026-12-06'),
    weapon: Weapon.EPEE,
    gender: Gender.MALE,
    category: Category.SENIOR,
    settings: buildDefaultCompetitionSettings({
      weapon: Weapon.EPEE,
      category: Category.SENIOR,
    }) as never,
  }).id;
});
afterEach(() => db.close());

const call = (op: string, input: Record<string, unknown>) =>
  invoke(ctx, op as never, { competitionId, ...input } as never) as Promise<any>;

const season = () =>
  invoke(ctx, 'getSeasonRanking' as never, {} as never) as Promise<{
    ranking: Array<{ fencerId: string; totalVictories: number; competitionCount: number }>;
    competitions: Array<{ competitionId: string; fencerCount: number }>;
  }>;

async function playPools() {
  for (let i = 0; i < 4; i++) {
    db.addFencer(competitionId, {
      lastName: `N${i}`,
      firstName: 'P',
      status: 'P' as never,
      ranking: i + 1,
    });
  }
  await call('generatePools', { poolCount: 1 });
  const pools = (db.getSessionState(competitionId) as any).pools;
  for (const m of pools[0].matches) {
    await call('recordScore', { matchId: m.id, scoreA: 5, scoreB: 2 });
  }
}

d('classement de saison (docs/adr/0018)', () => {
  it('includeInSeason : classement calculé par le moteur, reversement sans doublon', async () => {
    await expect(call('includeInSeason', {})).rejects.toMatchObject({ code: 'no_pools' });
    await playPools();
    const r = await call('includeInSeason', {});
    expect(r).toMatchObject({ competitionId, fencers: 4 });
    let s = await season();
    expect(s.competitions).toEqual([expect.objectContaining({ competitionId, fencerCount: 4 })]);
    expect(s.ranking.reduce((n, e) => n + e.totalVictories, 0)).toBe(6); // 6 matchs, 1 vainqueur chacun
    await call('includeInSeason', {});
    s = await season();
    expect(s.ranking).toHaveLength(4);
    expect(s.ranking.every(e => e.competitionCount === 1)).toBe(true);
  });

  it('excludeFromSeason et resetSeason', async () => {
    await playPools();
    await call('includeInSeason', {});
    await call('excludeFromSeason', {});
    expect((await season()).competitions).toEqual([]);
    await expect(call('excludeFromSeason', {})).rejects.toMatchObject({ code: 'not_in_season' });
    await call('includeInSeason', {});
    const reset = (await invoke(ctx, 'resetSeason' as never, {} as never)) as any;
    expect(reset).toMatchObject({ competitions: 1 });
    expect((await season()).ranking).toEqual([]);
  });
});
