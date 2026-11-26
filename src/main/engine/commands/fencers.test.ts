/**
 * Inscription des tireurs (docs/adr/0018) : commandes du contrat sur une base SQLite réelle.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '../../../database';
import { hasNodeSqlite } from '../../../database/testing/nodeSqliteDatabase';
import { Category, FencerStatus, Gender, Weapon } from '../../../shared/types';
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

d('inscription des tireurs (docs/adr/0018)', () => {
  it('registerFencers : inscrit, statut pointé admis, doublons signalés', async () => {
    const r = await call('registerFencers', {
      fencers: [
        {
          lastName: 'Dupont',
          firstName: 'Ana',
          license: 'L1',
          status: 'P',
          birthDate: '2001-04-05',
        },
        { lastName: 'Martin', firstName: 'Léo', ranking: 3 },
      ],
    });
    expect(r.fencers).toHaveLength(2);
    expect(r.fencers[0]).toMatchObject({
      ref: 1,
      status: FencerStatus.CHECKED_IN,
      nationality: 'FRA',
    });
    expect(r.fencers[0].birthDate).toMatch(/^2001-04-05/);
    expect(r.fencers[1]).toMatchObject({ status: FencerStatus.NOT_CHECKED_IN, ranking: 3 });
    expect(changes).toContain('fencers');

    const again = await call('registerFencers', {
      fencers: [
        { lastName: 'DUPONT', firstName: 'Bea', license: 'l1' },
        { lastName: 'martin', firstName: 'Leo' },
      ],
      dryRun: true,
    });
    expect(again.duplicates.map((x: { index: number }) => x.index)).toEqual([0, 1]);
    expect(db.getFencersByCompetition(competitionId)).toHaveLength(2);
  });

  it('updateFencerDetails : identité seulement, champ effacé par null', async () => {
    const [f] = (
      await call('registerFencers', {
        fencers: [{ lastName: 'Dupont', firstName: 'Ana', club: 'Paris', ranking: 2 }],
      })
    ).fencers;
    const r = await call('updateFencerDetails', {
      fencerId: f.id,
      details: { club: null, nationality: 'bel', birthDate: '1999-01-02' },
    });
    expect(r.fencer).toMatchObject({ club: null, nationality: 'BEL', ranking: 2 });
    expect(r.fencer.birthDate).toMatch(/^1999-01-02/);
    // Statut et classement hors du schéma : refusés à l'entrée
    await expect(
      call('updateFencerDetails', { fencerId: f.id, details: { status: 'Q' } })
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      call('updateFencerDetails', { fencerId: 'inconnu', details: { club: 'X' } })
    ).rejects.toMatchObject({ code: 'fencer_not_found' });
  });

  it('catégorie du tireur (docs/adr/0039) : inscrite, modifiée, effacée, refusée hors codes', async () => {
    const [f] = (
      await call('registerFencers', {
        fencers: [{ lastName: 'Durand', firstName: 'Max', category: 'V2' }],
      })
    ).fencers;
    expect(f.category).toBe('V2');
    expect(db.getFencer(f.id)?.category).toBe('V2');
    const r = await call('updateFencerDetails', { fencerId: f.id, details: { category: 'V3' } });
    expect(r.fencer.category).toBe('V3');
    const cleared = await call('updateFencerDetails', {
      fencerId: f.id,
      details: { category: null },
    });
    expect(cleared.fencer.category).toBeNull();
    await expect(
      call('updateFencerDetails', { fencerId: f.id, details: { category: 'M17' } })
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('setFencerRankings et unregisterFencers : avant le tirage seulement', async () => {
    const created = (
      await call('registerFencers', {
        fencers: ['A', 'B', 'C', 'D', 'E'].map((n, i) => ({
          lastName: n,
          firstName: n,
          status: 'P',
          ranking: i + 1,
        })),
      })
    ).fencers;
    const r = await call('setFencerRankings', {
      rankings: [
        { fencerId: created[0].id, ranking: 4 },
        { fencerId: created[3].id, ranking: null },
        { fencerId: 'inconnu', ranking: 1 },
      ],
    });
    expect(r).toMatchObject({ updated: 2, unknown: ['inconnu'] });
    expect(db.getFencer(created[3].id)?.ranking ?? null).toBeNull();

    const removed = await call('unregisterFencers', { fencerIds: [created[1].id] });
    expect(removed.removed).toEqual([created[1].id]);
    expect(db.getFencersByCompetition(competitionId)).toHaveLength(4);

    await call('generatePools', { poolCount: 1 });
    await expect(
      call('setFencerRankings', { rankings: [{ fencerId: created[0].id, ranking: 1 }] })
    ).rejects.toMatchObject({ code: 'draw_done' });
    await expect(call('unregisterFencers', { all: true })).rejects.toMatchObject({
      code: 'draw_done',
    });
  });

  it('listFencers : ordre des dossards, dates ISO', async () => {
    await call('registerFencers', {
      fencers: [
        { lastName: 'B', firstName: 'B' },
        { lastName: 'A', firstName: 'A', birthDate: '2000-02-03' },
      ],
    });
    const list = (await invoke(ctx, 'listFencers' as never, { competitionId } as never)) as any[];
    expect(list.map(f => f.ref)).toEqual([1, 2]);
    expect(typeof list[1].birthDate).toBe('string');
  });
});
