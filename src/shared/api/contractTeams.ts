/**
 * BPM - Escrime - Épreuves par équipes par le moteur (docs/adr/0024, lot E1) : inscription des
 * équipes et composition (non journalisées, docs/adr/0018), tirage des poules d'équipes
 * (TeamPoolsGenerated, puis un TeamMatchScheduled par rencontre), bloc « teams » de
 * getCompetitionState. Les tables teams, team_fencers, team_matches, team_bouts sont la
 * projection des équipes.
 * Licensed under GPL-3.0
 */
import { z } from 'zod';
import { command, CommandId, CompetitionId, DryRun, Id } from './contractDef';

const ExpectedRevision = z
  .number()
  .int()
  .min(0)
  .optional()
  .describe(
    'Révision attendue du journal : refus « revision_conflict » si une autre commande du contrat a écrit entre-temps.'
  );
const Revision = z.number().int().optional();
const Name = z.string().trim().min(1).max(200);

// ─── Bloc « teams » de getCompetitionState ──────────────────────────────────

const TeamFencerSchema = z.object({
  fencerId: z.string(),
  fencerLastName: z.string(),
  fencerFirstName: z.string(),
  /** Ordre dans l'équipe (titulaires d'abord, dès 1) */
  teamOrder: z.number().int(),
  isReserve: z.boolean(),
});

const TeamRelaySchema = z.object({
  id: z.string(),
  boutOrder: z.number().int(),
  fencerAId: z.string(),
  fencerBId: z.string(),
  /** Score du relais (le fait) ; le cumul se calcule */
  scoreA: z.number().int(),
  scoreB: z.number().int(),
  maxScore: z.number().int(),
  status: z.string(),
  winnerId: z.string().nullable(),
});

const TeamMatchSchema = z.object({
  id: z.string(),
  /** Poule ; null au tableau */
  poolNumber: z.number().int().nullable(),
  /** Tour du tableau ; en poule, créneau de l'arène Sabre Laser */
  round: z.number().int().nullable(),
  /** Position au tableau ; null en poule */
  position: z.number().int().nullable(),
  teamAId: z.string(),
  teamBId: z.string(),
  /** Touches cumulées de la rencontre */
  scoreBoutsA: z.number().int(),
  scoreBoutsB: z.number().int(),
  status: z.string(),
  winnerId: z.string().nullable(),
  currentBoutIndex: z.number().int(),
  bouts: z.array(TeamRelaySchema),
});

export const TeamsStateSchema = z.object({
  format: z.enum(['fie-relay', 'laser-arena']),
  /** Titulaires par équipe */
  teamSize: z.number().int(),
  teams: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      club: z.string(),
      fencers: z.array(TeamFencerSchema),
    })
  ),
  poolMatches: z.array(TeamMatchSchema),
  tableauMatches: z.array(TeamMatchSchema),
  /** Classement de poule (dérivé) : relais FIE par victoires, arène par points marqués */
  poolRanking: z.array(
    z.object({
      teamId: z.string(),
      rank: z.number().int(),
      victories: z.number().int(),
      defeats: z.number().int(),
      draws: z.number().int(),
      relaysWon: z.number().int(),
      relaysLost: z.number().int(),
      pointsFor: z.number().int(),
      pointsAgainst: z.number().int(),
      /** Égalité à départager par tirage au sort (arène) */
      tied: z.boolean(),
    })
  ),
});
export type TeamsStateDTO = z.infer<typeof TeamsStateSchema>;

const TeamSchema = z.object({ id: z.string(), name: z.string(), club: z.string() });

// ─── Opérations ─────────────────────────────────────────────────────────────

export const teamOperations = {
  registerTeam: command({
    description:
      'Épreuve par équipes : inscrit une équipe (nom, club ; club = nom par défaut). Inscription (docs/adr/0018), sans journal. ' +
      'Refus : épreuve individuelle (unsupported_format).',
    input: z.object({
      competitionId: CompetitionId,
      name: Name.describe('Nom de l’équipe'),
      club: Name.optional().describe('Club (défaut : le nom)'),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({ dryRun: z.boolean(), team: TeamSchema.nullable(), revision: Revision }),
    permission: 'fencers:write',
  }),

  unregisterTeam: command({
    description:
      'Épreuve par équipes : supprime une équipe et sa composition. Refus après le tirage (draw_done), équipe inconnue (team_not_found).',
    input: z.object({
      competitionId: CompetitionId,
      teamId: Id.describe('Identifiant de l’équipe'),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({ dryRun: z.boolean(), teamId: z.string(), revision: Revision }),
    permission: 'fencers:write',
  }),

  assignTeamFencer: command({
    description:
      'Épreuve par équipes : place un tireur de l’épreuve dans une équipe, titulaire ou remplaçant, à un ordre (déplacement dans la même équipe admis). ' +
      'Refus après le tirage (draw_done : seul le remplacement change alors la composition), équipe inconnue (team_not_found), tireur absent de l’épreuve (fencer_not_found) ou déjà dans une autre équipe (invalid_composition).',
    input: z.object({
      competitionId: CompetitionId,
      teamId: Id.describe('Identifiant de l’équipe'),
      fencerId: Id.describe('Identifiant du tireur'),
      teamOrder: z.number().int().min(1).max(20).describe('Ordre dans l’équipe (dès 1)'),
      isReserve: z.boolean().optional().describe('Remplaçant (défaut : titulaire)'),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      teamId: z.string(),
      fencerId: z.string(),
      revision: Revision,
    }),
    permission: 'fencers:write',
  }),

  unassignTeamFencer: command({
    description:
      'Épreuve par équipes : retire un tireur d’une équipe. Refus après le tirage (draw_done), équipe inconnue (team_not_found), tireur absent de l’équipe (fencer_not_found).',
    input: z.object({
      competitionId: CompetitionId,
      teamId: Id.describe('Identifiant de l’équipe'),
      fencerId: Id.describe('Identifiant du tireur'),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      teamId: z.string(),
      fencerId: z.string(),
      revision: Revision,
    }),
    permission: 'fencers:write',
  }),

  generateTeamPools: command({
    description:
      'Épreuve par équipes : tire les poules d’équipes et crée leurs rencontres, chacune avec ses relais fixés (titulaires par ordre, ordre FIE des relais à 3 en épée, fleuret, sabre). ' +
      'Relais FIE : poule unique, tous contre tous. Arène Sabre Laser : calendrier figé du règlement, 8 ou 12 équipes seulement. ' +
      'Refus : épreuve individuelle (unsupported_format), moins de 2 équipes ou arène hors 8/12 (invalid_composition), titulaires manquants (team_incomplete), poules déjà tirées sans « replace » (draw_done), relais déjà joués (pools_have_scores), tableau d’équipes créé (bracket_exists). ' +
      'Journal : TeamPoolsGenerated, puis un TeamMatchScheduled par rencontre.',
    input: z.object({
      competitionId: CompetitionId,
      replace: z
        .boolean()
        .optional()
        .describe('Remplacer des poules déjà tirées dont aucun relais n’est joué'),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      pools: z.array(z.object({ number: z.number().int(), teamIds: z.array(z.string()) })),
      matchIds: z.array(z.string()),
      relayCount: z.number().int(),
      revision: Revision,
    }),
    permission: 'score:write',
    mcp: {
      name: 'generate_team_pools',
      title: 'Tirer les poules d’équipes',
      destructive: true,
    },
  }),
};
