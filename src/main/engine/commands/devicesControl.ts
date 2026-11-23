/**
 * BPM - Escrime - Pilotage de la salle hors compétition et déclaration en masse (#2117,
 * docs/adr/0023) : grille des pistes, affichage libre (arme, noms, nationalités, remise à
 * blanc) avec accusé de réception, ajout en lot, export et import des appareils de la salle.
 * Règles pures : shared/domain/stripDevices (stripControl, stripDevicesFile). Les envois passent
 * par le port `ctx.devices.control`. Ordres d'affichage et réglages du poste : aucun fait
 * d'épreuve, aucun journal, aucun nom dans les traces.
 * Licensed under GPL-3.0
 */
import type { z } from 'zod';
import type { CommandContext } from './context';
import { CommandError } from './context';
import {
  type DevicesControlOps,
  type DevicesHandler,
  portOf,
  reload,
  resolveCompetitionVenue,
  venueOrThrow,
} from './devices';
import {
  StripDeclarationSchema,
  type devicesOperations,
} from '../../../shared/api/contractDevices';
import {
  effectiveStripDevices,
  normalizeManualStrips,
  toStripDevice,
} from '../../../shared/domain/stripDevices/stripDevices';
import {
  isEmptyRequest,
  mergeStripPanel,
  selectStrips,
  stripOccupancy,
  stripSendOutcome,
  type CompetitionStripUse,
} from '../../../shared/domain/stripDevices/stripControl';
import {
  duplicateStripLines,
  exportStripDevicesFile,
  readStripDevicesFile,
  venueDeclarations,
} from '../../../shared/domain/stripDevices/stripDevicesFile';
import type {
  StripDeviceDeclaration,
  StripSendResult,
  VenueStripControl,
} from '../../../shared/types/stripDevice';
import type { Venue } from '../../../shared/types/appSettings';
import { onStripControlChangeEvent } from '../api/events';

/** Épreuves en saisie distante : salle résolue, arènes de la séance, pistes passées en manuel */
function competitionUses(ctx: CommandContext): CompetitionStripUse[] {
  const active = ctx.devices?.control.activeArenas() ?? [];
  return active.flatMap(({ competitionId, arenas }) => {
    const comp = ctx.db.getCompetition(competitionId);
    if (!comp) return [];
    return [
      {
        competitionId,
        title: comp.title,
        venueId: resolveCompetitionVenue(ctx, competitionId)?.venue.id ?? null,
        arenas,
        manualStrips: normalizeManualStrips(comp.settings?.manualStrips),
      },
    ];
  });
}

/** Appareils de la salle, occupation et liaison vue par les pilotes */
function venueView(ctx: CommandContext, venue: Venue) {
  const devices = effectiveStripDevices(venue.strips);
  const occupancy = stripOccupancy(venue.id, devices, competitionUses(ctx));
  const port = ctx.devices;
  const link = (strip: number) => {
    const d = devices.find(x => x.strip === strip);
    return d && port ? port.control.link(d) : null;
  };
  return { devices, occupancy, link };
}

/** Dernier affichage libre de cette piste de cette salle (une piste du pilote peut changer de salle) */
function lastOf(ctx: CommandContext, venueId: string, strip: number, piste: string) {
  return ctx.devices?.control.last(piste, { venueId, strip }) ?? null;
}

const slug = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'salle';

/** Message court d'une ligne refusée par le schéma (chemin : message) */
function issuesOf(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map(i => (i.path.length ? `${i.path.join('.')} : ${i.message}` : i.message))
    .join(' ; ');
}

const normalizeDeclarations = (list: readonly StripDeviceDeclaration[]) =>
  list.map(d => ({
    strip: d.strip,
    ...(d.label !== undefined ? { label: d.label } : {}),
    device: d.device ? toStripDevice(d.device) : null,
  }));

