/**
 * BPM - Escrime - Tour en vagues (docs/adr/0043, lot F4a) : lancer une vague, arrêter ou
 * reprendre les vagues. Remplacent launchRapieresWave / endRapieresWaves, gardées comme alias
 * (contract.ts) jusqu'à F4e.
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
} from './contractDef';

export const poolWavesOperations = {
  launchPoolWave: command({
    description:
      'Tour en vagues (ordre des matchs « waves » ou « waves_classic » de la formule) : lance la vague « wave » (ses matchs deviennent ceux à tirer ; 0 = aucune vague lancée ; les tablettes suivent la vague tant que l’écran de l’épreuve est ouvert). Refus : unsupported_format hors tour en vagues, invalid_wave si la vague n’a aucun match.',
    input: z.object({
      competitionId: CompetitionId,
      wave: z.number().int().min(0).max(200).describe('Vague à lancer (0 : aucune)'),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      wave: z.number().int(),
      matchIds: z.array(z.string()),
      revision: Revision,
    }),
    permission: 'score:write',
    mcp: { name: 'launch_pool_wave', title: 'Lancer une vague' },
  }),

  endPoolWaves: command({
    description:
      'Tour en vagues : arrête les vagues avant leur terme (« ended: true », passage au classement sur les matchs joués) ou les reprend (« ended: false »).',
    input: z.object({
      competitionId: CompetitionId,
      ended: z.boolean().describe('true : vagues arrêtées ; false : reprises'),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({ dryRun: z.boolean(), ended: z.boolean(), revision: Revision }),
    permission: 'score:write',
    mcp: { name: 'end_pool_waves', title: 'Arrêter ou reprendre les vagues' },
  }),
};
