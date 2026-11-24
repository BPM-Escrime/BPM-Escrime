/**
 * Durées de match du poste par le contrat (#1965, lot 3), base SQLite réelle : réglage du DT,
 * changement de piste, historique d'une épreuve, réinitialisation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '../../../database';
import { hasNodeSqlite } from '../../../database/testing/nodeSqliteDatabase';
import type { OperationName } from '../../../shared/api/contract';
import { ApiError } from '../../../shared/api/client';
import { Category, Gender, Weapon } from '../../../shared/types';
import { buildDefaultCompetitionSettings } from '../../../shared/utils/defaultCompetitionSettings';
import type { CommandContext } from './context';
import { invoke } from '../api/engine';

vi.mock('better-sqlite3-multiple-ciphers', async () => ({
  default: (await import('../../../database/testing/nodeSqliteDatabase')).NodeSqliteDatabase,
}));

const d = hasNodeSqlite ? describe : describe.skip;
const MIN = 60_000;

let db: DatabaseManager;
let ctx: CommandContext;

beforeEach(async () => {
  db = new DatabaseManager(':memory:');
  await db.open(':memory:');
  ctx = { db };
});
afterEach(() => db.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const op = (name: OperationName, input: Record<string, unknown> = {}) =>
  invoke(ctx, name, input) as Promise<any>;

const row = (
  view: { rows: Array<{ key: { weapon: string; phase: string } }> },
  w: string,
  p: string
) =>
  view.rows.find(r => r.key.weapon === w && r.key.phase === p) as
    { reference: { medianMs: number; basis: string }; override: unknown } | undefined;

d('Durées de match du poste (#1965)', () => {
  it('sans donnée : valeurs par défaut (poule d’épée 3:30, tableau de sabre 8:00)', async () => {
    const view = await op('getMatchDurations');
    expect(view.changeoverMs).toBe(MIN);
    expect(view.competitions).toBe(0);
    expect(row(view, 'E', 'pool')?.reference).toMatchObject({
      medianMs: 3.5 * MIN,
      basis: 'default',
    });
    expect(row(view, 'S', 'tableau')?.reference.medianMs).toBe(8 * MIN);
  });

  it('réglage du DT : l’emporte, puis retiré ; changement de piste enregistré', async () => {
    const key = { weapon: 'S', phase: 'tableau', maxScore: 15, gender: 'F' };
    let view = await op('updateMatchDurationSettings', {
      changeoverMs: 2 * MIN,
      override: { key, medianMs: 7 * MIN },
    });
    expect(view.changeoverMs).toBe(2 * MIN);
    const set = view.rows.find((r: { key: { gender?: string } }) => r.key.gender === 'F');
    expect(set.reference).toMatchObject({ medianMs: 7 * MIN, basis: 'setting' });
    expect(db.settings.getSetting('matchDurations').overrides).toHaveLength(1);

    view = await op('updateMatchDurationSettings', { override: { key, medianMs: null } });
    expect(view.rows.some((r: { key: { gender?: string } }) => r.key.gender === 'F')).toBe(false);
    expect(view.changeoverMs).toBe(2 * MIN);
  });

  it('refuse une durée hors bornes (schéma)', async () => {
    const e = await op('updateMatchDurationSettings', {
      override: { key: { weapon: 'E', phase: 'pool', maxScore: 5 }, medianMs: 1000 },
    }).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(ApiError);
  });

  it('historique : épreuve sans match mesuré, épreuve inconnue refusée, réinitialisation', async () => {
    const c = db.createCompetition({
      title: 'Open',
      date: new Date('2026-12-06'),
      weapon: Weapon.EPEE,
      gender: Gender.MALE,
      category: Category.SENIOR,
      settings: buildDefaultCompetitionSettings({ weapon: Weapon.EPEE, category: Category.SENIOR }),
    });
    expect(await op('recordMatchDurationHistory', { competitionId: c.id })).toEqual({
      samples: 0,
      keys: 0,
    });
    const e = await op('recordMatchDurationHistory', { competitionId: 'inconnue' }).catch(
      (err: unknown) => err
    );
    expect((e as ApiError).code).toBe('competition_not_found');

    db.settings.updateSettings({
      matchDurations: {
        overrides: [],
        history: {
          [c.id]: [
            { key: { weapon: 'E', phase: 'pool', maxScore: 5 }, medianMs: 4 * MIN, samples: 40 },
          ],
        },
        changeoverMs: MIN,
      },
    });
    let view = await op('getMatchDurations');
    expect(view.competitions).toBe(1);
    expect(row(view, 'E', 'pool')?.reference).toMatchObject({
      medianMs: 4 * MIN,
      basis: 'history',
    });
    view = await op('resetMatchDurationHistory');
    expect(view.competitions).toBe(0);
    expect(row(view, 'E', 'pool')?.reference.basis).toBe('default');
  });
});
