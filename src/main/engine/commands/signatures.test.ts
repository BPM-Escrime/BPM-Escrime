/**
 * Signatures des feuilles (#2159), base SQLite réelle : règles de la feuille de poule (tireur
 * de la poule, matchs terminés, verrou) et réserve de la feuille de match au tableau.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '../../../database';
import { hasNodeSqlite } from '../../../database/testing/nodeSqliteDatabase';
import { Category, FencerStatus, Gender, Weapon } from '../../../shared/types';
import { buildDefaultCompetitionSettings } from '../../../shared/utils/defaultCompetitionSettings';
import type { CommandContext } from './context';
import { generatePools, listMatches } from './sport';
import { invoke } from '../api/engine';

vi.mock('better-sqlite3-multiple-ciphers', async () => ({
  default: (await import('../../../database/testing/nodeSqliteDatabase')).NodeSqliteDatabase,
}));

const d = hasNodeSqlite ? describe : describe.skip;
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

let db: DatabaseManager;
let ctx: CommandContext;
let competitionId: string;

beforeEach(async () => {
  db = new DatabaseManager(':memory:');
  await db.open(':memory:');
  ctx = { db };
  competitionId = db.createCompetition({
    title: 'Signatures',
    date: new Date('2026-12-06'),
    weapon: Weapon.EPEE,
    gender: Gender.MALE,
    category: Category.SENIOR,
    settings: buildDefaultCompetitionSettings({ weapon: Weapon.EPEE, category: Category.SENIOR }),
  }).id;
  for (let i = 0; i < 4; i++) {
    db.addFencer(competitionId, {
      lastName: `NOM${i}`,
      firstName: `P${i}`,
      ranking: i + 1,
      status: FencerStatus.CHECKED_IN,
    });
  }
  generatePools(ctx, competitionId, { poolCount: 1 });
});

afterEach(() => db.close());

const call = (op: string, input: Record<string, unknown>) =>
  invoke(ctx, op as never, { competitionId, ...input } as never) as Promise<any>;

d('signPoolSheet (#2159)', () => {
  it('matchs terminés exigés, puis feuille verrouillée une fois signée par tous', async () => {
    const matches = listMatches(ctx, competitionId);
    const poolId = db.getCompetitionPools(competitionId)[0].id;
    const fencerIds = [...new Set(matches.flatMap(m => [m.fencerA!.id, m.fencerB!.id]))];
    await expect(
      call('signPoolSheet', { poolId, fencerId: fencerIds[0], signatureData: PNG })
    ).rejects.toMatchObject({ code: 'fencer_matches_pending' });
    for (const m of matches) {
      await call('recordScore', { matchId: m.matchId, scoreA: 5, scoreB: 1, winner: 'A' });
    }
    const first = await call('signPoolSheet', {
      poolId,
      fencerId: fencerIds[0],
      signatureData: PNG,
    });
    expect(first).toMatchObject({ signed: 1, total: 4, locked: false });
    await call('signPoolSheet', { poolId, fencerId: fencerIds[1], signatureData: PNG });
    await call('signPoolSheet', { poolId, fencerId: fencerIds[2], signatureData: PNG });
    const last = await call('signPoolSheet', {
      poolId,
      fencerId: fencerIds[3],
      signatureData: PNG,
    });
    expect(last).toMatchObject({ signed: 4, locked: true });
    expect(db.getPoolSignatures(poolId)).toHaveLength(4);
    await expect(
      call('signPoolSheet', { poolId, fencerId: fencerIds[0], signatureData: PNG })
    ).rejects.toMatchObject({ code: 'signatures_locked' });
  });

  it('tireur hors poule, image non PNG : refus', async () => {
    const poolId = db.getCompetitionPools(competitionId)[0].id;
    await expect(
      call('signPoolSheet', { poolId, fencerId: 'inconnu', signatureData: PNG })
    ).rejects.toMatchObject({ code: 'fencer_not_in_pool' });
    await expect(
      call('signPoolSheet', { poolId, fencerId: 'x', signatureData: 'data:image/jpeg;base64,AA' })
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

d('signMatchSheet (#2159)', () => {
  it('match de poule refusé, match inconnu refusé', async () => {
    const m = listMatches(ctx, competitionId)[0];
    await expect(
      call('signMatchSheet', { matchId: m.matchId, fencerId: m.fencerA!.id, signatureData: PNG })
    ).rejects.toMatchObject({ code: 'signature_tableau_only' });
    await expect(
      call('signMatchSheet', { matchId: 'zz', fencerId: 'f', signatureData: PNG })
    ).rejects.toMatchObject({ code: 'match_not_found' });
  });
});
