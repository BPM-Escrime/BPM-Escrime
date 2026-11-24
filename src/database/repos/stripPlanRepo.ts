/**
 * BPM - Escrime - Plan des pistes d'une épreuve (docs/adr/0015, migration 50) : piste de départ
 * et pistes indisponibles, table competition_strip_plans. Écrit par les commandes setStripStart
 * et setStripAvailability seules (ADR-0005) ; épreuve sans ligne : plan par défaut.
 * Licensed under GPL-3.0
 */
import type { SqlExecutor } from './sqlExecutor';
import { normalizeStripPlan, type StripPlan } from '../../shared/domain/planning/stripPlan';

export interface StoredStripPlan extends StripPlan {
  /** Dernière écriture ; null : aucune ligne (plan par défaut) */
  updatedAt: string | null;
}

export class StripPlanRepo {
  constructor(private readonly sql: SqlExecutor) {}

  public getStripPlan(competitionId: string): StoredStripPlan {
    const row = this.sql.db
      ? this.sql.queryOne<{ start: number; unavailable: string; updated_at: string }>(
          'SELECT start, unavailable, updated_at FROM competition_strip_plans WHERE competition_id = ?',
          [competitionId]
        )
      : null;
    if (!row) return { start: 1, unavailable: [], updatedAt: null };
    let unavailable: unknown = [];
    try {
      unavailable = JSON.parse(row.unavailable);
    } catch {
      /* liste illisible : aucune piste indisponible */
    }
    return { ...normalizeStripPlan({ start: row.start, unavailable }), updatedAt: row.updated_at };
  }

  /** Enregistre le plan (normalisé) d'une épreuve ; `at` : heure de la commande */
  public saveStripPlan(competitionId: string, plan: StripPlan, at: string): void {
    if (!this.sql.db) throw new Error('Database not open');
    const p = normalizeStripPlan(plan);
    this.sql.run(
      `INSERT INTO competition_strip_plans (competition_id, start, unavailable, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(competition_id) DO UPDATE SET
         start = excluded.start, unavailable = excluded.unavailable, updated_at = excluded.updated_at`,
      [competitionId, p.start, JSON.stringify(p.unavailable), at]
    );
  }
}
