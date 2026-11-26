/**
 * Migration 54 (docs/adr/0043) sur une base SQLite réelle (node:sqlite) : colonnes
 * fencers.members, fencers.level, fencers.handicap, tireurs existants gardés avec des valeurs nulles.
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

const V54 = ALL_MIGRATIONS.find(m => m.version === 54)!;

describe.skipIf(!DatabaseSync)('migration 54 : entrée en équipes (binômes)', () => {
  let db: SqliteDb;
  const run = (s: string) => db.exec(s);
  const all = <T>(sql: string) => db.prepare(sql).all() as T[];

  beforeEach(() => {
    db = new DatabaseSync!(':memory:');
    run('PRAGMA foreign_keys = OFF');
    for (const m of ALL_MIGRATIONS.filter(m => m.version < 54)) m.up({ run });
  });

  it('cite l’ADR-0043 dans sa description', () => {
    expect(V54.description).toContain('docs/adr/0043');
  });

  it('base 53 : tireur existant gardé, colonnes nulles, puis écrites', () => {
    db.prepare(
      `INSERT INTO fencers (id, competition_id, ref, last_name, first_name, gender, nationality,
         status, created_at, updated_at) VALUES ('f1', 'c1', 1, 'DUPONT', 'Ana', 'F', 'FRA', 'N', 'x', 'x')`
    ).run();
    V54.up({ run });
    expect(all('SELECT id, last_name, members, level, handicap FROM fencers')).toEqual([
      { id: 'f1', last_name: 'DUPONT', members: null, level: null, handicap: null },
    ]);
    const members = JSON.stringify([{ lastName: 'A', firstName: 'a', birthDate: '1990-01-01' }]);
    db.prepare(`UPDATE fencers SET members = ?, level = 1, handicap = 1 WHERE id = 'f1'`).run(
      members
    );
    expect(all('SELECT members, level, handicap FROM fencers')).toEqual([
      { members, level: 1, handicap: 1 },
    ]);
  });

  it('rejouée sans erreur (colonnes déjà présentes)', () => {
    V54.up({ run });
    expect(() => V54.up({ run })).not.toThrow();
  });
});
