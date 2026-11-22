/**
 * Migration 47 (docs/adr/0023) sur une base SQLite réelle (node:sqlite) : venue_id des
 * épreuves, device_config, reprise de cyrano_pistes vers la salle de la journée ou la salle par
 * défaut, sans écraser une piste déjà déclarée ; conflits listés au diagnostic.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ALL_MIGRATIONS } from './migrations';
import { stripDeviceDiagnostics } from './stripDevices';

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

const V47 = ALL_MIGRATIONS.find(m => m.version === 47)!;

describe.skipIf(!DatabaseSync)('migration 47 : appareils de piste sur la salle', () => {
  let db: SqliteDb;
  const run = (s: string) => db.exec(s);
  const all = <T>(sql: string, ...p: unknown[]) => db.prepare(sql).all(...p) as T[];
  const strips = (venueId: string) =>
    all<{ number: number; device_config: string | null }>(
      'SELECT number, device_config FROM venue_strips WHERE venue_id = ? ORDER BY number',
      venueId
    ).map(s => [s.number, s.device_config ? JSON.parse(s.device_config) : null]);
  const piste = (key: string, p: string, config: object, position = 0) =>
    db
      .prepare(
        'INSERT INTO cyrano_pistes (competition_id, piste, position, config) VALUES (?, ?, ?, ?)'
      )
      .run(key, p, position, JSON.stringify(config));
  const competition = (id: string, date: string, dayId: string | null = null) =>
    db
      .prepare(
        `INSERT INTO competitions (id, title, date, weapon, gender, category, created_at, updated_at, event_day_id)
         VALUES (?, ?, ?, 'E', 'M', 'SENIOR', 'x', 'x', ?)`
      )
      .run(id, id, date, dayId);

  beforeEach(() => {
    db = new DatabaseSync!(':memory:');
    for (const m of ALL_MIGRATIONS.filter(m => m.version < 47)) m.up({ run });
  });

  it('sans salle : salle par défaut créée, pistes reprises et normalisées', () => {
    competition('c1', '2026-01-10');
    piste('c1', '1', { piste: '1', ip: '10.0.0.1', port: 50100, protocol: 'EFP1', arena: 1 });
    piste('c1', '2', { piste: '2', ip: '10.0.0.2', mode: 'display' }, 1);
    V47.up({ run });

    const venues = all<{ id: string; name: string; is_default: number }>('SELECT * FROM venues');
    expect(venues).toHaveLength(1);
    expect(venues[0]).toMatchObject({ name: 'Salle principale', is_default: 1 });
    expect(strips(venues[0].id)).toEqual([
      [1, { ip: '10.0.0.1', port: 50100, arena: 1, protocol: 'cyrano', version: 'EFP1' }],
      [2, { ip: '10.0.0.2', mode: 'display', protocol: 'cyrano', version: 'auto' }],
    ]);
    expect(stripDeviceDiagnostics({ all })).toEqual([]);
    // Salle propre de l'épreuve (ADR-0019) : colonne ajoutée, vide
    expect(all<{ venue_id: string | null }>('SELECT venue_id FROM competitions')).toEqual([
      { venue_id: null },
    ]);
  });

  it('journée → salle de la journée, épreuve sans journée → salle par défaut, rien d’écrasé', () => {
    run(`INSERT INTO venues (id, name, is_default, created_at, updated_at) VALUES
      ('v0', 'Défaut', 1, 'x', 'x'), ('v1', 'Halle', 0, 'x', 'x')`);
    run(`INSERT INTO venue_strips (venue_id, number, label, cyrano_config) VALUES
      ('v0', 1, NULL, NULL),
      ('v1', 1, NULL, NULL), ('v1', 2, 'Bleue', '{"ip":"9.9.9.9","port":50101}'), ('v1', 3, NULL, NULL)`);
    run(`INSERT INTO event_days (id, name, date, strip_count, venue_id, created_at, updated_at)
      VALUES ('d1', 'Samedi', '2026-03-01', 4, 'v1', 'x', 'x')`);
    competition('c2', '2026-03-01', 'd1');
    competition('c3', '2026-02-01');
    piste('day:d1', '2', { ip: '1.1.1.1' });
    piste('day:d1', '3', { ip: '3.3.3.3' }, 1);
    piste('day:d1', '6', { ip: '6.6.6.6', mode: 'manual' }, 2);
    piste('c2', '3', { ip: '4.4.4.4' });
    piste('c3', '1', { ip: '5.5.5.5', protocol: 'EFP1.1' });
    piste('c3', 'podium', { ip: '7.7.7.7' }, 1);
    piste('c3', '4', { port: 50100 }, 2);
    V47.up({ run });

    expect(all('SELECT id FROM venues ORDER BY id')).toEqual([{ id: 'v0' }, { id: 'v1' }]);
    expect(strips('v1')).toEqual([
      [1, null],
      // Déjà déclarée : gardée (protocole explicite)
      [2, { ip: '9.9.9.9', port: 50101, protocol: 'cyrano', version: 'auto' }],
      // Journée avant épreuve
      [3, { ip: '3.3.3.3', protocol: 'cyrano', version: 'auto' }],
      // Piste manquante créée
      [6, { ip: '6.6.6.6', mode: 'manual', protocol: 'cyrano', version: 'auto' }],
    ]);
    expect(strips('v0')).toEqual([[1, { ip: '5.5.5.5', protocol: 'cyrano', version: 'EFP1.1' }]]);
    expect(all<{ label: string }>('SELECT label FROM venue_strips WHERE number = 2')).toEqual([
      { label: 'Bleue' },
    ]);

    const report = stripDeviceDiagnostics({ all });
    expect(report).toHaveLength(4);
    expect(report.join('\n')).toMatch(
      /conflit \(journée d1, piste « 2 »\).*9\.9\.9\.9.*1\.1\.1\.1/
    );
    expect(report.join('\n')).toMatch(/conflit \(épreuve c2, piste « 3 »\).*4\.4\.4\.4/);
    expect(report.join('\n')).toMatch(/épreuve c3, piste « podium »\) : numéro hors salle/);
    expect(report.join('\n')).toMatch(/piste « 4 »\) : configuration invalide/);
  });

  it('cyrano_pistes vide : aucune salle créée', () => {
    V47.up({ run });
    expect(all('SELECT id FROM venues')).toEqual([]);
    expect(stripDeviceDiagnostics({ all })).toEqual([]);
  });
});
