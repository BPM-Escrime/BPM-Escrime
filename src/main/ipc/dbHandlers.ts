/**
 * BPM - Escrime - Handlers IPC `db:*` (extraits de main.ts, #1155).
 * Licensed under GPL-3.0
 */
import { BrowserWindow, ipcMain } from 'electron';
import type { DatabaseManager } from '../../database';
import type { RemoteScoreServer } from '../remoteScoreServer';
import type { Card } from '../../shared/types';
import type { CompetitionEventType } from '../../shared/types/preload';
import { publishCompetitionEvent } from '../engine/api/events';

export interface DbHandlersContext {
  db: DatabaseManager;
  remoteServers: Map<string, { server: RemoteScoreServer }>;
}

/** Diffuse un événement de données aux fenêtres du renderer (bus main → renderer, #1298). */
export function emitCompetitionEvent(type: CompetitionEventType, competitionId?: string): void {
  publishCompetitionEvent({ type, competitionId });
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('competition:event', { type, competitionId });
  }
}

export function registerDbHandlers({ db }: DbHandlersContext): void {
  // Competition handlers
  ipcMain.handle('db:getAllCompetitions', async () => {
    return db.getAllCompetitions();
  });

  // Lectures restantes de l'écran ; l'état, les matchs, les poules et les équipes s'écrivent par
  // le contrat (api:invoke), dans la transaction de la commande (docs/adr/0017, 0024)
  ipcMain.handle('db:getSessionState', async (_, competitionId) => {
    return db.getSessionState(competitionId);
  });

  // Poules d'une préparation écrite par une version précédente (lecture seule)
  ipcMain.handle('db:getPoolsByPhase', async (_, phaseId) => {
    return db.getPoolsByPhase(phaseId);
  });

  ipcMain.handle('db:getPhasesByCompetition', async (_, competitionId) => {
    return db.getPhasesByCompetition(competitionId);
  });

  // Cartons d'équipe : hors du moteur (docs/adr/0024, « Hors de cette ADR »)
  ipcMain.handle(
    'db:createTeamMatchCard',
    async (
      _,
      matchId: string,
      teamId: string,
      type: 'white' | 'yellow' | 'red' | 'black',
      reason: string
    ) => {
      return db.createTeamMatchCard(matchId, teamId, type, reason);
    }
  );

  ipcMain.handle('db:getTeamMatchCards', async (_, matchId: string) => {
    return db.getTeamMatchCards(matchId);
  });

  // Cartons individuels des relais par équipes (#1086)
  ipcMain.handle('db:createTeamBoutCard', async (_, boutId: string, card: Card) => {
    return db.createTeamBoutCard(boutId, card);
  });

  ipcMain.handle('db:getTeamBoutCards', async (_, matchId: string) => {
    return db.getTeamBoutCards(matchId);
  });
}
