/**
 * BPM - Escrime - Handlers IPC `db:*` (extraits de main.ts, #1155).
 * Licensed under GPL-3.0
 */
import { ipcMain } from 'electron';
import type { DatabaseManager } from '../../database';
import type { RemoteScoreServer } from '../remoteScoreServer';
import type { CompetitionEventType } from '../../shared/types/preload';
import { publishCompetitionEvent } from '../engine/api/events';

export interface DbHandlersContext {
  db: DatabaseManager;
  remoteServers: Map<string, { server: RemoteScoreServer }>;
}

/**
 * Publie un événement de données sur le bus du moteur ; l'écran le reçoit par l'abonnement
 * onCompetitionEvents du contrat (docs/adr/0010), plus par un canal IPC dédié.
 */
export function emitCompetitionEvent(type: CompetitionEventType, competitionId?: string): void {
  publishCompetitionEvent({ type, competitionId });
}

export function registerDbHandlers({ db }: DbHandlersContext): void {
  // Competition handlers
  ipcMain.handle('db:getAllCompetitions', async () => {
    return db.getAllCompetitions();
  });

  // Lectures restantes de l'écran ; l'état, les matchs, les poules et les équipes s'écrivent par
  // le contrat (api:invoke), dans la transaction de la commande (docs/adr/0017, 0024)
  // Poules d'une préparation écrite par une version précédente (lecture seule)
  ipcMain.handle('db:getPoolsByPhase', async (_, phaseId) => {
    return db.getPoolsByPhase(phaseId);
  });

  ipcMain.handle('db:getPhasesByCompetition', async (_, competitionId) => {
    return db.getPhasesByCompetition(competitionId);
  });
}
