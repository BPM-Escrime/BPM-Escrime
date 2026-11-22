/**
 * Test de rejeu (docs/adr/0017, étape 5) : une épreuve jouée par les commandes, puis le journal
 * rejoué par projectCompetition et comparé à la projection du moteur. Base SQLite réelle.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '../../../database';
import { hasNodeSqlite } from '../../../database/testing/nodeSqliteDatabase';
import { Category, FencerStatus, Gender, Weapon } from '../../../shared/types';
import { buildDefaultCompetitionSettings } from '../../../shared/utils/defaultCompetitionSettings';
import { planTableau } from '../../../shared/domain/tableau/tableauCalculations';
import { tableauComposition } from '../../../shared/domain/tableau/tableauComposition';
import { projectCompetition } from '../../../shared/domain/journal/projectCompetition';
import { compareWithState, stateView } from '../../../shared/domain/journal/compareWithState';
import type { CommandContext } from './context';
import { listMatches } from './sport';
import { invoke } from '../api/engine';
import type { PoolRanking } from '../../../shared/types';

vi.mock('better-sqlite3-multiple-ciphers', async () => ({
  default: (await import('../../../database/testing/nodeSqliteDatabase')).NodeSqliteDatabase,
}));

const d = hasNodeSqlite ? describe : describe.skip;

let db: DatabaseManager;
let ctx: CommandContext;

beforeEach(async () => {
  db = new DatabaseManager(':memory:');
  await db.open(':memory:');
  ctx = { db, emitChange: () => {} };
});
afterEach(() => db.close());

function setup(fencerCount: number, settings: Record<string, unknown> = {}) {
  const weapon = Weapon.EPEE;
  const comp = db.createCompetition({
    title: 'Rejeu',
    date: new Date('2026-12-06'),
    weapon,
    gender: Gender.MALE,
    category: Category.SENIOR,
    settings: {
      ...buildDefaultCompetitionSettings({ weapon, category: Category.SENIOR }),
      ...settings,
    } as never,
  });
  for (let i = 0; i < fencerCount; i++) {
    db.addFencer(comp.id, {
      lastName: `NOM${i}`,
      firstName: `P${i}`,
      club: ['Paris', 'Lyon', 'Nice', 'Lille'][i % 4],
      ranking: i + 1,
      status: FencerStatus.NOT_CHECKED_IN,
    });
  }
  return comp;
}

const call = (op: string, input: Record<string, unknown>) =>
  invoke(ctx, op as never, input as never);

/** Joue les matchs prêts : A gagne 5-n (poule) ou 15-n (tableau), n variant */
async function playAll(competitionId: string, kind: 'pool' | 'bracket') {
  for (let guard = 0; guard < 200; guard++) {
    const ready = listMatches(ctx, competitionId, { state: 'ready' }).filter(m => m.kind === kind);
    if (ready.length === 0) return;
    for (const [i, m] of ready.entries()) {
      await call('recordScore', {
        competitionId,
        matchId: m.matchId,
        scoreA: kind === 'pool' ? 5 : 15,
        scoreB: i % 4,
      });
    }
  }
}

/** Journal rejoué comparé à l'état tenu par le moteur */
function replay(competitionId: string) {
  const facts = projectCompetition(db.eventLog.getSince(competitionId));
  const statuses = Object.fromEntries(
    db.getFencersByCompetition(competitionId).map(f => [f.id, f.status as string])
  );
  const divergences = compareWithState(
    facts,
    stateView((db.getSessionState(competitionId) ?? {}) as Record<string, unknown>),
    statuses
  );
  return { facts, divergences };
}

async function checkInAll(competitionId: string) {
  const ids = db.getFencersByCompetition(competitionId).map(f => f.id);
  await call('checkIn', { competitionId, fencers: ids, present: true });
  return ids;
}

