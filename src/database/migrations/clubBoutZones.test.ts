/**
 * Migration 51 (docs/adr/0031) sur une base SQLite réelle (node:sqlite) : colonnes
 * club_bouts.zones_a / zones_b, combats existants gardés avec des zones nulles.
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

const V51 = ALL_MIGRATIONS.find(m => m.version === 51)!;

describe.skipIf(!DatabaseSync)('migration 51 : zones de touche des combats du club', () => {
  let db: SqliteDb;
  const run = (s: string) => db.exec(s);
  const all = <T>(sql: string) => db.prepare(sql).all() as T[];

  beforeEach(() => {
    db = new DatabaseSync!(':memory:');
    run('PRAGMA foreign_keys = ON');
    for (const m of ALL_MIGRATIONS.filter(m => m.version < 51)) m.up({ run });
  });

  it('base 50 : combat existant gardé, zones nulles, puis écrites', () => {
    db.prepare(
      `INSERT INTO club_bouts (id, session_id, date, member_a_id, member_b_id, score_a, score_b,
         status, created_at, updated_at) VALUES ('b1', 's1', '2026-11-16', 'a', 'b', 5, 3, 'finished', 'x', 'x')`
    ).run();
    V51.up({ run });
    expect(all('SELECT id, score_a, zones_a, zones_b FROM club_bouts')).toEqual([
      { id: 'b1', score_a: 5, zones_a: null, zones_b: null },
    ]);
    run(`UPDATE club_bouts SET zones_a = 'ACB', zones_b = 'B' WHERE id = 'b1'`);
    expect(all('SELECT zones_a, zones_b FROM club_bouts')).toEqual([
      { zones_a: 'ACB', zones_b: 'B' },
    ]);
  });

  it('rejouée sans erreur (colonnes déjà présentes)', () => {
    V51.up({ run });
    expect(() => V51.up({ run })).not.toThrow();
  });
});
