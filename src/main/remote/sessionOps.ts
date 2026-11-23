/**
 * BPM - Escrime - Création de session et mise à jour de score depuis la base (#1240)
 * Extrait de RemoteScoreServer : l'état reste dans le serveur, exposé par accesseurs (contexte).
 * Licensed under GPL-3.0
 */
import { MatchStatus, type Score } from '../../shared/types';
import type { ArenaMatch, RemoteScoreUpdate, RemoteSession } from '../../shared/types/remote';
import type { RemoteScoreServer } from '../remoteScoreServer';
import { logger, LogCategory } from '../../shared/services/logger';

type S = RemoteScoreServer;

/** État et services du serveur utilisés par ce module. */
export interface SessionOpsContext {
  readonly arenas: S['arenas'];
  readonly db: S['db'];
  readonly sessionMatchScores: S['sessionMatchScores'];
  readonly sessionMatches: S['sessionMatches'];
  readonly assignMatchToArena: S['assignMatchToArena'];
  readonly loadSessionReferees: S['loadSessionReferees'];
  readonly setArenaCount: S['setArenaCount'];
  readonly updateArenaScore: S['updateArenaScore'];
}

export async function createSession(
  ctx: SessionOpsContext,
  competitionId: string,
  strips: number
): Promise<RemoteSession> {
  logger.info(
    LogCategory.NETWORK,
    `[RemoteScoreServer] Création d'une session pour la compétition ${competitionId} avec ${strips} pistes...`
  );

  const competition = ctx.db.getCompetition(competitionId);
  if (!competition) {
    logger.error(
      LogCategory.NETWORK,
      `[RemoteScoreServer] ERREUR: Compétition ${competitionId} non trouvée`
    );
    throw new Error('Compétition non trouvée');
  }
  logger.info(LogCategory.NETWORK, `[RemoteScoreServer] Compétition trouvée: ${competition.title}`);

  // Le nombre de pistes est déjà défini côté client en fonction du nombre de poules
  // On l'utilise directement pour configurer les arènes
  logger.info(
    LogCategory.NETWORK,
    `[RemoteScoreServer] Configuration du nombre d'arènes: ${strips}`
  );
  ctx.setArenaCount(strips);

  // Récupérer les matchs en attente et les assigner aux arènes
  const pendingMatches = ctx.db.getPendingMatches(competitionId);
  logger.info(
    LogCategory.NETWORK,
    `[RemoteScoreServer] ${pendingMatches.length} matchs en attente trouvés`
  );

  // Assigner les matchs en attente aux arènes
  pendingMatches.slice(0, strips).forEach((match, index) => {
    const arenaId = `arena${index + 1}`;
    const arenaMatch: ArenaMatch = {
      id: match.id,
      poolId: match.poolId || '',
      fencerA: match.fencerA!,
      fencerB: match.fencerB!,
      scoreA: match.scoreA?.value ?? 0,
      scoreB: match.scoreB?.value ?? 0,
      status: match.status === 'in_progress' ? 'in_progress' : 'pending',
      startTime: match.status === 'in_progress' ? new Date() : null,
      endTime: null,
    };
    ctx.assignMatchToArena(arenaId, arenaMatch);
    logger.info(
      LogCategory.NETWORK,
      `[RemoteScoreServer] Match ${match.id} assigné à l'arène ${arenaId}`
    );
  });

  const session: RemoteSession = {
    competitionId,
    strips: Array.from({ length: strips }, (_, i) => ({
      number: i + 1,
      status: pendingMatches[i] ? 'occupied' : 'available',
    })),
    referees: ctx.loadSessionReferees(competitionId),
    activeMatches: [],
    isRunning: true,
    startTime: new Date(),
  };

  logger.info(LogCategory.NETWORK, `[RemoteScoreServer] Session créée avec succès ✓`);
  logger.info(
    LogCategory.NETWORK,
    `[RemoteScoreServer] Détails: ${strips} pistes, ${session.referees.length} arbitres`
  );
  return session;
}

export async function updateMatchScore(
  ctx: SessionOpsContext,
  matchId: string,
  update: RemoteScoreUpdate
): Promise<void> {
  const scoreA: Score = {
    value: update.scoreA,
    isVictory: update.winner === 'A',
    isAbstention: update.specialStatus === 'abandon' && update.winner !== 'A',
    isExclusion: update.specialStatus === 'exclusion' && update.winner !== 'A',
    isForfait: update.specialStatus === 'forfait' && update.winner !== 'A',
  };

  const scoreB: Score = {
    value: update.scoreB,
    isVictory: update.winner === 'B',
    isAbstention: update.specialStatus === 'abandon' && update.winner !== 'B',
    isExclusion: update.specialStatus === 'exclusion' && update.winner !== 'B',
    isForfait: update.specialStatus === 'forfait' && update.winner !== 'B',
  };

  // Score en cours : mémoire seulement (arène, session), plus d'écriture en base (#2175).
  // La fin d'un match passe uniquement par recordScore (/finish) : un « finished » reçu ici
  // (file hors-ligne rejouée) ne termine rien, et un match terminé n'est plus touché, sauf
  // s'il est revenu sur une arène pour correction (PREV).
  const backOnArena = [...ctx.arenas.values()].some(
    a => a.currentMatch?.id === matchId && a.currentMatch.status !== 'finished'
  );
  if (ctx.sessionMatchScores.get(matchId)?.status === MatchStatus.FINISHED && !backOnArena) return;
  {
    const known = ctx.db.getMatch(matchId) ?? ctx.sessionMatches.find(m => m.id === matchId);
    if (!known) {
      // Match d'entraînement (lobby) : seulement porté par l'arène, pas de liste de session.
      // Sans ce cas, la tablette mettait le score en file hors-ligne et affichait
      // « Échec – Réessayer » en permanence (#1500).
      for (const [arenaId, arena] of ctx.arenas) {
        if (arena.currentMatch?.id === matchId) {
          ctx.updateArenaScore(arenaId, update.scoreA, update.scoreB);
          return;
        }
      }
      throw new Error('Match non trouvé');
    }
    // Synchroniser les scores dans l'arène en mémoire
    for (const [arenaId, arena] of ctx.arenas) {
      if (arena.currentMatch?.id === matchId) {
        ctx.updateArenaScore(arenaId, update.scoreA, update.scoreB);
        break;
      }
    }
    // Stocker dans sessionMatchScores pour cohérence (toujours « en cours »)
    ctx.sessionMatchScores.set(matchId, { scoreA, scoreB, status: MatchStatus.IN_PROGRESS });
  }
}

/** Champs et méthodes du serveur exposés à ce contexte via liveContext (#1896) */
export const SESSION_OPS_CONTEXT_KEYS = {
  state: ['arenas', 'db', 'sessionMatchScores', 'sessionMatches'],
  methods: ['assignMatchToArena', 'loadSessionReferees', 'setArenaCount', 'updateArenaScore'],
} as const;
