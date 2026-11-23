/**
 * BPM - Escrime - Opérations de l'espace « Vue DT » (#1981 lot 3, docs/adr/0020)
 * Consultation de l'épreuve dans un navigateur du réseau de la salle, en lecture seule.
 * Licensed under GPL-3.0
 */
import { z } from 'zod';
import { command, CommandId, CompetitionId, DryRun, query } from './contractDef';

export const dtViewOperations = {
  configureDtView: command({
    description:
      'Ouvre ou ferme l’espace « Vue DT » du serveur distant de l’épreuve : consultation de l’épreuve dans un navigateur du réseau de la salle, en lecture seule (docs/adr/0020). Mot de passe requis pour ouvrir ; tout changement ferme les vues ouvertes.',
    input: z.object({
      competitionId: CompetitionId,
      enabled: z.boolean().optional(),
      /** Vide : mot de passe retiré (l'espace doit alors être fermé) */
      password: z.string().max(200).optional(),
      dryRun: DryRun,
      commandId: CommandId,
    }),
    output: z.object({ dryRun: z.boolean(), enabled: z.boolean(), configured: z.boolean() }),
    permission: 'competition:write',
  }),

  getDtViewStatus: query({
    description:
      'État de l’espace « Vue DT » de l’épreuve : saisie distante démarrée, espace ouvert, mot de passe défini (docs/adr/0020).',
    input: z.object({ competitionId: CompetitionId }),
    output: z.object({ running: z.boolean(), enabled: z.boolean(), configured: z.boolean() }),
    permission: 'competition:read',
  }),
};
