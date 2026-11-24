/**
 * BPM - Escrime - Plan des pistes d'une épreuve, donnée du moteur (docs/adr/0015, #2033) :
 * piste de départ et pistes indisponibles. Journal : StripStartChanged,
 * StripAvailabilityChanged. Signal `strips:changed` (ADR-0010) : écran relu, plan envoyé au
 * serveur distant de l'épreuve.
 * Licensed under GPL-3.0
 */
import { z } from 'zod';
import { command, CommandId, CompetitionId, DryRun, Id, query } from './contractDef';

const Strip = z.number().int().min(1).max(999);
const ExpectedRevision = z
  .number()
  .int()
  .min(0)
  .optional()
  .describe('Révision attendue du journal (revision_conflict sinon)');

export const StripPlanSchema = z.object({
  competitionId: z.string(),
  /** Première piste de l'épreuve (les pistes inférieures sont masquées aux écrans) */
  start: z.number().int(),
  /** Pistes indisponibles, triées */
  unavailable: z.array(z.number().int()),
  /** Dernière écriture ; null : plan par défaut, jamais écrit */
  updatedAt: z.string().nullable(),
});

export const stripOperations = {
  setStripStart: command({
    description:
      'Plan des pistes : première piste de l’épreuve (les pistes inférieures, d’autres épreuves de la journée, sont masquées aux écrans ; une poule sans piste attend dans l’intervalle). Journal : StripStartChanged.',
    input: z.object({
      competitionId: CompetitionId,
      start: Strip.describe('Première piste, de 1 à 999'),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      changed: z.boolean(),
      plan: StripPlanSchema,
      revision: z.number().int().optional(),
    }),
    permission: 'competition:write',
    mcp: { name: 'set_strip_start', title: 'Piste de départ de l’épreuve', idempotent: true },
  }),
  setStripAvailability: command({
    description:
      'Plan des pistes : marque une piste indisponible (panne) ou la remet en service. Exactement un de « competitionId » (une épreuve) ou « eventDayId » (toutes les épreuves de la journée, une transaction : panne de la salle). ' +
      'La répartition des poules et du tableau, les tablettes et l’affectation des pistes de la journée l’évitent. Refus : competition_not_found, event_day_not_found, invalid_input. Journal : StripAvailabilityChanged (une épreuve déjà dans l’état demandé n’en reçoit pas).',
    input: z
      .object({
        competitionId: CompetitionId.optional(),
        eventDayId: Id.describe('Identifiant de la journée (listEventDays)').optional(),
        strip: Strip.describe('Numéro de piste, de 1 à 999'),
        available: z.boolean().describe('false : piste indisponible ; true : remise en service'),
        dryRun: DryRun,
      })
      .refine(i => (i.competitionId === undefined) !== (i.eventDayId === undefined), {
        message: 'Exactement un de « competitionId » ou « eventDayId »',
      }),
    output: z.object({
      dryRun: z.boolean(),
      /** Épreuves dont le plan change (ou changerait, dryRun) */
      changedCompetitionIds: z.array(z.string()),
      plans: z.array(StripPlanSchema),
      revision: z.number().int().optional(),
    }),
    permission: 'competition:write',
    mcp: { name: 'set_strip_availability', title: 'Piste disponible ou non', idempotent: true },
  }),
  getStripPlan: query({
    description:
      'Plan des pistes de l’épreuve : première piste et pistes indisponibles (plan par défaut : piste 1, aucune indisponible ; updatedAt null).',
    input: z.object({ competitionId: CompetitionId }),
    output: StripPlanSchema,
    permission: 'competition:read',
    mcp: { name: 'get_strip_plan', title: 'Plan des pistes' },
  }),
};
