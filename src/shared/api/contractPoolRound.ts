/**
 * BPM - Escrime - Clôture d'un tour de poules (#1051, docs/adr/0017) : qualifiés du tour,
 * ex aequo à la barre (« ties », « tiedAtBar », docs/adr/0040).
 * Licensed under GPL-3.0
 */
import { z } from 'zod';
import {
  command,
  CommandId,
  CompetitionId,
  DryRun,
  ExpectedRevision,
  Revision,
  TiedAtBarSchema,
  TiesAtBarInput,
} from './contractDef';

export const poolRoundOperations = {
  closePoolRound: command({
    description:
      'Clôt le tour de poules courant (toutes les poules terminées) : qualifiés selon le classement du tour (formule, puis réglage du nombre de qualifiés, ou « qualifierCount »), non-qualifiés éliminés, tour archivé ; le tour suivant se pointe puis se tire. ' +
      '« dryRun: true » donne le nombre de qualifiés et d’éliminés, et les ex aequo à la barre au-delà du quota (« tiedAtBar »), sans rien écrire. « ties » choisit le sort de ces ex aequo pour cette coupe (docs/adr/0040). Refus sous 4 qualifiés.',
    input: z.object({
      competitionId: CompetitionId,
      qualifierCount: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .optional()
        .describe('Nombre de qualifiés imposé'),
      ties: TiesAtBarInput,
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      round: z.number().int(),
      nextRound: z.number().int(),
      qualifierCount: z.number().int().nullable(),
      qualified: z.number().int(),
      eliminated: z.number().int(),
      tiedAtBar: TiedAtBarSchema.nullable(),
      revision: Revision,
    }),
    permission: 'score:write',
    mcp: { name: 'close_pool_round', title: 'Clore le tour de poules', destructive: true },
  }),
};
