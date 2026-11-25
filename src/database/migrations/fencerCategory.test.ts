/**
 * Migration 53 (docs/adr/0039) sur une base SQLite réelle (node:sqlite) : colonne
 * fencers.category, tireurs existants gardés avec une catégorie nulle.
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

const V53 = ALL_MIGRATIONS.find(m => m.version === 53)!;

describe.skipIf(!DatabaseSync)('migration 53 : catégorie du tireur', () => {
  let db: SqliteDb;
  const run = (s: string) => db.exec(s);
  const all = <T>(sql: string) => db.prepare(sql).all() as T[];

  beforeEach(() => {
    db = new DatabaseSync!(':memory:');
    run('PRAGMA foreign_keys = OFF');
    for (const m of ALL_MIGRATIONS.filter(m => m.version < 53)) m.up({ run });
  });

  it('base 52 : tireur existant gardé, catégorie nulle, puis écrite', () => {
    db.prepare(
      `INSERT INTO fencers (id, competition_id, ref, last_name, first_name, gender, nationality,
         status, created_at, updated_at) VALUES ('f1', 'c1', 1, 'DUPONT', 'Ana', 'F', 'FRA', 'N', 'x', 'x')`
    ).run();
    V53.up({ run });
    expect(all('SELECT id, last_name, category FROM fencers')).toEqual([
      { id: 'f1', last_name: 'DUPONT', category: null },
    ]);
    run(`UPDATE fencers SET category = 'V1' WHERE id = 'f1'`);
    expect(all('SELECT category FROM fencers')).toEqual([{ category: 'V1' }]);
  });

  it('rejouée sans erreur (colonne déjà présente)', () => {
    V53.up({ run });
    expect(() => V53.up({ run })).not.toThrow();
  });
});
