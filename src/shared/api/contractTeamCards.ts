/**
 * BPM - Escrime - Cartons des épreuves par équipes par le moteur (docs/adr/0028, lot C1) :
 * carton E (arène Sabre Laser), carton individuel d'un relais, annulation par le Directoire
 * technique, retrait d'une équipe (o.99.7.a), carton P (non-combativité, lot C4). Journal :
 * TeamCardGiven, RelayCardGiven, PassivityCardGiven, TeamCardCancelled, RelayCardCancelled,
 * TeamWithdrawn. Schémas des cartons du bloc « teams ».
 * Licensed under GPL-3.0
 */
import { z } from 'zod';
import { CardReason } from '../types';
import { command, CommandId, CompetitionId, DryRun, Id } from './contractDef';

const ExpectedRevision = z
  .number()
  .int()
  .min(0)
  .optional()
  .describe('Révision attendue du journal (revision_conflict sinon)');
const Revision = z.number().int().optional();
const MatchId = Id.describe('Identifiant de la rencontre (getCompetitionState, bloc « teams »)');
const TeamCardType = z.enum(['white', 'yellow', 'red', 'black']);
const RelayCardType = z.enum(['WHITE', 'YELLOW', 'RED', 'BLACK']);

// ─── Bloc « teams » de getCompetitionState ──────────────────────────────────

/** Carton E d'une rencontre (arène Sabre Laser) */
export const TeamCardSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  type: TeamCardType,
  at: z.string(),
});

/** Carton individuel d'un relais ; motif et groupe nuls : carton de l'appareil de piste */
export const RelayCardSchema = z.object({
  id: z.string(),
  fencerId: z.string(),
  type: RelayCardType,
  reason: z.string().nullable(),
  group: z.number().int().nullable(),
  pointsAwarded: z.number(),
  excludes: z.boolean(),
  at: z.string(),
});

/** Carton P d'une rencontre de relais FIE (t.124), donné aux deux équipes */
export const PassivityCardSchema = z.object({
  id: z.string(),
  type: z.enum(['yellow', 'red', 'black']),
  at: z.string(),
});

/** Équipe retirée (abandon, o.99.7.a) ou exclue (noir individuel, o.99.7.b) */
export const TeamWithdrawalSchema = z.object({
  teamId: z.string(),
  matchId: z.string(),
  reason: z.enum(['exclusion', 'abandon']),
});

// ─── Opérations ─────────────────────────────────────────────────────────────

const Base = {
  competitionId: CompetitionId,
  matchId: MatchId,
  dryRun: DryRun,
  expectedRevision: ExpectedRevision,
  commandId: CommandId,
};

