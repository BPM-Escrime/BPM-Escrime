/**
 * BPM - Escrime - Plan des pistes d'une épreuve, donnée du moteur (docs/adr/0015, #2033) :
 * setStripStart, setStripAvailability (une épreuve, ou toutes les épreuves d'une journée dans
 * une transaction), getStripPlan. Écriture de competition_strip_plans et journal
 * StripStartChanged / StripAvailabilityChanged dans la même transaction ; signal `strips`
 * (l'écran relit, le serveur distant de l'épreuve reçoit le plan : main/remote/stripPlan).
 * Règles : shared/domain/planning.
 * Licensed under GPL-3.0
 */
import type { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type { stripOperations } from '../../../shared/api/contractStrips';
import { withStripAvailability } from '../../../shared/domain/planning/stripPlan';
import { publishCompetitionEvent } from '../api/events';
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

/** Épreuves visées : l'épreuve, ou toutes celles de la journée */
function targetsOf(ctx: CommandContext, input: In<'setStripAvailability'>): string[] {
  if (input.competitionId) return [getCompetitionOrThrow(ctx, input.competitionId).id];
  const day = input.eventDayId ? ctx.db.eventDays.getDay(input.eventDayId) : null;
  if (!day) {
    throw new CommandError('event_day_not_found', `Journée introuvable : ${input.eventDayId}`);
  }
  return day.competitionIds.filter(id => !!ctx.db.getCompetition(id));
}

export function setStripAvailability(
  ctx: CommandContext,
  input: In<'setStripAvailability'>,
  { now = new Date() }: Given = {}
): Out<'setStripAvailability'> {
  const targets = targetsOf(ctx, input);
  const at = now.toISOString();
  const touched: string[] = [];
  const plans: Out<'setStripAvailability'>['plans'] = [];
  // Journée : hors runCommand (pas de competitionId), d'où la transaction et le commandId ici
  const c: CommandContext = { ...ctx, commandId: ctx.commandId ?? uuidv4() };
  const write = () => {
    for (const id of targets) {
      const current = planOf(c, id);
      const next = withStripAvailability(current, input.strip, input.available);
      if (!next) {
        plans.push(current);
        continue;
      }
      touched.push(id);
      if (input.dryRun) {
        plans.push({ ...current, ...next });
        continue;
      }
      c.db.stripPlans.saveStripPlan(id, next, at);
      recordEvents(c, id, [
        {
          type: EVENT.stripAvailabilityChanged,
          payload: { strip: input.strip, available: input.available },
        },
      ]);
      plans.push(planOf(c, id));
    }
  };
  const dayWide = !input.competitionId;
  if (dayWide && !input.dryRun && typeof ctx.db.transaction === 'function') {
    ctx.db.transaction(write);
  } else {
    write();
  }
  if (input.dryRun) return { dryRun: true, changedCompetitionIds: touched, plans };
  changed(ctx, touched);
  // Une épreuve : runCommand diffuse la révision ; journée : chaque journal touché
  if (dayWide && ctx.db.eventLog) {
    for (const id of touched) {
      publishCompetitionEvent({
        type: 'journal:appended',
        competitionId: id,
        revision: ctx.db.eventLog.getRevision(id),
      });
    }
  }
  return { dryRun: false, changedCompetitionIds: touched, plans };
}

export const stripHandlers = {
  getStripPlan,
  setStripStart: (ctx: CommandContext, input: In<'setStripStart'>) => setStripStart(ctx, input),
  setStripAvailability: (ctx: CommandContext, input: In<'setStripAvailability'>) =>
    setStripAvailability(ctx, input),
};
