/**
 * BellePoule Modern - Appareils de piste (#2117, docs/adr/0023) : déclaration sur la piste de
 * la salle, salle d'une épreuve, appareils effectifs, pilotes Cyrano et OPP2. Reprise des
 * anciens canaux IPC cyrano:* et opp2:* (ipc/cyranoHandlers.ts, ipc/opp2Handlers.ts).
 * Règles pures : shared/domain/stripDevices. Les pilotes passent par le port `ctx.devices`
 * branché par main.ts ; pas de journal (ce ne sont pas des faits de l'épreuve).
 * Licensed under GPL-3.0
 */
import type { z } from 'zod';
import type { devicesOperations } from '../../../shared/api/contractDevices';
import type { Venue } from '../../../shared/types/appSettings';
import type { CompetitionStripDevices, StripDevice } from '../../../shared/types/stripDevice';
import {
  effectiveStripDevices,
  normalizeManualStrips,
  resolveVenue,
  toStripDevice,
} from '../../../shared/domain/stripDevices/stripDevices';
import { CommandError, type CommandContext, type DevicesPort } from './context';
import { getCompetitionOrThrow } from './competitions';
import { refusingAsync } from './refusal';

type Ops = typeof devicesOperations;
/** Pilotage de la salle et déclaration en masse : devicesControl.ts */
export type DevicesControlOps =
  | 'listVenueStripControl'
  | 'sendStripDisplay'
  | 'setStripDevices'
  | 'exportStripDevices'
  | 'importStripDevices';
type DevicesOps = Exclude<keyof Ops, DevicesControlOps | 'onStripControlChanged'>;

export type DevicesHandler<N extends keyof Ops> = (
  ctx: CommandContext,
  input: z.output<Ops[N]['input']>
) => z.output<Ops[N]['output']> | Promise<z.output<Ops[N]['output']>>;

/** Pilotes ; refus « unavailable » hors du poste Electron (tests, MCP) */
export function portOf(ctx: CommandContext): DevicesPort {
  if (!ctx.devices) throw new CommandError('unavailable', 'Pilotes des appareils indisponibles');
  return ctx.devices;
}

export function venueOrThrow(ctx: CommandContext, venueId: string): Venue {
  const venue = ctx.db.settings.getVenue(venueId);
  if (!venue) throw new CommandError('venue_not_found', `Salle introuvable : ${venueId}`);
  return venue;
}

/**
 * Salle d'une épreuve (docs/adr/0023) : sa salle propre, sinon celle de sa journée, sinon la
 * salle par défaut ; null si aucune salle n'est déclarée.
 */
export function resolveCompetitionVenue(
  ctx: CommandContext,
  competitionId: string
): { venue: Venue; source: CompetitionStripDevices['source'] } | null {
  const settings = ctx.db.settings;
  const dayId = ctx.db.eventDays.getCompetitionDayId(competitionId);
  const resolved = resolveVenue(
    {
      competitionVenueId: settings.getCompetitionVenueId(competitionId),
      dayVenueId: dayId ? ctx.db.eventDays.getDay(dayId)?.venueId : null,
      defaultVenueId: settings.getDefaultVenue()?.id,
    },
    id => settings.getVenue(id) !== null
  );
  if (!resolved) return null;
  return { venue: settings.getVenue(resolved.venueId)!, source: resolved.source };
}

/** Appareils effectifs d'une épreuve : salle résolue, pistes passées en manuel marquées */
export function competitionStripDevices(
  ctx: CommandContext,
  competitionId: string
): CompetitionStripDevices {
  const comp = getCompetitionOrThrow(ctx, competitionId);
  const manualStrips = normalizeManualStrips(comp.settings?.manualStrips);
  const resolved = resolveCompetitionVenue(ctx, comp.id);
  return {
    venueId: resolved?.venue.id ?? null,
    venueName: resolved?.venue.name ?? null,
    source: resolved?.source ?? null,
    competitionVenueId: ctx.db.settings.getCompetitionVenueId(comp.id),
    devices: resolved ? effectiveStripDevices(resolved.venue.strips, manualStrips) : [],
    manualStrips,
  };
}

/** Tables des pilotes à relire après une déclaration ; sans pilote (tests, MCP) : rien */
export const reload = (ctx: CommandContext, focus?: string) => ctx.devices?.reload(focus);

export const devicesHandlers: { [N in DevicesOps]: DevicesHandler<N> } = {
  // ── Déclaration sur la salle ──
  setStripDevice: (ctx, { venueId, strip, device }) => {
    venueOrThrow(ctx, venueId);
    const venue = ctx.db.settings.setStripDevice(
      venueId,
      strip,
      device ? toStripDevice(device) : null
    );
    ctx.emitChange?.({ scope: 'settings', competitionIds: [] });
    reload(ctx);
    return venue;
  },
  listStripDevices: (ctx, { venueId }) =>
    venueOrThrow(ctx, venueId).strips.map(s => ({
      strip: s.number,
      ...(s.label ? { label: s.label } : {}),
      device: (s.deviceConfig as StripDevice | undefined) ?? null,
    })),
  getCompetitionStripDevices: (ctx, { competitionId }) =>
    competitionStripDevices(ctx, competitionId),
  setCompetitionVenue: (ctx, { competitionId, venueId }) => {
    const comp = getCompetitionOrThrow(ctx, competitionId);
    if (venueId) venueOrThrow(ctx, venueId);
    ctx.db.settings.setCompetitionVenue(comp.id, venueId);
    ctx.emitChange?.({ scope: 'competitions', competitionIds: [comp.id] });
    reload(ctx, comp.id);
    return competitionStripDevices(ctx, comp.id);
  },

  // ── Pilote Cyrano ──
  startCyranoServer: async (ctx, { port, host, competitionId }) => {
    const devices = portOf(ctx);
    if (competitionId) getCompetitionOrThrow(ctx, competitionId);
    const bound = devices.cyrano.running()
      ? devices.cyrano.status().port
      : await refusingAsync('device_refused', () => devices.cyrano.start({ port, host }));
    devices.reload(competitionId);
    return { port: bound };
  },
  stopCyranoServer: async ctx => {
    await portOf(ctx).cyrano.stop();
  },
  getCyranoStatus: ctx => portOf(ctx).cyrano.status(),
  listCyranoLog: ctx => portOf(ctx).cyrano.log(),

  // ── Pilote OPP2 ──
  startOpp2Broker: async (ctx, { port, competitionId }) => {
    const devices = portOf(ctx);
    if (competitionId) getCompetitionOrThrow(ctx, competitionId);
    const bound = devices.opp2.running()
      ? devices.opp2.status().port
      : await refusingAsync('device_refused', () => devices.opp2.start({ port }));
    devices.reload(competitionId);
    return { port: bound };
  },
  stopOpp2Broker: async ctx => {
    await portOf(ctx).opp2.stop();
  },
  getOpp2Status: ctx => portOf(ctx).opp2.status(),

  // ── Commun ──
  listStripDeviceRoutes: ctx => portOf(ctx).routes(),
  setStripDeviceOptions: (ctx, options) => {
    portOf(ctx).setOptions(options);
  },
  runStripDeviceAction: (ctx, { piste, action }) => ({ done: portOf(ctx).action(piste, action) }),
};
