/**
 * Inscription des arbitres (docs/adr/0018) : commandes du contrat sur une base SQLite réelle.
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

d('inscription des arbitres (docs/adr/0018)', () => {
  it('registerReferees : non pointés, doublons signalés ; listReferees', async () => {
    const r = await call('registerReferees', {
      referees: [
        { firstName: 'Ana', lastName: 'Dupont', license: 'A1', category: 'National' },
        { lastName: 'Martin', nationality: 'bel', gender: 'F' },
      ],
    });
    expect(r.referees).toHaveLength(2);
    expect(r.referees[0]).toMatchObject({
      firstName: 'Ana',
      lastName: 'Dupont',
      license: 'A1',
      status: 'unavailable',
    });
    expect(r.referees[1]).toMatchObject({ nationality: 'BEL', gender: 'F' });
    expect(changes).toContain('referees');
    const dup = await call('registerReferees', {
      referees: [{ firstName: 'Bob', lastName: 'Autre', license: 'a1' }],
      dryRun: true,
    });
    expect(dup.duplicates).toEqual([{ index: 0, refereeId: r.referees[0].id }]);
    const list = (await invoke(ctx, 'listReferees' as never, { competitionId } as never)) as any[];
    expect(list).toHaveLength(2);
  });

  it('updateRefereeDetails, setRefereeAvailability, unregisterReferee', async () => {
    const [a, b] = (
      await call('registerReferees', {
        referees: [
          { firstName: 'Ana', lastName: 'Dupont', club: 'Paris' },
          { firstName: 'Léo', lastName: 'Martin' },
        ],
      })
    ).referees;
    const u = await call('updateRefereeDetails', {
      refereeId: a.id,
      details: { lastName: 'Durand', club: null },
    });
    expect(u.referee).toMatchObject({ firstName: 'Ana', lastName: 'Durand', club: null });
    await expect(
      call('updateRefereeDetails', { refereeId: a.id, details: { status: 'available' } })
    ).rejects.toMatchObject({ code: 'invalid_input' });

    const av = await call('setRefereeAvailability', {
      refereeIds: [a.id, b.id, 'inconnu'],
      available: true,
    });
    expect(av).toMatchObject({ status: 'available', updated: 2, unknown: ['inconnu'] });

    await call('unregisterReferee', { refereeId: b.id });
    expect(db.getRefereesByCompetition(competitionId).map(r => r.id)).toEqual([a.id]);
    await expect(call('unregisterReferee', { refereeId: b.id })).rejects.toMatchObject({
      code: 'referee_not_found',
    });
  });

  it('unregisterReferee : refusé pour l’arbitre d’un match en cours', async () => {
    const [a] = (await call('registerReferees', { referees: [{ lastName: 'Dupont' }] })).referees;
    db.saveSessionState(competitionId, {
      pools: [
        {
          id: 'p1',
          matches: [{ id: 'm1', status: 'in_progress', referee: { id: a.id } }],
        },
      ],
    });
    await expect(call('unregisterReferee', { refereeId: a.id })).rejects.toMatchObject({
      code: 'referee_busy',
    });
  });
});
