/**
 * BPM - Escrime - Tableaux séparés après les poules : extraction d'un groupe dans une épreuve
 * séparée (docs/adr/0024, lot A3). Une transaction couvre les deux épreuves ; journal :
 * GroupSplitOff (épreuve d'origine), SplitRankingImported (épreuve séparée), même commandId.
 * Scission de la formule (docs/adr/0039) : splitCompetition, une compétition fille par
 * branche, mêmes événements ; historique `splitHistory` dans l'état de l'épreuve d'origine.
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

/** Scission faite (état de session de l'épreuve d'origine, docs/adr/0039) */
export const SplitHistorySchema = z.array(
  z.object({ label: z.string(), competitionId: z.string(), fencerIds: z.array(z.string()) })
);

const SplitFencer = z.object({
  id: z.string(),
  lastName: z.string(),
  firstName: z.string(),
});

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

  splitCompetition: command({
    description:
      'Scission de la formule (dernière phase, docs/adr/0039) : quand la phase qui la précède est close (tour de poules terminé, tableau arrêté clos), répartit son classement entre les branches ' +
      '(sexe ou catégorie du tireur ; rang : nombre ou pourcentage de l’effectif entrant, ex aequo à la borne gardés, la dernière branche prend le reste ; manuelle : « assignments »). ' +
      'Dans une seule transaction, chaque branche devient une compétition fille (titre « titre d’origine – libellé », formule de la branche, tireurs copiés avec leur rang dans la branche) ; l’épreuve d’origine garde les autres tireurs. ' +
      '« dryRun: true » rend la répartition, les tireurs sans valeur pour le critère et le classement d’entrée (« entrants »), sans refus. ' +
      'Toutes les branches partent en compétitions filles (« stayInCompetition » vaut false) ; scission par sexe dont toutes les branches restent dans l’épreuve (compétition couplée, tableaux séparés) : refus invalid_settings. ' +
      'Refus : invalid_settings (pas de scission en dernière phase), pools_not_complete, tableau_stage_not_complete, split_value_missing (tireur sans sexe, sans catégorie ou non affecté), split_group_not_found (épreuve déjà scindée), not_enough_fencers (branche vide).',
    input: z.object({
      competitionId: CompetitionId,
      assignments: z
        .array(
          z.object({
            fencerId: z.string().trim().min(1).max(200),
            branch: z.string().trim().min(1).max(100).describe('Libellé de la branche'),
          })
        )
        .max(2000)
        .optional()
        .describe('Scission manuelle : branche de chaque tireur (libellé)'),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      branches: z.array(
        z.object({
          label: z.string(),
          /** Compétition fille créée (null : dryRun) */
          competitionId: z.string().nullable(),
          fencers: z.array(SplitFencer.extend({ rank: z.number().int() })),
          /** Toujours false : une scission lancée crée une fille par branche (ADR-0039, mélange retiré) */
          stayInCompetition: z.boolean(),
        })
      ),
      /** Tireurs sans valeur pour le critère */
      missing: z.array(SplitFencer),
      /** Classement d'entrée de la scission, dans l'ordre (répartition manuelle) */
      entrants: z.array(
        SplitFencer.extend({
          rank: z.number().int(),
          gender: z.string().nullable(),
          club: z.string().nullable(),
          birthDate: z.string().nullable(),
          category: z.string().nullable(),
        })
      ),
      revision: Revision,
    }),
    permission: 'competition:write',
    mcp: { name: 'split_competition', title: 'Scinder l’épreuve en compétitions filles' },
  }),
};
