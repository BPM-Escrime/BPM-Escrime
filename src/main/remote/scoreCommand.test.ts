/**
 * Fin de match distante par recordScore (#1980, ADR-0005), base SQLite réelle :
 * tablette et appareil de piste écrivent par le moteur ; tout refus est rendu, sans repli (#2151).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '../../database';
import { hasNodeSqlite } from '../../database/testing/nodeSqliteDatabase';
import { Category, FencerStatus, Gender, Weapon } from '../../shared/types';
import { buildDefaultCompetitionSettings } from '../../shared/utils/defaultCompetitionSettings';
import { buildBracket, generatePools, listMatches } from '../engine/commands/sport';
import {
  checkFinishedScore,
  recordFinishedScore,
  reinstateByCommand,
  sessionMatchId,
} from './scoreCommand';

vi.mock('better-sqlite3-multiple-ciphers', async () => ({
  default: (await import('../../database/testing/nodeSqliteDatabase')).NodeSqliteDatabase,
}));
const emitted: Array<[string, string | undefined]> = [];
vi.mock('../ipc/dbHandlers', () => ({
  emitCompetitionEvent: (type: string, id?: string) => emitted.push([type, id]),
}));

const d = hasNodeSqlite ? describe : describe.skip;
let db: DatabaseManager;
const last = <T>(list: T[]): T => list[list.length - 1];

function setup(fencerCount: number) {
  const comp = db.createCompetition({
    title: 'Test',
    date: new Date('2026-12-06'),
    weapon: Weapon.EPEE,
    gender: Gender.MALE,
    category: Category.SENIOR,
    settings: buildDefaultCompetitionSettings({ weapon: Weapon.EPEE, category: Category.SENIOR }),
  });
  for (let i = 0; i < fencerCount; i++) {
    db.addFencer(comp.id, {
      lastName: `NOM${i}`,
      firstName: `P${i}`,
      club: `C${i}`,
      ranking: i + 1,
      status: FencerStatus.CHECKED_IN,
    });
  }
  return comp;
}

beforeEach(async () => {
  db = new DatabaseManager(':memory:');
  await db.open(':memory:');
  emitted.length = 0;
});
afterEach(() => db.close());

describe('sessionMatchId', () => {
  it('retire le préfixe composite des matchs de tableau', () => {
    expect(sessionMatchId('c1', 'c1-16-0')).toBe('16-0');
    expect(sessionMatchId('c1', 'abc')).toBe('abc');
  });
});

d('recordFinishedScore', () => {
  it('tablette : session, journal (identifiant de l’arbitre), audit (nom, adresse)', () => {
    const comp = setup(4);
    const ctx = { db };
    generatePools(ctx, comp.id, { poolCount: 1 });
    const m = listMatches(ctx, comp.id, { state: 'ready' })[0];
    expect(
      recordFinishedScore(db, {
        competitionId: comp.id,
        matchId: m.matchId,
        scoreA: 5,
        scoreB: 2,
        winner: 'A',
        source: 'tablet',
        author: 'ref-1',
        audit: { refereeName: 'Anne ARBITRE', ipAddress: '10.0.0.7', reason: 'pool_remote_entry' },
      })
    ).toEqual({ kind: 'accepted' });
    expect(listMatches(ctx, comp.id).find(x => x.matchId === m.matchId)?.state).toBe('done');
    const event = db.eventLog.getSince(comp.id, 0).find(e => e.type === 'ScoreRecorded');
    expect(event).toMatchObject({ type: 'ScoreRecorded', source: 'tablet', author: 'ref-1' });
    const audit = last(db.getScoreAuditLog(m.matchId))!;
    expect(audit).toMatchObject({ changedBy: 'Anne ARBITRE', ipAddress: '10.0.0.7' });
    expect(emitted).toContainEqual(['session:changed', comp.id]);
  });

  it('appareil de piste : match de tableau par son identifiant composite', () => {
    const comp = setup(4);
    const ctx = { db };
    generatePools(ctx, comp.id, { poolCount: 1 });
    for (const m of listMatches(ctx, comp.id, { state: 'ready' })) {
      recordFinishedScore(db, {
        competitionId: comp.id,
        matchId: m.matchId,
        scoreA: 5,
        scoreB: 1,
        winner: 'A',
        source: 'tablet',
      });
    }
    buildBracket(ctx, comp.id, { thirdPlaceMatch: false });
    const semi = listMatches(ctx, comp.id, { state: 'ready' })[0];
    expect(
      recordFinishedScore(db, {
        competitionId: comp.id,
        matchId: `${comp.id}-${semi.matchId}`,
        scoreA: 15,
        scoreB: 9,
        winner: 'A',
        source: 'cyrano',
      })
    ).toEqual({ kind: 'accepted' });
    expect(last(db.eventLog.getSince(comp.id, 0))?.source).toBe('cyrano');
    expect(last(db.getScoreAuditLog(`${comp.id}-${semi.matchId}`))?.changedBy).toBe('device');
  });

  it('match inconnu, sans épreuve, règle : refus rendu, rien d’écrit (#2151, étape 3)', () => {
    const comp = setup(4);
    generatePools({ db }, comp.id, { poolCount: 1 });
    const m = listMatches({ db }, comp.id, { state: 'ready' })[0];
    const base = { matchId: m.matchId, scoreA: 5, scoreB: 2, winner: 'A' as const };
    expect(recordFinishedScore(db, { ...base, competitionId: null, source: 'tablet' })).toEqual({
      kind: 'refused',
      code: 'competition_not_found',
      message: 'Aucune épreuve en cours',
    });
    expect(
      recordFinishedScore(db, { ...base, competitionId: comp.id, matchId: 'x', source: 'tablet' })
    ).toMatchObject({ kind: 'refused', code: 'match_not_found' });
    expect(
      recordFinishedScore(db, { ...base, competitionId: 'absente', source: 'tablet' })
    ).toMatchObject({ kind: 'refused', code: 'competition_not_found' });
    // Score hors bornes : refusé, plus de repli qui l'écrirait quand même
    expect(
      recordFinishedScore(db, { ...base, scoreA: 9, competitionId: comp.id, source: 'tablet' })
    ).toMatchObject({ kind: 'refused', code: 'score_above_max' });
    db.updateCompetition(comp.id, { isTeamEvent: true } as never);
    expect(
      recordFinishedScore(db, { ...base, competitionId: comp.id, source: 'tablet' })
    ).toMatchObject({ kind: 'refused', code: 'unsupported_format' });
    expect(db.eventLog.getRevision(comp.id)).toBe(1); // PoolsGenerated seul
  });

  it('contrôle sans écriture (appareil de piste) : refus motivé, rien au journal', () => {
    const comp = setup(4);
    generatePools({ db }, comp.id, { poolCount: 1 });
    const m = listMatches({ db }, comp.id, { state: 'ready' })[0];
    const base = { competitionId: comp.id, matchId: m.matchId, source: 'cyrano' as const };
    expect(checkFinishedScore(db, { ...base, scoreA: 9, scoreB: 2, winner: 'A' })).toMatchObject({
      kind: 'refused',
      code: 'score_above_max',
    });
    expect(checkFinishedScore(db, { ...base, scoreA: 5, scoreB: 2, winner: 'A' })).toEqual({
      kind: 'accepted',
    });
    expect(db.eventLog.getRevision(comp.id)).toBe(1); // PoolsGenerated seul
    expect(listMatches({ db }, comp.id).find(x => x.matchId === m.matchId)?.state).toBe('ready');
  });

  it('carton noir de la tablette : score et exclusion en une commande, annulation par le moteur', () => {
    const comp = setup(5);
    generatePools({ db }, comp.id, { poolCount: 1 });
    const m = listMatches({ db }, comp.id, { state: 'ready' })[0];
    const culprit = m.fencerB!.id;
    expect(
      recordFinishedScore(db, {
        competitionId: comp.id,
        matchId: m.matchId,
        scoreA: 2,
        scoreB: 3,
        winner: 'A',
        source: 'tablet',
        specialStatus: 'exclusion',
        blackCard: true,
      })
    ).toEqual({ kind: 'accepted' });
    expect(db.getFencer(culprit)).toMatchObject({ status: 'X', exclusionReason: 'black_card' });
    const types = db.eventLog.getSince(comp.id, 1).map(e => e.type);
    expect(types).toEqual(['ScoreRecorded', 'FencerWithdrawn']);
    const lost = () =>
      listMatches({ db }, comp.id).filter(
        x => (x.fencerA?.id === culprit || x.fencerB?.id === culprit) && x.state === 'done'
      ).length;
    expect(lost()).toBe(4);

    expect(reinstateByCommand(db, comp.id, culprit)).toBe(true);
    expect(db.getFencer(culprit)?.status).toBe('P');
    expect(lost()).toBe(0);
    expect(last(db.eventLog.getSince(comp.id, 0))).toMatchObject({
      type: 'FencerReinstated',
      source: 'tablet',
    });
    // Rien à annuler : refusé
    expect(reinstateByCommand(db, comp.id, culprit)).toBe(false);
  });
});