export const devicesControlHandlers: { [N in DevicesControlOps]: DevicesHandler<N> } = {
  listVenueStripControl: (ctx, { venueId }): VenueStripControl => {
    const venue = venueOrThrow(ctx, venueId);
    // Salle pilotée : ses appareils chargés dans les pilotes (liaison, HELLO)
    ctx.devices?.control.watchVenue(venue.id);
    const { devices, occupancy, link } = venueView(ctx, venue);
    return {
      venueId: venue.id,
      venueName: venue.name,
      cyranoRunning: ctx.devices?.cyrano.running() ?? false,
      opp2Running: ctx.devices?.opp2.running() ?? false,
      strips: [...venue.strips]
        .sort((a, b) => a.number - b.number)
        .map(s => {
          const d = devices.find(x => x.strip === s.number);
          return {
            strip: s.number,
            ...(s.label ? { label: s.label } : {}),
            protocol: d?.device.protocol ?? null,
            piste: d?.piste ?? null,
            link: link(s.number),
            busy: occupancy.get(s.number) ?? null,
            last: d ? lastOf(ctx, venue.id, s.number, d.piste) : null,
          };
        }),
    };
  },

  sendStripDisplay: (ctx, { venueId, strips, weapon, left, right, clear }) => {
    const port = portOf(ctx);
    const venue = venueOrThrow(ctx, venueId);
    const request = { weapon, left, right, clear };
    if (isEmptyRequest(request)) {
      throw new CommandError(
        'invalid_input',
        'Rien à envoyer : arme, nom, nation ou remise à blanc'
      );
    }
    port.control.watchVenue(venue.id);
    const { devices, occupancy, link } = venueView(ctx, venue);
    return selectStrips(devices, strips).map((strip): StripSendResult => {
      const d = devices.find(x => x.strip === strip);
      const busy = occupancy.get(strip) ?? null;
      const outcome = stripSendOutcome({ device: d, busy, link: link(strip) });
      if (outcome === 'busy') return { strip, outcome, competitionId: busy!.competitionId };
      if (outcome !== 'sent' || !d) return { strip, outcome };
      const previous = lastOf(ctx, venue.id, strip, d.piste)?.panel;
      const panel = mergeStripPanel(previous, request);
      const sent = port.control.send(
        { venueId: venue.id, strip, piste: d.piste, protocol: d.device.protocol },
        panel
      );
      return { strip, outcome: sent ? 'sent' : 'unavailable' };
    });
  },

  setStripDevices: (ctx, { venueId, devices }) => {
    venueOrThrow(ctx, venueId);
    const venue = ctx.db.settings.setStripDevices(venueId, normalizeDeclarations(devices));
    ctx.emitChange?.({ scope: 'settings', competitionIds: [] });
    reload(ctx);
    return venue;
  },

  getStripDevicesFile: (ctx, { venueId }) => {
    const venue = venueOrThrow(ctx, venueId);
    const declared = venueDeclarations(venue.strips, toStripDevice).filter(d => d.device);
    return {
      content: exportStripDevicesFile(venue.name, declared),
      fileName: `appareils-${slug(venue.name)}.json`,
    };
  },

  importStripDevices: (ctx, { venueId, content, dryRun }) => {
    venueOrThrow(ctx, venueId);
    const read = readStripDevicesFile(content);
    if (!read.ok) {
      const reason = {
        invalid_json: 'JSON invalide',
        invalid_format: 'format non reconnu',
        empty: 'aucune piste',
      }[read.error];
      throw new CommandError('device_refused', `Fichier d’appareils illisible : ${reason}`);
    }
    const errors: { line: number; message: string }[] = [];
    const valid: (StripDeviceDeclaration & { line: number })[] = [];
    for (const { line, raw } of read.rows) {
      const parsed = StripDeclarationSchema.safeParse(raw);
      if (parsed.success)
        valid.push({ ...parsed.data, line } as StripDeviceDeclaration & { line: number });
      else errors.push({ line, message: issuesOf(parsed.error) });
    }
    for (const dup of duplicateStripLines(valid)) {
      errors.push({ line: dup.line, message: `piste ${dup.strip} déjà déclarée plus haut` });
    }
    errors.sort((a, b) => a.line - b.line);
    const applied = errors.length === 0 && !dryRun;
    if (applied) {
      ctx.db.settings.setStripDevices(venueId, normalizeDeclarations(valid));
      ctx.emitChange?.({ scope: 'settings', competitionIds: [] });
      reload(ctx);
    }
    return { applied, strips: valid.length, errors };
  },
};

type Ops = typeof devicesOperations;

/** Abonnement onStripControlChanged : accusés et liaisons du pilotage de la salle */
export const onStripControlChanged = (
  _ctx: CommandContext,
  _input: z.output<Ops['onStripControlChanged']['input']>,
  emit: (event: z.output<Ops['onStripControlChanged']['output']>) => void
): (() => void) => onStripControlChangeEvent(emit);
