/**
 * BPM - Escrime - Journée multi-épreuves (#1714, #1878) : opérations du contrat
 * (docs/adr/0022), reprise de l'ancien ipc/eventDayHandlers.ts. Les fonctions de domaine
 * (syncDay, importAndSyncDay, buildOverview) restent appelables directement (outils MCP).
 * Licensed under GPL-3.0
 */
import type { DatabaseManager } from '../../../database';
import type { DaySyncResult, EventDayOverview } from '../../../shared/types/eventDay';
import {
  busyElsewhere,
  computeDayStatuses,
  detectDayConflicts,
} from '../../../shared/utils/eventDay';
import { portOf, refuse, type StationHandler } from './stationSupport';

/** Synchronise les arbitres de la journée dans toutes ses épreuves */
export function syncDay(db: DatabaseManager, dayId: string): { added: number; updated: number } {
  const day = db.eventDays.getDay(dayId);
  const total = { added: 0, updated: 0 };
  for (const competitionId of day?.competitionIds ?? []) {
    const r = db.eventDays.syncCompetition(competitionId);
    total.added += r.added;
    total.updated += r.updated;
  }
  return total;
}

/**
 * Importe les arbitres des épreuves dans la journée puis les reporte dans chaque
 * épreuve selon son arme (#1872)
 */
export function importAndSyncDay(db: DatabaseManager, dayId: string): DaySyncResult {
  const { imported = 0, updated } = db.eventDays.importCompetitionReferees(dayId);
  const r = syncDay(db, dayId);
  return { added: r.added, updated: r.updated + updated, imported };
}

export function buildOverview(db: DatabaseManager, dayId: string): EventDayOverview {
  const refs = db.eventDays.listReferees(dayId);
  const assignments = db.eventDays.getAssignments(dayId);
  return {
    statuses: computeDayStatuses(refs, assignments),
    conflicts: detectDayConflicts(refs, assignments, db.eventDays.getCompetitionWeapons(dayId)),
  };
}

type EventDayOps =
  | 'listEventDays'
  | 'createEventDay'
  | 'updateEventDayDetails'
  | 'deleteEventDay'
  | 'assignCompetitionToDay'
  | 'getEventDayOverview'
  | 'listEventDayReferees'
  | 'registerEventDayReferee'
  | 'updateEventDayRefereeDetails'
  | 'removeEventDayReferee'
  | 'syncEventDayReferees'
  | 'listBusyElsewhere'
  | 'getDayStripBoard'
  | 'getDayStripOccupation'
  | 'assignDayStrip'
  | 'setDayStripRule'
  | 'setDayAutoAssign';

export const eventDayHandlers: { [N in EventDayOps]: StationHandler<N> } = {
  listEventDays: ctx => refuse(() => ctx.db.eventDays.listDays()),
  createEventDay: (ctx, input) => refuse(() => ctx.db.eventDays.createDay(input)),
  updateEventDayDetails: (ctx, { dayId, details }) =>
    refuse(() => ctx.db.eventDays.updateDay(dayId, details)),
  deleteEventDay: (ctx, { dayId }) => refuse(() => ctx.db.eventDays.deleteDay(dayId)),
  assignCompetitionToDay: (ctx, { competitionId, dayId }) =>
    refuse(() => {
      ctx.db.eventDays.setCompetitionDay(competitionId, dayId);
      // Rattachement : arbitres de l'épreuve importés dans la journée, puis reportés partout
      return dayId ? importAndSyncDay(ctx.db, dayId) : { added: 0, updated: 0 };
    }),
  getEventDayOverview: (ctx, { dayId }) => refuse(() => buildOverview(ctx.db, dayId)),
  listEventDayReferees: (ctx, { dayId }) => refuse(() => ctx.db.eventDays.listReferees(dayId)),
  registerEventDayReferee: (ctx, { dayId, details }) =>
    refuse(() => ctx.db.eventDays.createReferee(dayId, details)),
  updateEventDayRefereeDetails: (ctx, { refereeId, details }) =>
    refuse(() => ctx.db.eventDays.updateReferee(refereeId, details)),
  removeEventDayReferee: (ctx, { refereeId }) =>
    refuse(() => ctx.db.eventDays.deleteReferee(refereeId)),
  syncEventDayReferees: (ctx, { dayId }) => refuse(() => importAndSyncDay(ctx.db, dayId)),
  listBusyElsewhere: (ctx, { competitionId }) =>
    refuse(() => {
      const repo = ctx.db.eventDays;
      const dayId = repo.getCompetitionDayId(competitionId);
      if (!dayId) return {};
      return busyElsewhere(
        repo.getAssignments(dayId),
        competitionId,
        repo.getLinks({ competitionId })
      );
    }),
  getDayStripBoard: (ctx, { dayId }) => refuse(() => portOf(ctx).dayStrips.board(dayId)),
  getDayStripOccupation: (ctx, { dayId }) =>
    refuse(() => ctx.db.eventDays.getStripOccupation(dayId)),
  assignDayStrip: (ctx, { dayId, strip, key }) =>
    refuse(() => portOf(ctx).dayStrips.assign(dayId, strip, key)),
  setDayStripRule: (ctx, { dayId, strip, rule }) =>
    refuse(() => portOf(ctx).dayStrips.setRule(dayId, strip, rule)),
  setDayAutoAssign: (ctx, { dayId, on }) =>
    refuse(() => portOf(ctx).dayStrips.setAutoAssign(dayId, on)),
};
