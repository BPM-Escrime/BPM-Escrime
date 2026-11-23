/**
 * BellePoule Modern - Événements simulés du remplissage automatique (#1981)
 * Durée, touches par zone et cartons inventés pour un match rempli automatiquement (essais,
 * démonstration), lus par l'analytique. Pas un fait de l'épreuve : rien au journal
 * (docs/adr/0018), à la place de l'ancien canal db:replaceSimulatedMatchEvents.
 * Licensed under GPL-3.0
 */
import { z } from 'zod';
import { CompetitionId, Id, command } from './contractDef';

const Stamp = z.string().max(40);

const SimulatedTouchSchema = z.object({
  id: Id,
  fencerId: Id,
  zone: z.string().max(8),
  points: z.number(),
  timestamp: Stamp,
  isValidInSuddenDeath: z.boolean().optional(),
  isReversed: z.boolean().optional(),
});

const SimulatedCardSchema = z.object({
  id: Id,
  fencerId: Id,
  cardType: z.string().max(16),
  reason: z.string().max(64),
  cardGroup: z.number().int(),
  timestamp: Stamp,
  pointsAwarded: z.number(),
  resultingExclusion: z.boolean().optional(),
});

export const simulationOperations = {
  replaceSimulatedMatchEvents: command({
    description:
      'Remplace les événements simulés d’un match rempli automatiquement (durée, touches, cartons) ; events null : les efface. ' +
      '« found » faux : match pas encore en base. Données d’essai pour l’analytique, rien au journal.',
    input: z.object({
      competitionId: CompetitionId,
      matchId: Id,
      events: z
        .object({
          timing: z.object({
            startTime: Stamp.nullable(),
            endTime: Stamp.nullable(),
            duration: z.number().nullable(),
          }),
          touches: z.array(SimulatedTouchSchema).max(500),
          cards: z.array(SimulatedCardSchema).max(100),
        })
        .nullable(),
    }),
    output: z.object({ found: z.boolean() }),
    permission: 'score:write',
  }),
};
