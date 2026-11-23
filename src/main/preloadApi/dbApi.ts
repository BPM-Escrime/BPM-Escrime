/**
 * BPM - Escrime - Préload : Base de données (db:*), avec validation (#1774)
 * Licensed under GPL-3.0
 */
import { ipcRenderer } from 'electron';
import type {
  DatabaseAPI,
  FencerUpdateData,
  MatchCreateData,
  MatchSnapshot,
  MatchUpdateData,
  Pool,
  PoolSnapshot,
  SessionState,
} from '../../shared/types/preload';
import { validateUUID, validateMatchData } from '../ipc/validation';

export const dbApi = {
  // Competitions
  getAllCompetitions: () => ipcRenderer.invoke('db:getAllCompetitions'),

  // Fencers
  updateFencer: (id: string, updates: FencerUpdateData) => {
    validateUUID(id, 'fencer ID');
    return ipcRenderer.invoke('db:updateFencer', id, updates);
  },

  // Matches
  createMatch: (match: MatchCreateData, poolId?: string) => {
    validateMatchData(match);
    return ipcRenderer.invoke('db:createMatch', match, poolId);
  },
  updateMatch: (id: string, updates: MatchUpdateData) => {
    validateUUID(id, 'match ID');
    return ipcRenderer.invoke('db:updateMatch', id, updates);
  },

  upsertMultipleTableauMatches: (
    competitionId: string,
    matches: Parameters<DatabaseAPI['upsertMultipleTableauMatches']>[1]
  ) => ipcRenderer.invoke('db:upsertMultipleTableauMatches', competitionId, matches),

  // Pools
  createPool: (phaseId: string, number: number, poolId?: string) => {
    if (!phaseId || typeof phaseId !== 'string') {
      throw new Error('Phase ID is required and must be a string');
    }
    if (typeof number !== 'number' || number < 0) {
      throw new Error('Pool number is required and must be positive');
    }
    return ipcRenderer.invoke('db:createPool', phaseId, number, poolId);
  },
  clearPoolsForPhase: (phaseId: string) => {
    if (!phaseId || typeof phaseId !== 'string') {
      throw new Error('Phase ID is required and must be a string');
    }
    return ipcRenderer.invoke('db:clearPoolsForPhase', phaseId);
  },
  addFencerToPool: (poolId: string, fencerId: string, position: number) => {
    if (!poolId || typeof poolId !== 'string') {
      throw new Error('Pool ID is required and must be a string');
    }
    if (!fencerId || typeof fencerId !== 'string') {
      throw new Error('Fencer ID is required and must be a string');
    }
    if (typeof position !== 'number' || position < 0) {
      throw new Error('Position is required and must be positive');
    }
    return ipcRenderer.invoke('db:addFencerToPool', poolId, fencerId, position);
  },
  syncPoolSnapshot: (competitionId: string, snapshot: PoolSnapshot) => {
    if (!competitionId || typeof competitionId !== 'string') {
      throw new Error('Competition ID is required and must be a string');
    }
    if (
      !snapshot ||
      typeof snapshot.id !== 'string' ||
      !Array.isArray(snapshot.fencerIds) ||
      !Array.isArray(snapshot.matches)
    ) {
      throw new Error('Pool snapshot is invalid');
    }
    return ipcRenderer.invoke('db:syncPoolSnapshot', competitionId, snapshot);
  },
  updatePool: (pool: Pool) => {
    if (!pool || typeof pool !== 'object') {
      throw new Error('Pool is required and must be an object');
    }
    return ipcRenderer.invoke('db:updatePool', pool);
  },
  getPoolsByPhase: (phaseId: string) => ipcRenderer.invoke('db:getPoolsByPhase', phaseId),

  // Phases
  createPhase: (competitionId: string, type: string, order: number, name: string) =>
    ipcRenderer.invoke('db:createPhase', competitionId, type, order, name),
  getPhasesByCompetition: (competitionId: string) =>
    ipcRenderer.invoke('db:getPhasesByCompetition', competitionId),

  // Referees

  // Touch / Card read

  // Session State
  saveSessionState: (competitionId: string, state: SessionState) => {
    if (!competitionId || typeof competitionId !== 'string') {
      throw new Error('Competition ID is required and must be a string');
    }
    return ipcRenderer.invoke('db:saveSessionState', competitionId, state);
  },
  saveSessionStateSync: (competitionId: string, state: unknown): boolean => {
    if (!competitionId || typeof competitionId !== 'string') {
      throw new Error('Competition ID is required and must be a string');
    }
    return ipcRenderer.sendSync('db:saveSessionStateSync', competitionId, state);
  },
  getSessionState: (competitionId: string) => {
    if (!competitionId || typeof competitionId !== 'string') {
      throw new Error('Competition ID is required and must be a string');
    }
    return ipcRenderer.invoke('db:getSessionState', competitionId);
  },

  // Statistiques combattants
  saveAbandonSnapshot: (
    fencerId: string,
    competitionId: string,
    previousStatus: string,
    abandonType: string,
    snapshots: MatchSnapshot[]
  ) =>
    ipcRenderer.invoke(
      'db:saveAbandonSnapshot',
      fencerId,
      competitionId,
      previousStatus,
      abandonType,
      snapshots
    ),
  getAbandonSnapshot: (fencerId: string) => ipcRenderer.invoke('db:getAbandonSnapshot', fencerId),
  deleteAbandonSnapshot: (fencerId: string) =>
    ipcRenderer.invoke('db:deleteAbandonSnapshot', fencerId),

  // Classement saisonnier Quest

  // Équipes
  createTeam: (competitionId: string, name: string, club: string) =>
    ipcRenderer.invoke('db:createTeam', competitionId, name, club),
  getTeamsByCompetition: (competitionId: string) =>
    ipcRenderer.invoke('db:getTeamsByCompetition', competitionId),
  deleteTeam: (teamId: string) => ipcRenderer.invoke('db:deleteTeam', teamId),
  upsertTeamFencer: (teamId: string, fencerId: string, teamOrder: number, isReserve: boolean) =>
    ipcRenderer.invoke('db:upsertTeamFencer', teamId, fencerId, teamOrder, isReserve),
  removeTeamFencer: (teamId: string, fencerId: string) =>
    ipcRenderer.invoke('db:removeTeamFencer', teamId, fencerId),
  createTeamMatch: (
    competitionId: string,
    poolNumber: number,
    teamAId: string,
    teamBId: string,
    round?: number
  ) => ipcRenderer.invoke('db:createTeamMatch', competitionId, poolNumber, teamAId, teamBId, round),
  getTeamMatchesByCompetition: (competitionId: string) =>
    ipcRenderer.invoke('db:getTeamMatchesByCompetition', competitionId),
  createTeamBout: (
    matchId: string,
    boutOrder: number,
    fencerAId: string,
    fencerBId: string,
    maxScore: number
  ) => ipcRenderer.invoke('db:createTeamBout', matchId, boutOrder, fencerAId, fencerBId, maxScore),
  updateTeamBout: (
    boutId: string,
    scoreA: number,
    scoreB: number,
    status: string,
    winnerId: string | null
  ) => ipcRenderer.invoke('db:updateTeamBout', boutId, scoreA, scoreB, status, winnerId),
  createTeamTableauMatch: (
    competitionId: string,
    tableId: string,
    round: number,
    position: number,
    teamAId: string,
    teamBId: string
  ) =>
    ipcRenderer.invoke(
      'db:createTeamTableauMatch',
      competitionId,
      tableId,
      round,
      position,
      teamAId,
      teamBId
    ),
  getTeamTableauMatches: (competitionId: string, tableId: string) =>
    ipcRenderer.invoke('db:getTeamTableauMatches', competitionId, tableId),
  createTeamMatchCard: (
    matchId: string,
    teamId: string,
    type: 'white' | 'yellow' | 'red' | 'black',
    reason: string
  ) => ipcRenderer.invoke('db:createTeamMatchCard', matchId, teamId, type, reason),
  getTeamMatchCards: (matchId: string) => ipcRenderer.invoke('db:getTeamMatchCards', matchId),
  createTeamBoutCard: (boutId: string, card: unknown) =>
    ipcRenderer.invoke('db:createTeamBoutCard', boutId, card),
  getTeamBoutCards: (matchId: string) => ipcRenderer.invoke('db:getTeamBoutCards', matchId),
} satisfies DatabaseAPI;