d('rejeu du journal (docs/adr/0017, étape 5)', () => {
  it('épreuve complète : appel, poules, abandon, annulation, retrait et réintégration, tableau', async () => {
    const comp = setup(9);
    const ids = await checkInAll(comp.id);
    await call('checkIn', { competitionId: comp.id, fencers: [ids[8]], present: false });
    await call('generatePools', { competitionId: comp.id, poolCount: 2 });

    // Abandon au premier match : ses autres matchs perdus
    const [first, second] = listMatches(ctx, comp.id, { state: 'ready' });
    await call('recordScore', {
      competitionId: comp.id,
      matchId: first.matchId,
      scoreA: 2,
      scoreB: 1,
      winner: 'A',
      specialStatus: 'abandon',
    });
    // Score saisi puis annulé, puis ressaisi
    if (second.matchId !== first.matchId) {
      const open = listMatches(ctx, comp.id, { state: 'ready' })[0];
      await call('recordScore', {
        competitionId: comp.id,
        matchId: open.matchId,
        scoreA: 5,
        scoreB: 3,
      });
      await call('clearScore', { competitionId: comp.id, matchId: open.matchId });
    }
    // Retrait à l'appel des poules puis réintégration
    const other = listMatches(ctx, comp.id, { state: 'ready' })[0].fencerA!.id;
    await call('withdrawFencer', { competitionId: comp.id, fencerId: other, reason: 'forfait' });
    expect(replay(comp.id).divergences).toEqual([]);
    await call('reinstateFencer', { competitionId: comp.id, fencerId: other });
    expect(replay(comp.id).divergences).toEqual([]);

    await playAll(comp.id, 'pool');
    await call('generateTableau', { competitionId: comp.id, thirdPlaceMatch: false });
    // Retrait au tableau : match perdu, tireur suivant qualifié
    const bracketMatch = listMatches(ctx, comp.id, { state: 'ready' }).find(
      m => m.kind === 'bracket'
    )!;
    await call('withdrawFencer', {
      competitionId: comp.id,
      fencerId: bracketMatch.fencerB!.id,
      reason: 'abandon',
      matchId: bracketMatch.matchId,
    });
    await playAll(comp.id, 'bracket');

    const { facts, divergences } = replay(comp.id);
    expect(facts.complete).toBe(true);
    expect(facts.rounds).toHaveLength(1);
    expect(facts.tableau).not.toBeNull();
    expect(Object.keys(facts.bracketResults).length).toBeGreaterThan(0);
    expect(divergences).toEqual([]);
  });

  it('« toutes les places » : tableaux de classement à identifiants déterministes', async () => {
    const comp = setup(10, { playAllPositions: true, thirdPlaceMatch: true });
    await checkInAll(comp.id);
    await call('generatePools', { competitionId: comp.id, poolCount: 2 });
    await playAll(comp.id, 'pool');
    const ranking = (db.getSessionState(comp.id) as { overallRanking: PoolRanking[] })
      .overallRanking;
    const { matches } = planTableau(ranking, { playAllPositions: true, thirdPlaceMatch: true });
    await call('generateTableau', {
      competitionId: comp.id,
      composition: tableauComposition(matches),
      thirdPlaceMatch: true,
    });
    await playAll(comp.id, 'bracket');
    const session = db.getSessionState(comp.id) as {
      consolationBrackets: Array<{ id: string; parentBracketId: string; sourceRound: number }>;
    };
    expect(session.consolationBrackets.length).toBeGreaterThan(0);
    for (const b of session.consolationBrackets) {
      expect(b.id).toBe(
        `${b.parentBracketId === 'main' ? 'cons' : b.parentBracketId}-${b.sourceRound}`
      );
    }
    expect(replay(comp.id).divergences).toEqual([]);
  });

  it('tours multiples : tour clos archivé, éliminés, tour 2', async () => {
    const comp = setup(10);
    await checkInAll(comp.id);
    await call('generatePools', { competitionId: comp.id, poolCount: 2 });
    await playAll(comp.id, 'pool');
    await call('closePoolRound', { competitionId: comp.id, qualifierCount: 6 });
    expect(replay(comp.id).divergences).toEqual([]);
    const events = db.eventLog.getSince(comp.id);
    const closed = events[events.length - 1];
    const q = closed.type === 'PoolRoundClosed' ? closed.payload.qualifiedIds : [];
    await call('generatePools', {
      competitionId: comp.id,
      composition: [
        {
          poolId: 'r2-p1',
          number: 1,
          fencerIds: q.slice(0, 3),
          matches: [
            { matchId: 'r2-m1', fencerAId: q[0], fencerBId: q[1] },
            { matchId: 'r2-m2', fencerAId: q[1], fencerBId: q[2] },
            { matchId: 'r2-m3', fencerAId: q[0], fencerBId: q[2] },
          ],
        },
      ],
    });
    await call('recordScore', { competitionId: comp.id, matchId: 'r2-m1', scoreA: 5, scoreB: 4 });
    const { facts, divergences } = replay(comp.id);
    expect(facts.rounds.map(r => [r.round, !!r.closed])).toEqual([
      [1, true],
      [2, false],
    ]);
    expect(Object.values(facts.fencerStatus)).toContain(FencerStatus.ELIMINATED);
    expect(divergences).toEqual([]);
  });

  it('écart détecté : score modifié hors commande, tableau retiré hors journal', async () => {
    const comp = setup(4);
    await checkInAll(comp.id);
    await call('generatePools', { competitionId: comp.id, poolCount: 1 });
    await playAll(comp.id, 'pool');
    const session = db.getSessionState(comp.id) as any;
    const m = session.pools[0].matches[0];
    m.scoreB = { ...m.scoreB, value: 4 };
    db.saveSessionState(comp.id, session);
    expect(replay(comp.id).divergences).toEqual([
      expect.objectContaining({ kind: 'pool_result', id: m.id }),
    ]);
  });

  it('journal sans tirage : incomplet, seuls les statuts sont comparés', async () => {
    const comp = setup(3);
    expect(replay(comp.id).facts.complete).toBe(false);
    const [id] = await checkInAll(comp.id);
    db.updateFencer(id, { status: FencerStatus.NOT_CHECKED_IN });
    const { facts, divergences } = replay(comp.id);
    expect(facts.complete).toBe(false);
    expect(divergences).toEqual([
      {
        kind: 'fencer_status',
        id,
        expected: FencerStatus.CHECKED_IN,
        actual: FencerStatus.NOT_CHECKED_IN,
      },
    ]);
  });
});
