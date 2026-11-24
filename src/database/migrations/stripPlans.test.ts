/**
 * Migration 50 (docs/adr/0015, amendement du 2026-11-24) sur une base SQLite réelle
 * (node:sqlite) : table competition_strip_plans, piste de départ reprise de session_state
 * (entier de 1 à 999 seulement, épreuve existante), application sur une base vierge.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ALL_MIGRATIONS } from './migrations';

let DatabaseSync: (new (path: string) => SqliteDb) | null = null;
try {
  DatabaseSync = require('node:sqlite').DatabaseSync;
} catch {
  DatabaseSync = null;
}

interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): { all(...p: unknown[]): unknown[]; run(...p: unknown[]): unknown };
}

const V50 = ALL_MIGRATIONS.find(m => m.version === 50)!;

describe.skipIf(!DatabaseSync)('migration 50 : plan des pistes par épreuve', () => {
  let db: SqliteDb;
  const run = (s: string) => db.exec(s);
  const all = <T>(sql: string, ...p: unknown[]) => db.prepare(sql).all(...p) as T[];
  const competition = (id: string) =>
    run(`INSERT INTO competitions (id, title, date, weapon, gender, category, created_at, updated_at)
         VALUES ('${id}', '${id}', '2026-01-10', 'E', 'M', 'SENIOR', 'x', 'x')`);
  const session = (id: string, state: string) =>
    db
      .prepare(
        'INSERT INTO session_state (competition_id, state_json, updated_at) VALUES (?, ?, ?)'
      )
      .run(id, state, 'x');

  beforeEach(() => {
    db = new DatabaseSync!(':memory:');
    run('PRAGMA foreign_keys = ON');
    for (const m of ALL_MIGRATIONS.filter(m => m.version < 50)) m.up({ run });
  });

  it('base 49 : piste de départ reprise de session_state, valeurs invalides ignorées', () => {
    for (const id of ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']) competition(id);
    session('c1', JSON.stringify({ remoteStripStart: 5, pools: [] }));
    session('c2', JSON.stringify({ pools: [] }));
    session('c3', JSON.stringify({ remoteStripStart: 0 }));
    session('c4', JSON.stringify({ remoteStripStart: 2.5 }));
    session('c5', 'pas du JSON');
    session('c6', JSON.stringify({ remoteStripStart: '7' }));
    // État orphelin (épreuve supprimée sans cascade) : pas de plan
    session('ghost', JSON.stringify({ remoteStripStart: 3 }));

    V50.up({ run });

    const rows = all<{ competition_id: string; start: number; unavailable: string }>(
      'SELECT competition_id, start, unavailable FROM competition_strip_plans ORDER BY competition_id'
    );
    expect(rows).toEqual([{ competition_id: 'c1', start: 5, unavailable: '[]' }]);
    const [{ updated_at }] = all<{ updated_at: string }>(
      'SELECT updated_at FROM competition_strip_plans'
    );
    expect(updated_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  });

  it('base vierge : table créée, vide, valeurs par défaut', () => {
    V50.up({ run });
    expect(all('SELECT * FROM competition_strip_plans')).toEqual([]);
    competition('c1');
    run(
      `INSERT INTO competition_strip_plans (competition_id, updated_at) VALUES ('c1', '2026-01-10')`
    );
    expect(all('SELECT start, unavailable FROM competition_strip_plans')).toEqual([
      { start: 1, unavailable: '[]' },
    ]);
  });

  it('rejouée sur une base déjà migrée : sans effet', () => {
    competition('c1');
    session('c1', JSON.stringify({ remoteStripStart: 4 }));
    V50.up({ run });
    run(`UPDATE competition_strip_plans SET start = 9`);
    V50.up({ run });
    expect(all('SELECT start FROM competition_strip_plans')).toEqual([{ start: 9 }]);
  });
});