export const teamCardOperations = {
  giveTeamCard: command({
    description:
      'Arène Sabre Laser : carton E (désignation tardive) à une équipe de la rencontre ; sans « type », blanc puis jaune. Noir toujours accepté. ' +
      'Refus : unsupported_format, match_not_found, team_not_in_match, team_withdrawn, match_finished (rencontre suivante commencée). Journal : TeamCardGiven.',
    input: z.object({
      ...Base,
      teamId: Id.describe('Équipe sanctionnée'),
      type: TeamCardType.optional().describe('Type choisi ; absent : escalade'),
    }),
    output: z.object({
      dryRun: z.boolean(),
      matchId: z.string(),
      card: TeamCardSchema,
      revision: Revision,
    }),
    permission: 'score:write',
    mcp: { name: 'give_team_card', title: 'Donner un carton E' },
  }),

  giveRelayCard: command({
    description:
      'Épreuve par équipes : carton au tireur du côté A ou B dans un relais, en cours ou dernier terminé (rencontre suivante pas commencée). Exactement un de « reason » (type par l’escalade sur la rencontre) ou « type » (appareil de piste). ' +
      'Noir : tireur exclu (FencerWithdrawn) ; armes olympiques : rencontre perdue et équipe exclue (TeamMatchDecided, TeamWithdrawn, o.99.7.b). Sabre Laser : tireur seul. ' +
      'Refus : invalid_input, match_not_found, relay_not_found, relay_out_of_order, match_finished, team_withdrawn, already_withdrawn. Journal : RelayCardGiven.',
    input: z.object({
      ...Base,
      relayId: Id.describe('Relais (bouts[].id)'),
      side: z.enum(['A', 'B']).describe('Côté du tireur sanctionné'),
      reason: z.enum(CardReason).optional().describe('Motif (écran, tablette, MCP)'),
      type: RelayCardType.optional().describe('Type imposé (appareil de piste)'),
    }),
    output: z.object({
      dryRun: z.boolean(),
      matchId: z.string(),
      relayId: z.string(),
      card: RelayCardSchema,
      /** Noir : tireur exclu ; équipe exclue (armes olympiques) */
      fencerWithdrawn: z.boolean(),
      withdrawnTeamId: z.string().nullable(),
      revision: Revision,
    }),
    permission: 'score:write',
    mcp: { name: 'give_relay_card', title: 'Donner un carton dans un relais' },
  }),

  givePassivityCard: command({
    description:
      'Relais FIE (épée, fleuret, sabre) : carton P (non-combativité, t.124) donné aux deux équipes, escalade sur la rencontre : jaune P, rouge P, noir P. Le rouge P n’écrit pas de touche (elle est dans le score du relais). ' +
      'Noir P : la rencontre est décidée pour l’équipe au score supérieur des relais terminés (enregistrer d’abord le relais en cours), à égalité au meilleur classement (tableau : rang du tableau ; poule : classement de poule) — TeamMatchDecided. ' +
      'Refus : unsupported_format (Sabre Laser, arme à la carte, épreuve individuelle), match_not_found, team_withdrawn, match_finished (noir P déjà donné, rencontre décidée ou suivante commencée, noir P contraire au résultat), draw_needs_winner. Journal : PassivityCardGiven.',
    input: z.object(Base),
    output: z.object({
      dryRun: z.boolean(),
      matchId: z.string(),
      card: PassivityCardSchema,
      /** Noir P : équipe gagnante de la rencontre ; null sinon */
      winnerTeamId: z.string().nullable(),
      /** Rencontres de tableau formées par la décision */
      scheduledMatchIds: z.array(z.string()),
      revision: Revision,
    }),
    permission: 'score:write',
    mcp: { name: 'give_passivity_card', title: 'Donner un carton P (non-combativité)' },
  }),

  cancelTeamCard: command({
    description:
      'Directoire technique (écran, MCP) : annule un carton E, ou un carton P jaune ou rouge (le noir P a décidé la rencontre). Refus : permission_denied (tablette, appareil), match_not_found, card_not_found, match_finished (noir P). Journal : TeamCardCancelled.',
    input: z.object({
      ...Base,
      cardId: Id.describe('Carton E ou carton P (teamCards[].id, passivityCards[].id)'),
    }),
    output: z.object({
      dryRun: z.boolean(),
      matchId: z.string(),
      cardId: z.string(),
      revision: Revision,
    }),
    permission: 'score:write',
    mcp: { name: 'cancel_team_card', title: 'Annuler un carton E', destructive: true },
  }),

  cancelRelayCard: command({
    description:
      'Directoire technique (écran, MCP) : annule un carton individuel d’un relais. Le noir ne s’annule pas ainsi (reinstateFencer). Refus : permission_denied (tablette, appareil), match_not_found, card_not_found, already_withdrawn (noir). Journal : RelayCardCancelled.',
    input: z.object({ ...Base, cardId: Id.describe('Carton (bouts[].cards[].id)') }),
    output: z.object({
      dryRun: z.boolean(),
      matchId: z.string(),
      relayId: z.string(),
      cardId: z.string(),
      revision: Revision,
    }),
    permission: 'score:write',
    mcp: { name: 'cancel_relay_card', title: 'Annuler un carton de relais', destructive: true },
  }),

  withdrawTeam: command({
    description:
      'Relais par équipes : équipe incomplète qui abandonne (o.99.7.a). Rencontre perdue, l’équipe se retire et garde sa place (« N’a pas terminé ») ; ses rencontres de poule ne comptent plus (o.99.8). ' +
      'Refus : unsupported_format (arène), match_not_found, team_not_in_match, match_finished, team_withdrawn. Journal : TeamMatchDecided, TeamWithdrawn.',
    input: z.object({
      ...Base,
      teamId: Id.describe('Équipe qui abandonne'),
      reason: z.literal('abandon'),
    }),
    output: z.object({
      dryRun: z.boolean(),
      matchId: z.string(),
      teamId: z.string(),
      winnerTeamId: z.string(),
      scheduledMatchIds: z.array(z.string()),
      revision: Revision,
    }),
    permission: 'score:write',
    mcp: { name: 'withdraw_team', title: 'Retirer une équipe', destructive: true },
  }),
};
