/**
 * BPM - Escrime - Relevés de l'épreuve (#1981 lot 2)
 * Historique des scores, commentaires des formateurs, signatures du tableau, chiffres de
 * l'épreuve : lectures seules, à la place des appels window.electronAPI.db de l'écran.
 * Licensed under GPL-3.0
 */
import { z } from 'zod';
import type { Score } from '../types';
import { CompetitionId, FencerSchema, Id, query } from './contractDef';

const ScorePart = z.custom<Partial<Score>>().nullable();

const ScoreAuditSchema = z.object({
  id: z.string(),
  matchId: z.string(),
  arenaId: z.string().nullable(),
  poolId: z.string().nullable(),
  matchNumber: z.number().nullable(),
  poolNumber: z.number().nullable(),
  previousScoreA: ScorePart,
  previousScoreB: ScorePart,
  newScoreA: ScorePart,
  newScoreB: ScorePart,
  changedBy: z.string(),
  changedAt: z.string(),
  reason: z.string().nullable(),
  refereeId: z.string().nullable(),
  refereeName: z.string().nullable(),
  ipAddress: z.string().nullable(),
  tableauRound: z.number().nullable().optional(),
  tableauPosition: z.number().nullable().optional(),
});

export const reportOperations = {
  listScoreAudit: query({
    description:
      'Historique des scores d’une épreuve : ancien et nouveau score, auteur, arbitre, motif de correction, adresse de la tablette (retirée sur le réseau).',
    input: z.object({ competitionId: CompetitionId }),
    output: z.array(ScoreAuditSchema),
    permission: 'competition:read',
  }),

  listRefereeComments: query({
    description:
      'Commentaires des formateurs sur les arbitres d’une épreuve (espace formateurs), du plus ancien au plus récent.',
    input: z.object({ competitionId: CompetitionId, refereeId: Id.optional() }),
    output: z.array(
      z.object({
        id: z.string(),
        competitionId: z.string(),
        refereeId: z.string(),
        author: z.string().nullable(),
        comment: z.string(),
        matchLabel: z.string().nullable(),
        createdAt: z.string(),
      })
    ),
    permission: 'competition:read',
  }),

  getTableauSignatures: query({
    description:
      'Signatures des feuilles de match du tableau (tablette) : une image par tireur et par match.',
    input: z.object({ matchIds: z.array(Id).max(512) }),
    output: z.array(
      z.object({ matchId: z.string(), fencerId: z.string(), signatureData: z.string() })
    ),
    permission: 'competition:read',
  }),

  getCompetitionStats: query({
    description:
      'Chiffres de l’épreuve : tireurs, matchs de poule joués et à jouer, durée moyenne, dix meilleurs tireurs (victoires puis touches données).',
    input: z.object({ competitionId: CompetitionId }),
    output: z.object({
      totalFencers: z.number(),
      totalMatches: z.number(),
      completedMatches: z.number(),
      averageMatchDuration: z.number(),
      topFencers: z.array(
        z.object({
          fencer: FencerSchema,
          victories: z.number(),
          touchesScored: z.number(),
          touchesReceived: z.number(),
        })
      ),
    }),
    permission: 'competition:read',
  }),
};
