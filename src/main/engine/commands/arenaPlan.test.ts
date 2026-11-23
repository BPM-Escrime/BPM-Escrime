/**
 * Plan de salle du planificateur enregistré sur l'épreuve (docs/adr/0025), base SQLite réelle.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '../../../database';
import { hasNodeSqlite } from '../../../database/testing/nodeSqliteDatabase';
import { Category, Gender, Weapon } from '../../../shared/types';
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
    title: 'Plan',
    date: new Date('2026-12-06'),
    weapon: Weapon.LASER,
    gender: Gender.MIXED,
    category: Category.SENIOR,
  }).id;
});
afterEach(() => db.close());

const call = (op: string, input: Record<string, unknown>) =>
  invoke(ctx, op as never, { competitionId, ...input } as never) as Promise<any>;

const plan = {
  version: 1,
  activeRoomId: 'room-2',
  rooms: [
    {
      id: 'room-1',
      name: 'Gymnase',
      width: '30',
      length: '20,5',
      arenas: '2',
      margin: '1',
      spacing: 'spread',
      align: 'center',
      items: [
        {
          id: 'item-1',
          kind: 'table',
          label: 'DT',
          x: 1,
          y: 2,
          widthM: 2,
          heightM: 1,
          rotationDeg: 90,
        },
      ],
      manual: {
        key: '30|20,5|2|1|spread|center',
        centers: [
          { x: 7, y: 7 },
          { x: 20, y: 7 },
        ],
      },
      x: 0,
      y: 0,
    },
    {
      id: 'room-2',
      name: 'Annexe',
      width: '20',
      length: '20',
      arenas: '1',
      margin: '1',
      spacing: 'packed',
      align: 'left',
      items: [],
      manual: null,
      x: 33,
      y: 0,
    },
  ],
};

d('plan de salle de l’épreuve (docs/adr/0025)', () => {
  it('aucun plan : null', async () => {
    expect(await call('getArenaPlan', {})).toBeNull();
  });

  it('saveArenaPlan puis getArenaPlan : plan relu à l’identique ; null l’efface', async () => {
    expect(await call('saveArenaPlan', { plan })).toMatchObject({ dryRun: false, competitionId });
    expect(await call('getArenaPlan', {})).toEqual(plan);
    await call('saveArenaPlan', { plan: null });
    expect(await call('getArenaPlan', {})).toBeNull();
  });

  it('dryRun : rien n’est écrit', async () => {
    await call('saveArenaPlan', { plan, dryRun: true });
    expect(await call('getArenaPlan', {})).toBeNull();
  });

  it('le plan survit aux écritures de l’état de session et des réglages', async () => {
    await call('saveArenaPlan', { plan });
    db.saveSessionState(competitionId, { currentPhase: 0, pools: [] });
    db.updateCompetition(competitionId, { title: 'Plan renommé', settings: {} as never });
    expect(await call('getArenaPlan', {})).toEqual(plan);
  });

  it('plan invalide ou épreuve inconnue refusés', async () => {
    await expect(
      call('saveArenaPlan', { plan: { ...plan, rooms: [{ ...plan.rooms[0], spacing: 'x' }] } })
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      invoke(ctx, 'getArenaPlan' as never, { competitionId: 'inconnue' } as never)
    ).rejects.toMatchObject({ code: 'competition_not_found' });
  });
});
