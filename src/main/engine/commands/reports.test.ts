/**
 * Relevés de l'épreuve (#1981 lot 2) : historique des scores, commentaires des formateurs,
 * signatures du tableau, chiffres de l'épreuve, sur une base SQLite réelle.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '../../../database';
import { hasNodeSqlite } from '../../../database/testing/nodeSqliteDatabase';
import { Category, Gender, MatchStatus, Weapon, type Fencer } from '../../../shared/types';
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

beforeEach(async () => {
  db = new DatabaseManager(':memory:');
  await db.open(':memory:');
  ctx = { db };
  competitionId = db.createCompetition({
    title: 'Relevés',
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

const q = (op: string, input: Record<string, unknown>) =>
  invoke(ctx, op as never, input as never) as Promise<any>;

/** Une poule de deux tireurs, un match terminé 5-2 en 90 s */
function poolWithMatch() {
  const add = (lastName: string) =>
    db.addFencer(competitionId, { firstName: 'P', lastName } as never) as Fencer;
  const a = add('Dupont');
  const b = add('Martin');
  const phase = db.createPhase(competitionId, 'pool', 1, 'Poules');
  const pool = db.createPool(phase.id, 1);
  const score = (value: number, isVictory: boolean) => ({
    value,
    isVictory,
    isAbstention: false,
    isExclusion: false,
    isForfait: false,
  });
  const m = db.createMatch({ number: 1, fencerA: a, fencerB: b, maxScore: 5 }, pool.id);
  db.updateMatch(m.id, {
    scoreA: score(5, true),
    scoreB: score(2, false),
    status: MatchStatus.FINISHED,
  });
  db.updateMatchTiming(m.id, null, null, 90);
  db.createMatch({ number: 2, fencerA: b, fencerB: a, maxScore: 5 }, pool.id);
  return { a, b, pool, matchId: m.id };
}

d('relevés de l’épreuve (#1981 lot 2)', () => {
  it('getCompetitionStats : matchs de poule, durée moyenne, palmarès', async () => {
    const { a } = poolWithMatch();
    const stats = await q('getCompetitionStats', { competitionId });
    expect(stats).toMatchObject({
      totalFencers: 2,
      totalMatches: 2,
      completedMatches: 1,
      averageMatchDuration: 90,
    });
    expect(stats.topFencers[0]).toMatchObject({
      fencer: { id: a.id, lastName: 'Dupont' },
      victories: 1,
      touchesScored: 5,
    });
    await expect(q('getCompetitionStats', { competitionId: 'inconnue' })).rejects.toMatchObject({
      code: 'competition_not_found',
    });
  });

  it('listScoreAudit : historique des scores de l’épreuve', async () => {
    const { matchId, pool } = poolWithMatch();
    db.logScoreChange({
      matchId,
      poolId: pool.id,
      newScoreA: { value: 5, isVictory: true },
      newScoreB: { value: 2, isVictory: false },
      changedBy: 'tablet',
      refereeName: 'Durand',
      reason: 'Correction',
    } as never);
    const log = await q('listScoreAudit', { competitionId });
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      matchId,
      changedBy: 'tablet',
      refereeName: 'Durand',
      reason: 'Correction',
      poolNumber: 1,
    });
  });

  it('listRefereeComments : tous, ou ceux d’un arbitre', async () => {
    const r1 = db.createReferee(competitionId, { name: 'Ana Dupont' });
    const r2 = db.createReferee(competitionId, { name: 'Léo Martin' });
    db.addRefereeComment(competitionId, r1.id, 'Placement à revoir', 'Formateur', 'Piste 1');
    db.addRefereeComment(competitionId, r2.id, 'Très bien');
    expect(await q('listRefereeComments', { competitionId })).toHaveLength(2);
    const only = await q('listRefereeComments', { competitionId, refereeId: r1.id });
    expect(only).toEqual([
      expect.objectContaining({ comment: 'Placement à revoir', matchLabel: 'Piste 1' }),
    ]);
  });

  it('getTableauSignatures : signatures des matchs demandés', async () => {
    db.saveDEMatchSignature('t1', 'f1', 'data:image/png;base64,AAA');
    db.saveDEMatchSignature('t2', 'f2', 'data:image/png;base64,BBB');
    const rows = await q('getTableauSignatures', { matchIds: ['t1'] });
    expect(rows).toEqual([
      { matchId: 't1', fencerId: 'f1', signatureData: 'data:image/png;base64,AAA' },
    ]);
  });
});
