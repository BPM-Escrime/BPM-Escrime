/**
 * BellePoule Modern - Pistes d'une journée en temps réel (#1878) : tableau des pistes,
 * affectation, réservation, affectation automatique (port `dayStrips` du poste, docs/adr/0022).
 * Affectation automatique : vérifiée toutes les 5 s pour les journées qui l'ont activée.
 * Licensed under GPL-3.0
 */
import type { DatabaseManager } from '../../database';
import type { DayStripBoard } from '../../shared/types/eventDay';
import { normalizeStripRule } from '../../shared/utils/stripRules';
import {
  assignStrip,
  autoAssignStrips,
  buildStripBoard,
  type DayEvent,
  type DayStripServer,
  type TableauCoords,
} from './dayStripBoard';
import { resolveCyranoCoords } from '../cyrano/matchCoords';
import { logger, LogCategory } from '../../shared/services/logger';

export interface DayStripServiceContext {
  db: Pick<DatabaseManager, 'eventDays' | 'stripRules' | 'getCompetition'> &
    Parameters<typeof resolveCyranoCoords>[2];
  /** Serveurs distants ouverts, par épreuve */
  getServer: (competitionId: string) => DayStripServer | undefined;
  autoAssignIntervalMs?: number;
}

const AUTO_ASSIGN_MS = 5000;

export interface DayStripService {
  board(dayId: unknown): DayStripBoard | null;
  assign(dayId: unknown, strip: unknown, key: unknown): boolean;
  setRule(dayId: unknown, strip: unknown, rule: unknown): boolean;
  setAutoAssign(dayId: unknown, on: unknown): boolean;
  /** Arrête l'affectation automatique périodique */
  dispose(): void;
}

export function createDayStripService(ctx: DayStripServiceContext): DayStripService {
  const { db } = ctx;
  const coords: TableauCoords = (competitionId, match) => {
    if (match.poolId) {
      const pool = Number(resolveCyranoCoords(match, competitionId, db).poulTab);
      return { size: null, number: null, pool: Number.isInteger(pool) && pool > 0 ? pool : null };
    }
    const c = resolveCyranoCoords({ ...match, isTableau: true }, competitionId, db);
    const size = Number(/^A(\d+)$/.exec(c.poulTab)?.[1]);
    return { size: Number.isInteger(size) && size > 0 ? size : null, number: c.matchNum };
  };
  const eventsOf = (dayId: string): DayEvent[] =>
    (db.eventDays.getDay(dayId)?.competitionIds ?? []).flatMap(id => {
      const server = ctx.getServer(id);
      if (!server) return [];
      return [{ competitionId: id, title: db.getCompetition(id)?.title ?? id, server }];
    });
  const stripCountOf = (dayId: string) => db.eventDays.getDay(dayId)?.stripCount ?? 0;

  const board = (dayId: unknown): DayStripBoard | null => {
    if (typeof dayId !== 'string' || !db.eventDays.getDay(dayId)) return null;
    return buildStripBoard(
      stripCountOf(dayId),
      db.stripRules.getStripRules(dayId),
      db.stripRules.getAutoAssign(dayId),
      eventsOf(dayId),
      coords
    );
  };

  const assign = (dayId: unknown, strip: unknown, key: unknown): boolean => {
    if (typeof dayId !== 'string' || typeof key !== 'string') return false;
    const n = Number(strip);
    if (!Number.isInteger(n) || n < 1 || n > stripCountOf(dayId)) return false;
    const ok = assignStrip(n, key, db.stripRules.getStripRules(dayId)[n], eventsOf(dayId), coords);
    if (ok) logger.info(LogCategory.NETWORK, `Journée ${dayId} : piste ${n} affectée (${key})`);
    return ok;
  };

  const setRule = (dayId: unknown, strip: unknown, rule: unknown): boolean => {
    const n = Number(strip);
    if (typeof dayId !== 'string' || !Number.isInteger(n) || n < 1) return false;
    if (n > stripCountOf(dayId)) return false;
    db.stripRules.setStripRule(dayId, n, rule === null ? null : normalizeStripRule(rule));
    return true;
  };

  const setAutoAssign = (dayId: unknown, on: unknown): boolean => {
    if (typeof dayId !== 'string' || !db.eventDays.getDay(dayId)) return false;
    db.stripRules.setAutoAssign(dayId, on === true);
    return true;
  };

  const timer = setInterval(() => {
    for (const dayId of db.stripRules.listAutoAssignDays()) {
      try {
        const done = autoAssignStrips(
          stripCountOf(dayId),
          db.stripRules.getStripRules(dayId),
          eventsOf(dayId),
          coords
        );
        for (const d of done)
          logger.info(LogCategory.NETWORK, `Journée ${dayId} : piste ${d.strip} → ${d.key} (auto)`);
      } catch (err) {
        logger.warn(LogCategory.NETWORK, `Journée ${dayId} : affectation automatique`, err);
      }
    }
  }, ctx.autoAssignIntervalMs ?? AUTO_ASSIGN_MS);
  timer.unref?.();
  return { board, assign, setRule, setAutoAssign, dispose: () => clearInterval(timer) };
}
