/**
 * BPM - Escrime - Préload : Base de données (db:*), avec validation (#1774)
 * Lectures restantes et cartons d'équipe. Les écritures de l'épreuve passent par le contrat
 * (api:invoke) : l'écran n'écrit plus ni l'état, ni les matchs, ni les poules, ni les équipes
 * (docs/adr/0017, 0024).
 * Licensed under GPL-3.0
 */
import { ipcRenderer } from 'electron';
import type { DatabaseAPI } from '../../shared/types/preload';

export const dbApi = {
  // Competitions
  getAllCompetitions: () => ipcRenderer.invoke('db:getAllCompetitions'),

  // Poules d'une préparation écrite par une version précédente (lecture seule)
  getPoolsByPhase: (phaseId: string) => ipcRenderer.invoke('db:getPoolsByPhase', phaseId),
  getPhasesByCompetition: (competitionId: string) =>
    ipcRenderer.invoke('db:getPhasesByCompetition', competitionId),

  // État de l'épreuve hors moteur (lecture seule)
  getSessionState: (competitionId: string) => {
    if (!competitionId || typeof competitionId !== 'string') {
      throw new Error('Competition ID is required and must be a string');
    }
    return ipcRenderer.invoke('db:getSessionState', competitionId);
  },
} satisfies DatabaseAPI;
