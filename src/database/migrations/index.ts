/**
 * BellePoule Modern - Système de migrations DB versionnées
 * Chaque migration est appliquée une seule fois, dans l'ordre croissant.
 */

import Database from 'better-sqlite3-multiple-ciphers';
import { logger, LogCategory } from '../../shared/services/logger';

export interface Migration {
  version: number;
  description: string;
  up(db: { run(sql: string): void }): void;
  /**
   * Après `up` : constats à verser au journal de diagnostic (reprise partielle, conflits), en
   * lecture seule. Facultatif ; ignoré par les tests qui appliquent `up` seul.
   */
  diagnose?(db: { all<T>(sql: string): T[] }): string[];
}

export class MigrationManager {
  constructor(private db: Database.Database) {}

  run(migrations: Migration[]): number {
    this.ensureMigrationsTable();
    const applied = this.getAppliedVersions();
    const pending = migrations
      .filter(m => !applied.has(m.version))
      .sort((a, b) => a.version - b.version);

    const dbWrapper = { run: (sql: string) => this.db.exec(sql) };

    for (const migration of pending) {
      logger.info(
        LogCategory.DATABASE,
        `[DB] Migration v${migration.version}: ${migration.description}`
      );
      migration.up(dbWrapper);
      this.recordMigration(migration.version, migration.description);
      this.report(migration);
    }

    if (pending.length > 0) {
      logger.info(LogCategory.DATABASE, `[DB] ${pending.length} migration(s) appliquée(s)`);
    }
    return pending.length;
  }

  /** Constats de la migration (diagnose) versés au journal ; un échec de lecture n'arrête rien */
  private report(migration: Migration): void {
    if (!migration.diagnose) return;
    try {
      const all = <T>(sql: string) => this.db.prepare(sql).all() as T[];
      for (const line of migration.diagnose({ all })) {
        logger.warn(LogCategory.DATABASE, `[DB] Migration v${migration.version} : ${line}`);
      }
    } catch (e) {
      logger.warn(
        LogCategory.DATABASE,
        `[DB] Migration v${migration.version} : diagnostic impossible (${String(e)})`
      );
    }
  }

  private ensureMigrationsTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )
    `);
  }

  private getAppliedVersions(): Set<number> {
    const rows = this.db.prepare('SELECT version FROM schema_migrations').all() as {
      version: number;
    }[];
    return new Set(rows.map(r => r.version));
  }

  private recordMigration(version: number, description: string): void {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?)'
      )
      .run(version, description, new Date().toISOString());
  }
}
