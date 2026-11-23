/**
 * Événements simulés du remplissage automatique (replaceSimulatedMatchEvents, #1981), sur une
 * base SQLite réelle : touches, cartons et durée remplacés d'un bloc, rien au journal.
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
    title: 'Simulation',
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

const durationOf = (matchId: string) =>
  db.getMatchTimings(competitionId).find(t => t.matchId === matchId)?.duration ?? null;

const events = (fencerId: string, n: number) => ({
  timing: { startTime: '2026-12-06T10:00:00Z', endTime: '2026-12-06T10:03:00Z', duration: 180 },
  touches: Array.from({ length: n }, (_, i) => ({
    id: `x-${i}-sim-t`,
    fencerId,
    zone: 'A',
    points: 1,
    timestamp: '2026-12-06T10:01:00Z',
    matchId: 'ignoré',
  })),
  cards: [
    {
      id: 'x-0-sim-c',
      fencerId,
      cardType: 'yellow',
      reason: 'R1',
      cardGroup: 1,
      timestamp: '2026-12-06T10:02:00Z',
      pointsAwarded: 0,
    },
  ],
});

d('événements simulés (replaceSimulatedMatchEvents)', () => {
  it('remplace touches, cartons et durée ; null efface ; rien au journal', async () => {
    const { a, matchId } = poolWithMatch();
    const simId = (s: string) => s.replace('x-', `${matchId}-`);
    const ev = events(a.id, 3);
    ev.touches.forEach(t => (t.id = simId(t.id)));
    ev.cards.forEach(c => (c.id = simId(c.id)));
    const revision = db.eventLog.getRevision(competitionId);

    expect(await q('replaceSimulatedMatchEvents', { competitionId, matchId, events: ev })).toEqual({
      found: true,
    });
    expect(db.getTouches(matchId)).toHaveLength(3);
    expect(db.getTouches(matchId)[0]).toMatchObject({ fencerId: a.id, zone: 'A' });
    expect(db.getCards(matchId)).toHaveLength(1);
    expect(durationOf(matchId)).toBe(180);

    // Remplacement : anciennes lignes simulées effacées
    const one = events(a.id, 1);
    one.touches.forEach(t => (t.id = simId(t.id)));
    one.cards = [];
    await q('replaceSimulatedMatchEvents', { competitionId, matchId, events: one });
    expect(db.getTouches(matchId)).toHaveLength(1);
    expect(db.getCards(matchId)).toHaveLength(0);

    await q('replaceSimulatedMatchEvents', { competitionId, matchId, events: null });
    expect(db.getTouches(matchId)).toHaveLength(0);
    expect(durationOf(matchId)).toBeNull();
    expect(db.eventLog.getRevision(competitionId)).toBe(revision);
  });

  it('match absent : found faux ; épreuve inconnue ou entrée invalide refusées', async () => {
    expect(
      await q('replaceSimulatedMatchEvents', { competitionId, matchId: 'absent', events: null })
    ).toEqual({ found: false });
    await expect(
      q('replaceSimulatedMatchEvents', { competitionId: 'inconnue', matchId: 'm', events: null })
    ).rejects.toMatchObject({ code: 'competition_not_found' });
    await expect(
      q('replaceSimulatedMatchEvents', { competitionId, matchId: 'm' })
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });
});
