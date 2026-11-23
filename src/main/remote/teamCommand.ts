/**
 * BPM - Escrime - Relais d'équipes distants par les commandes du contrat (docs/adr/0024, lot E4)
 * Tablette `/equipe{N}/arbitre` et appareils de piste (Cyrano, OPP2) : fin de relais
 * (recordRelayScore), rappel du relais précédent (reopenRelay), remplaçant
 * (substituteTeamFencer). Mêmes contrôles que l'écran et le MCP, tables et journal dans une
 * transaction. Refus : rien d'écrit, code du catalogue rendu (jamais de repli par la base).
 * Licensed under GPL-3.0
 */
import type { DatabaseManager } from '../../database';
import type { EventSource } from '../../database/repos/eventLogRepo';
import type { Output } from '../../shared/api/contract';
import { invokeCommandSync } from '../engine/api/engine';
import { emitChangeVia } from '../mcp/mcpDomain';
import { emitCompetitionEvent } from '../ipc/dbHandlers';
import { logger, LogCategory } from '../../shared/services/logger';

export type TeamSource = Extract<EventSource, 'tablet' | 'cyrano' | 'opp2'>;

type TeamCommand = 'recordRelayScore' | 'reopenRelay' | 'substituteTeamFencer';

export type TeamCommandOutcome<N extends TeamCommand> =
  { ok: true; out: Output<N> } | { ok: false; code: string; message: string };

/**
 * Commande de relais au nom de la tablette ou de l'appareil. `dryRun` : contrôle sans rien
 * écrire (l'appareil reçoit NAK avant tout ACK, comme pour un match individuel).
 */
export function runTeamCommand<N extends TeamCommand>(
  db: DatabaseManager,
  name: N,
  input: Record<string, unknown>,
  source: TeamSource,
  dryRun = false
): TeamCommandOutcome<N> {
  if (!db.eventLog) {
    return { ok: false, code: 'internal', message: 'Journal de l’épreuve indisponible' };
  }
  try {
    const out = invokeCommandSync(
      {
        db,
        actor: { source },
        emitChange: emitChangeVia((type, id) => emitCompetitionEvent(type, id)),
      },
      name,
      { ...input, ...(dryRun ? { dryRun: true } : {}) }
    );
    return { ok: true, out };
  } catch (e) {
    const code = (e as { code?: string }).code ?? 'internal';
    const message = (e as Error).message;
    if (!dryRun) {
      logger.info(LogCategory.NETWORK, `[${name}] ${String(input.matchId)} : refusé (${code})`);
    }
    return { ok: false, code, message };
  }
}

/** Refus rendu à la tablette : même forme que le score refusé d'un match individuel */
export const teamRefusal = (outcome: { code: string; message: string }) => ({
  error: 'score_refused',
  code: outcome.code,
  detail: outcome.message,
});
