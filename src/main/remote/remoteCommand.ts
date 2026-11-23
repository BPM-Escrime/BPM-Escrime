/**
 * BPM - Escrime - Commandes du contrat appelées par les pages du serveur distant (#2159)
 * Appel, auto-pointage, inscription en ligne, espace formateurs : même commande que l'écran
 * et le MCP (ADR-0005, 0018), dans sa transaction, l'écran prévenu par le moteur. Le refus
 * est rendu avec son code (catalogue ADR-0009) pour que la route réponde en conséquence.
 * Licensed under GPL-3.0
 */
import type { DatabaseManager } from '../../database';
import type { Input, OperationName, Output } from '../../shared/api/contract';
import { invokeSync, toApiError } from '../engine/api/engine';
import { emitChangeVia } from '../mcp/mcpDomain';
import { emitCompetitionEvent } from '../ipc/dbHandlers';
import { logger, LogCategory } from '../../shared/services/logger';

export type RemoteCommandResult<N extends OperationName> =
  { ok: true; result: Output<N> } | { ok: false; code: string; message: string };

export function runRemoteCommand<N extends OperationName>(
  db: DatabaseManager,
  name: N,
  input: Input<N>
): RemoteCommandResult<N> {
  try {
    const result = invokeSync(
      {
        db,
        // Pages servies par le serveur distant (tablette, téléphone) : source « tablet »
        actor: { source: 'tablet' },
        // Avis à l'écran après l'écriture : son échec ne fait pas échouer la commande
        emitChange: emitChangeVia((type, id) => {
          try {
            emitCompetitionEvent(type, id);
          } catch (e) {
            logger.warn(LogCategory.NETWORK, `[runRemoteCommand] avis ${type} non envoyé`, e);
          }
        }),
      },
      name,
      input
    );
    return { ok: true, result };
  } catch (e) {
    const err = toApiError(e);
    logger.info(LogCategory.NETWORK, `[runRemoteCommand] ${name} refusée (${err.code})`);
    return { ok: false, code: err.code, message: err.message };
  }
}
