/**
 * BPM - Escrime - Fin de match distante par la commande recordScore (#1980, ADR-0005)
 * Tablettes et appareils de piste (Cyrano, OPP2) écrivent le score par le moteur : mêmes
 * contrôles que l'écran et le MCP, état de session, base et journal dans une transaction.
 * L'écran ouvert relit la session (session:changed). Score refusé par une règle : rien
 * d'écrit, la tablette ou l'appareil reçoit le refus (#2151). Repli provisoire sur le chemin
 * historique seulement pour un match absent de la session (tableaux séparés, ADR-0024 : #2100)
 * ou une épreuve sans journal.
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

/**
 * Refus qui renvoient encore au chemin historique (#2151, étape 2) : match absent de la
 * session (seul le groupe affiché d'un tableau séparé y est enregistré, ADR-0024). À retirer
 * avec #2100. Tout autre refus (règle du score, tableau tiré, tour suivant joué…) est rendu.
 */
const FALLBACK_CODES = new Set(['match_not_found', 'competition_not_found']);

export type FinishOutcome =
  | { kind: 'accepted' }
  | { kind: 'fallback'; code: string }
  | { kind: 'refused'; code: string; message: string };

function runFinished(db: DatabaseManager, score: FinishedScore, dryRun: boolean): FinishOutcome {
  const { competitionId } = score;
  if (!competitionId || !db.eventLog) return { kind: 'fallback', code: 'no_competition' };
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
    const code = (e as { code?: string }).code ?? 'internal';
    const message = (e as Error).message;
    return FALLBACK_CODES.has(code)
      ? { kind: 'fallback', code }
      : { kind: 'refused', code, message };
  }
}

/**
 * Enregistre le score par recordScore : accepted (le moteur l'a écrit), refused (rien
 * d'écrit, refus à rendre à la tablette) ou fallback (chemin historique provisoire).
 */
export function recordFinishedScore(db: DatabaseManager, score: FinishedScore): FinishOutcome {
  const outcome = runFinished(db, score, false);
  if (outcome.kind === 'fallback') {
    logger.warn(
      LogCategory.NETWORK,
      `[recordFinishedScore] ${score.matchId} : chemin historique (${outcome.code})`
    );
  } else if (outcome.kind === 'refused') {
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
