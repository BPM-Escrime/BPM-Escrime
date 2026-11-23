/**
 * BPM - Escrime - Événements d'un match : arène (#2175) et remplissage automatique (#1981)
 * Cartons, touches par zone, sorties de piste et chrono relevés par l'arène à la fin d'un
 * combat (recordMatchEvents), ou inventés pour un match rempli automatiquement
 * (replaceSimulatedMatchEvents). Lus par la chronologie et l'analytique. Détails, pas des faits
 * de l'épreuve : rien au journal (docs/adr/0007, 0018) ; le score passe par recordScore.
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

const ArenaExitSchema = z.object({
  id: Id,
  fencerId: Id,
  exitType: z.enum(['arena_exit', 'arena_exit_voluntary']),
  timestamp: Stamp,
  pointsAwarded: z.number(),
});

export const simulationOperations = {
  recordMatchEvents: command({
    description:
      'Événements d’un combat relevés par l’arène (cartons, touches par zone, sorties de piste, chrono) : remplacent ceux du match d’un bloc ; listes vides : effacés (rappel du match précédent). ' +
      '« found » faux : match pas en base. Détails du combat, rien au journal ; le score passe par recordScore.',
    input: z.object({
      competitionId: CompetitionId,
      matchId: Id.describe('Identifiant du match en base (composite pour le tableau)'),
      cards: z.array(SimulatedCardSchema).max(100),
      touches: z.array(SimulatedTouchSchema).max(500),
      exits: z.array(ArenaExitSchema).max(200),
      timing: z
        .object({ startTime: Stamp, endTime: Stamp, duration: z.number().min(0) })
        .optional()
        .describe('Absent : chrono laissé tel quel'),
    }),
    output: z.object({ found: z.boolean() }),
    permission: 'score:write',
  }),

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
