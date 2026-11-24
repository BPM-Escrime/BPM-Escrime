/**
 * BPM - Escrime - Plan des pistes d'une épreuve, donnée du moteur (docs/adr/0015, #2033) :
 * setStripStart, setStripAvailability (une épreuve, ou toutes les épreuves d'une journée : une
 * runCommand par épreuve dans une transaction englobante), getStripPlan. Écriture de
 * competition_strip_plans et journal StripStartChanged / StripAvailabilityChanged dans la même
 * transaction ; signal `strips` (l'écran relit, le serveur distant de l'épreuve reçoit le
 * plan : main/remote/stripPlan). Règles : shared/domain/planning.
 * Licensed under GPL-3.0
 */
import type { z } from 'zod';
import type { stripOperations } from '../../../shared/api/contractStrips';
import { withStripAvailability } from '../../../shared/domain/planning/stripPlan';
import { CommandError, type CommandContext } from './context';
import { getCompetitionOrThrow } from './competitions';
import { EVENT, recordEvents } from './eventLog';

type Ops = typeof stripOperations;
type Out<N extends keyof Ops> = z.output<Ops[N]['output']>;
type In<N extends keyof Ops> = z.output<Ops[N]['input']>;

/** Heure injectée (ADR-0002) ; défaut : tirée ici */
export interface Given {
  now?: Date;
}

const planOf = (ctx: CommandContext, competitionId: string) => ({
  competitionId,
  ...ctx.db.stripPlans.getStripPlan(competitionId),
});

const changed = (ctx: CommandContext, competitionIds: string[]) => {
  if (competitionIds.length) ctx.emitChange?.({ scope: 'strips', competitionIds });
};

export function getStripPlan(ctx: CommandContext, { competitionId }: In<'getStripPlan'>) {
  return planOf(ctx, getCompetitionOrThrow(ctx, competitionId).id);
}

export function setStripStart(
  ctx: CommandContext,
  input: In<'setStripStart'>,
  { now = new Date() }: Given = {}
): Out<'setStripStart'> {
  const id = getCompetitionOrThrow(ctx, input.competitionId).id;
  const current = planOf(ctx, id);
  const isChange = current.start !== input.start;
  if (input.dryRun || !isChange) {
    return { dryRun: !!input.dryRun, changed: isChange, plan: { ...current, start: input.start } };
  }
  ctx.db.stripPlans.saveStripPlan(id, { ...current, start: input.start }, now.toISOString());
  recordEvents(ctx, id, [{ type: EVENT.stripStartChanged, payload: { start: input.start } }]);
  changed(ctx, [id]);
  return { dryRun: false, changed: true, plan: planOf(ctx, id) };
}

/** Épreuves de la journée (celles qui existent encore) */
function dayCompetitions(ctx: CommandContext, eventDayId: string | undefined): string[] {
  const day = eventDayId ? ctx.db.eventDays.getDay(eventDayId) : null;
  if (!day) {
    throw new CommandError('event_day_not_found', `Journée introuvable : ${eventDayId}`);
  }
  return day.competitionIds.filter(id => !!ctx.db.getCompetition(id));
}

type StripPlanOut = Out<'setStripAvailability'>['plans'][number];
type Applied = { changed: boolean; plan: StripPlanOut };

/** Une épreuve : plan changé (ou qui changerait, dryRun) et son événement au journal */
function applyAvailability(
  ctx: CommandContext,
  id: string,
  input: In<'setStripAvailability'>,
  at: string
): Applied {
  const current = planOf(ctx, id);
  const next = withStripAvailability(current, input.strip, input.available);
  if (!next) return { changed: false, plan: current };
  if (input.dryRun) return { changed: true, plan: { ...current, ...next } };
  ctx.db.stripPlans.saveStripPlan(id, next, at);
  recordEvents(ctx, id, [
    {
      type: EVENT.stripAvailabilityChanged,
      payload: { strip: input.strip, available: input.available },
    },
  ]);
  return { changed: true, plan: planOf(ctx, id) };
}

/** Moteur : une runCommand par épreuve dans une transaction englobante (api/engine) */
export type RunAcross = <T>(
  ctx: CommandContext,
  competitionIds: readonly string[],
  options: { commandId?: string },
  fn: (commandCtx: CommandContext, competitionId: string) => T
) => { commandId: string; results: Array<{ competitionId: string; result: T }> };

/**
 * Une épreuve : appelée dans la runCommand de l'épreuve (invoke). Journée (`eventDayId`) : une
 * runCommand par épreuve sous un commandId commun, tout ou rien (`across`) ; dryRun : rien
 * d'écrit, aucune transaction. `expectedRevision` refusé par le contrat avec `eventDayId`.
 */
export function setStripAvailability(
  ctx: CommandContext,
  input: In<'setStripAvailability'>,
  { now = new Date(), across }: Given & { across?: RunAcross } = {}
): Out<'setStripAvailability'> {
  const at = now.toISOString();
  let results: Array<{ competitionId: string; result: Applied }>;
  if (input.competitionId) {
    const id = getCompetitionOrThrow(ctx, input.competitionId).id;
    results = [{ competitionId: id, result: applyAvailability(ctx, id, input, at) }];
  } else {
    const ids = dayCompetitions(ctx, input.eventDayId);
    const apply = (c: CommandContext, id: string) => applyAvailability(c, id, input, at);
    if (input.dryRun) {
      results = ids.map(id => ({ competitionId: id, result: apply(ctx, id) }));
    } else {
      if (!across) throw new CommandError('internal', 'Journée : moteur indisponible');
      results = across(ctx, ids, { commandId: input.commandId }, apply).results;
    }
  }
  const touched = results.filter(r => r.result.changed).map(r => r.competitionId);
  const plans = results.map(r => r.result.plan);
  if (input.dryRun) return { dryRun: true, changedCompetitionIds: touched, plans };
  changed(ctx, touched);
  return { dryRun: false, changedCompetitionIds: touched, plans };
}

/** Opérations du plan des pistes ; `across` : runCommand par épreuve du moteur (journée) */
export const stripHandlers = (across: RunAcross) => ({
  getStripPlan,
  setStripStart: (ctx: CommandContext, input: In<'setStripStart'>) => setStripStart(ctx, input),
  setStripAvailability: (ctx: CommandContext, input: In<'setStripAvailability'>) =>
    setStripAvailability(ctx, input, { across }),
});
