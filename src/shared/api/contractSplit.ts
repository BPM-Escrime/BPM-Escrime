/**
 * BPM - Escrime - Tableaux séparés après les poules : extraction d'un groupe dans une épreuve
 * séparée (docs/adr/0024, lot A3). Une transaction couvre les deux épreuves ; journal :
 * GroupSplitOff (épreuve d'origine), SplitRankingImported (épreuve séparée), même commandId.
 * Licensed under GPL-3.0
 */
import { z } from 'zod';
import { command, CommandId, CompetitionId, DryRun } from './contractDef';

export const splitOperations = {
  splitOffGroup: command({
    description:
      'Tableaux séparés après les poules : extrait un groupe (« F », « M ») dans une épreuve séparée. ' +
      'Dans une seule transaction : crée l’épreuve (mêmes réglages, sans le mode couplé), y copie les tireurs du groupe (pointés, rang après poules), ' +
      'y écrit le classement après poules du groupe (phase Classement), puis note l’épreuve séparée sur l’épreuve d’origine (le groupe n’y a plus de tableau). ' +
      'Refus : épreuve sans tableaux séparés (invalid_input), groupe absent du classement ou déjà extrait (split_group_not_found), tableau du groupe déjà tiré (bracket_exists).',
    input: z.object({
      competitionId: CompetitionId,
      group: z.string().trim().min(1).max(20).describe('Groupe à extraire (« F », « M »)'),
      title: z.string().trim().min(1).max(200).describe('Titre de l’épreuve séparée'),
      dryRun: DryRun,
      expectedRevision: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
          'Révision attendue du journal de l’épreuve d’origine : refus « revision_conflict » si une autre commande du contrat a écrit entre-temps.'
        ),
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      /** Épreuve séparée créée (null : dryRun) */
      competitionId: z.string().nullable(),
      fencers: z.number().int(),
      /** Révision du journal de l'épreuve d'origine */
      revision: z.number().int().optional(),
    }),
    permission: 'competition:write',
    mcp: { name: 'split_off_group', title: 'Extraire un groupe en épreuve séparée' },
  }),
};
