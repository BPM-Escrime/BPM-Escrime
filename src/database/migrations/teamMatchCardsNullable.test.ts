/**
 * Migration 49 (docs/adr/0028 § 9, amendement du 2026-11-24) sur une base SQLite réelle
 * (node:sqlite), clés étrangères actives : team_match_cards.team_id nullable (carton P donné
 * aux deux équipes), cartons E déjà en base recopiés dans leur ordre, clés étrangères et
 * cascade conservées, index recréé ; application sur une base vierge.
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

const V49 = ALL_MIGRATIONS.find(m => m.version === 49)!;

describe.skipIf(!DatabaseSync)('migration 49 : team_match_cards.team_id nullable', () => {
  let db: SqliteDb;
  const run = (s: string) => db.exec(s);
  const all = <T>(sql: string, ...p: unknown[]) => db.prepare(sql).all(...p) as T[];
  const card = (id: string, teamId: string | null, type: string, at: string, matchId = 'm1') =>
    db
      .prepare(
        `INSERT INTO team_match_cards (id, match_id, team_id, type, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, matchId, teamId, type, teamId ? 'late_designation' : 'passivity', at);

  const seed = () => {
    run(`INSERT INTO competitions (id, title, date, weapon, gender, category, created_at, updated_at)
         VALUES ('c1', 'c1', '2026-01-10', 'E', 'M', 'SENIOR', 'x', 'x')`);
    for (const t of ['tA', 'tB'])
      run(`INSERT INTO teams (id, competition_id, name, club, created_at, updated_at)
           VALUES ('${t}', 'c1', '${t}', '', 'x', 'x')`);
    run(`INSERT INTO team_matches (id, competition_id, team_a_id, team_b_id, created_at, updated_at)
         VALUES ('m1', 'c1', 'tA', 'tB', 'x', 'x')`);
  };

  beforeEach(() => {
    db = new DatabaseSync!(':memory:');
    run('PRAGMA foreign_keys = ON');
    for (const m of ALL_MIGRATIONS.filter(m => m.version < 49)) m.up({ run });
  });

  it('avant : team_id NOT NULL refuse le carton P', () => {
    seed();
    expect(() => card('p1', null, 'p_yellow', '2026-01-10T10:00:00.000Z')).toThrow();
  });

  it('cartons E déjà en base recopiés dans leur ordre ; carton P à team_id NULL accepté', () => {
    seed();
    // Même milliseconde : l'ordre d'insertion (rowid) départage
    card('e2', 'tB', 'yellow', '2026-01-10T10:00:00.000Z');
    card('e1', 'tA', 'white', '2026-01-10T10:00:00.000Z');
    V49.up({ run });

    const rows = all<{ id: string; team_id: string | null; type: string; reason: string }>(
      'SELECT id, team_id, type, reason FROM team_match_cards ORDER BY created_at, rowid'
    );
    expect(rows).toEqual([
      { id: 'e2', team_id: 'tB', type: 'yellow', reason: 'late_designation' },
      { id: 'e1', team_id: 'tA', type: 'white', reason: 'late_designation' },
    ]);
    card('p1', null, 'p_yellow', '2026-01-10T10:01:00.000Z');
    expect(all('SELECT id FROM team_match_cards WHERE team_id IS NULL')).toEqual([{ id: 'p1' }]);
    const notNull = all<{ name: string; notnull: number }>(
      'SELECT name, "notnull" FROM pragma_table_info(\'team_match_cards\')'
    ).find(c => c.name === 'team_id');
    expect(notNull?.notnull).toBe(0);
    expect(
      all(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_team_match_cards_match'"
      )
    ).toHaveLength(1);
  });

  it('clés étrangères conservées : équipe inconnue refusée, cascade sur la rencontre', () => {
    seed();
    V49.up({ run });
    expect(() => card('x', 'inconnue', 'yellow', '2026-01-10T10:00:00.000Z')).toThrow();
    expect(() => card('y', null, 'p_red', '2026-01-10T10:00:00.000Z', 'absente')).toThrow();
    card('e1', 'tA', 'yellow', '2026-01-10T10:00:00.000Z');
    card('p1', null, 'p_red', '2026-01-10T10:00:01.000Z');
    run(`DELETE FROM team_matches WHERE id = 'm1'`);
    expect(all('SELECT id FROM team_match_cards')).toEqual([]);
  });

  it('base vierge : toutes les migrations s’appliquent, table vide et nullable', () => {
    V49.up({ run });
    expect(all('SELECT * FROM team_match_cards')).toEqual([]);
    seed();
    card('p1', null, 'p_black', '2026-01-10T10:00:00.000Z');
    expect(all('SELECT id FROM team_match_cards')).toHaveLength(1);
  });
});
