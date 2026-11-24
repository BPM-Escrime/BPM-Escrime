/**
 * BPM - Escrime - Fin de match distante par la commande recordScore (#1980, ADR-0005)
 * Tablettes et appareils de piste (Cyrano, OPP2) écrivent le score par le moteur : mêmes
 * contrôles que l'écran et le MCP, état de session, base et journal dans une transaction.
 * L'écran ouvert relit la session (session:changed). Commande refusée (règle du score, match
 * absent de la session, épreuve introuvable) : rien d'écrit, la tablette reçoit le refus,
 * l'appareil NAK ; le DT corrige au poste. Plus de chemin historique (#2151, étape 3).
 * Licensed under GPL-3.0
 */
import type { DatabaseManager } from '../../database';
import type { EventSource } from '../../database/repos/eventLogRepo';
import { invokeCommandSync } from '../engine/api/engine';
import type { CommandContext } from '../engine/commands/context';
import { emitChangeVia } from '../mcp/mcpDomain';
import { emitCompetitionEvent } from '../ipc/dbHandlers';
import { logger, LogCategory } from '../../shared/services/logger';

export interface FinishedScore {
  competitionId: string | null | undefined;
  /** Identifiant brut de la session ou composite en base (`${competitionId}-16-0`) */
  matchId: string;
  scoreA: number;
  scoreB: number;
  winner: 'A' | 'B' | null;
  source: Extract<EventSource, 'tablet' | 'cyrano' | 'opp2'>;
  /** Identifiant de l'arbitre (journal d'épreuve : identifiants seulement, RGPD #1882) */
  author?: string;
  /** Détails du journal des scores : arbitre, adresse de la tablette, motif */
  audit?: CommandContext['scoreAudit'];
  /** Statut du perdant (carton noir, exclusion ou abandon signalés) : retrait par le moteur */
  specialStatus?: 'abandon' | 'forfait' | 'exclusion';
  /** Exclusion sur carton noir (motif black_card) */
  blackCard?: boolean;
}

/** Identifiant du match dans l'état de session (les matchs de tableau y sont bruts) */
export function sessionMatchId(competitionId: string, matchId: string): string {
  const prefix = `${competitionId}-`;
  return matchId.startsWith(prefix) ? matchId.slice(prefix.length) : matchId;
}

export type FinishOutcome =
  { kind: 'accepted' } | { kind: 'refused'; code: string; message: string };

function runFinished(db: DatabaseManager, score: FinishedScore, dryRun: boolean): FinishOutcome {
  const { competitionId } = score;
  // Session sans épreuve (hors entraînement, qui n'appelle pas ce module) : refus explicite
  if (!competitionId) {
    return { kind: 'refused', code: 'competition_not_found', message: 'Aucune épreuve en cours' };
  }
  try {
    invokeCommandSync(
      {
        db,
        actor: { source: score.source, ...(score.author ? { author: score.author } : {}) },
        emitChange: emitChangeVia((type, id) => emitCompetitionEvent(type, id)),
        ...(score.audit ? { scoreAudit: score.audit } : {}),
      },
      'recordScore',
      {
        competitionId,
        matchId: sessionMatchId(competitionId, score.matchId),
        scoreA: score.scoreA,
        scoreB: score.scoreB,
        ...(score.winner ? { winner: score.winner } : {}),
        ...(score.specialStatus ? { specialStatus: score.specialStatus } : {}),
        ...(score.blackCard ? { blackCard: true } : {}),
        ...(dryRun ? { dryRun: true } : {}),
      }
    );
    return { kind: 'accepted' };
  } catch (e) {
    return {
      kind: 'refused',
      code: (e as { code?: string }).code ?? 'internal',
      message: (e as Error).message,
    };
  }
}

/**
 * Enregistre le score par recordScore : accepted (le moteur l'a écrit) ou refused (rien
 * d'écrit, refus à rendre à la tablette ou à l'appareil).
 */
export function recordFinishedScore(db: DatabaseManager, score: FinishedScore): FinishOutcome {
  const outcome = runFinished(db, score, false);
  if (outcome.kind === 'refused') {
    logger.info(
      LogCategory.NETWORK,
      `[recordFinishedScore] ${score.matchId} : score refusé (${outcome.code})`
    );
  }
  return outcome;
}

/** Réponse HTTP d'un score refusé par le moteur : code stable traduit par la tablette */
export const scoreRefusal = (outcome: Extract<FinishOutcome, { kind: 'refused' }>) => ({
  error: 'score_refused',
  code: outcome.code,
  detail: outcome.message,
});

/**
 * Contrôle du score sans rien écrire (recordScore en simulation) : l'appareil de piste
 * reçoit NAK si la commande refuse le score, avant tout ACK (ADR-0005).
 */
export function checkFinishedScore(db: DatabaseManager, score: FinishedScore): FinishOutcome {
  return runFinished(db, score, true);
}

/**
 * Arbitre du match en cours choisi sur la tablette (« changer d'arbitre ») : commande
 * assignReferee sur `matchId` (docs/adr/0014, #2151) ; true si le moteur l'a écrit.
 */
export function assignMatchRefereeByCommand(
  db: DatabaseManager,
  competitionId: string | null | undefined,
  matchId: string,
  refereeId: string
): boolean {
  if (!competitionId || !db.eventLog) return false;
  try {
    invokeCommandSync(
      {
        db,
        actor: { source: 'tablet' },
        emitChange: emitChangeVia((type, id) => emitCompetitionEvent(type, id)),
      },
      'assignReferee',
      { competitionId, matchId: sessionMatchId(competitionId, matchId), refereeId }
    );
    return true;
  } catch (e) {
    logger.info(
      LogCategory.NETWORK,
      `[assignMatchRefereeByCommand] ${matchId} : arbitre refusé (${(e as { code?: string }).code ?? 'internal'})`
    );
    return false;
  }
}

/**
 * Réintégration par reinstateFencer (annulation d'un carton noir depuis la tablette,
 * docs/adr/0016) : true si le moteur l'a écrite, false si refusée (rien d'écrit).
 */
export function reinstateByCommand(
  db: DatabaseManager,
  competitionId: string | null | undefined,
  fencerId: string,
  source: FinishedScore['source'] = 'tablet'
): boolean {
  if (!competitionId || !db.eventLog) return false;
  try {
    invokeCommandSync(
      {
        db,
        actor: { source },
        emitChange: emitChangeVia((type, id) => emitCompetitionEvent(type, id)),
      },
      'reinstateFencer',
      { competitionId, fencerId }
    );
    return true;
  } catch (e) {
    logger.info(
      LogCategory.NETWORK,
      `[reinstateByCommand] ${fencerId} : réintégration refusée (${(e as { code?: string }).code ?? 'internal'})`
    );
    return false;
  }
}
