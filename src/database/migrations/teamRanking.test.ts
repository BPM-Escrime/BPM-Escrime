/**
 * Migration 55 (docs/adr/0044) sur une base SQLite réelle (node:sqlite) : colonne
 * teams.ranking (rang d'entrée, INTEGER NULL sans valeur par défaut), équipes existantes
 * gardées non classées, puis rang écrit ; rejouable.
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

const V55 = ALL_MIGRATIONS.find(m => m.version === 55)!;

describe.skipIf(!DatabaseSync)('migration 55 : rang d’entrée d’une équipe', () => {
  let db: SqliteDb;
  const run = (s: string) => db.exec(s);
  const all = <T>(sql: string) => db.prepare(sql).all() as T[];

  beforeEach(() => {
    db = new DatabaseSync!(':memory:');
    run('PRAGMA foreign_keys = OFF');
    for (const m of ALL_MIGRATIONS.filter(m => m.version < 55)) m.up({ run });
  });

  it('cite l’ADR-0044 dans sa description', () => {
    expect(V55.description).toContain('docs/adr/0044');
  });

  it('base 54 : équipe existante gardée, rang nul, sans valeur par défaut, puis écrit', () => {
    run(`INSERT INTO teams (id, competition_id, name, club, created_at, updated_at)
         VALUES ('t1', 'c1', 'Paris', 'Paris', 'x', 'x')`);
    V55.up({ run });
    expect(all('SELECT id, name, ranking FROM teams')).toEqual([
      { id: 't1', name: 'Paris', ranking: null },
    ]);
    const column = all<{ name: string; type: string; notnull: number; dflt_value: unknown }>(
      'PRAGMA table_info(teams)'
    ).find(c => c.name === 'ranking');
    expect(column).toMatchObject({ type: 'INTEGER', notnull: 0, dflt_value: null });
    run(`INSERT INTO teams (id, competition_id, name, club, created_at, updated_at)
         VALUES ('t2', 'c1', 'Lyon', 'Lyon', 'x', 'x')`);
    run(`UPDATE teams SET ranking = 3 WHERE id = 't1'`);
    expect(all('SELECT id, ranking FROM teams ORDER BY id')).toEqual([
      { id: 't1', ranking: 3 },
      { id: 't2', ranking: null },
    ]);
  });

  it('rejouable : colonne déjà présente', () => {
    V55.up({ run });
    expect(() => V55.up({ run })).not.toThrow();
  });
});
