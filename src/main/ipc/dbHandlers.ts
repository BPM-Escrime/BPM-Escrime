/**
 * BPM - Escrime - Handlers IPC `db:*` (extraits de main.ts, #1155).
 * Licensed under GPL-3.0
 */
import { BrowserWindow, ipcMain } from 'electron';
import type { DatabaseManager } from '../../database';
import type { RemoteScoreServer } from '../remoteScoreServer';
import type { Card } from '../../shared/types';
import type { CompetitionEventType } from '../../shared/types/preload';
import { logger, LogCategory, toError } from '../../shared/services/logger';
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

export function registerDbHandlers({ db, remoteServers }: DbHandlersContext): void {
  // Competition handlers
  ipcMain.handle('db:createCompetition', async (_, data) => {
    return db.createCompetition(data);
  });

  ipcMain.handle('db:getAllCompetitions', async () => {
    return db.getAllCompetitions();
  });

  ipcMain.handle('db:updateCompetition', async (_, id, updates) => {
    const result = db.updateCompetition(id, updates);
    // Propager le paramètre carton noir aux tablettes si une session distante est active
    const blackCard = updates?.settings?.blackCardEnabled;
    if (blackCard !== undefined) {
      remoteServers.get(id)?.server.updateBlackCardEnabled(blackCard === true);
    }
    // Score max / chronos / repos modifiés : tablettes à jour sans relancer la session (#1134)
    if (updates?.settings) remoteServers.get(id)?.server.refreshCompetitionSettings();
    return result;
  });

  // Fencer handlers
  ipcMain.handle('db:addFencer', async (_, competitionId, fencer) => {
    const created = db.addFencer(competitionId, fencer);
    emitCompetitionEvent('fencers:changed', competitionId);
    return created;
  });

  ipcMain.handle('db:updateFencer', async (_, id, updates) => {
    const updated = db.updateFencer(id, updates);
    emitCompetitionEvent('fencers:changed');
    return updated;
  });

  // Match handlers
  ipcMain.handle('db:createMatch', async (_, match, poolId) => {
    const created = db.createMatch(match, poolId);
    emitCompetitionEvent('matches:changed');
    return created;
  });

  ipcMain.handle('db:updateMatch', async (_, id, rawUpdates) => {
    // Motif de journal (correction après tirage du tableau, #1996) : jamais écrit dans le match
    const { auditReason, ...updates } = (rawUpdates ?? {}) as Parameters<
      DatabaseManager['updateMatch']
    >[1] & { auditReason?: unknown };
    const reason =
      typeof auditReason === 'string' && auditReason.trim()
        ? auditReason.trim().slice(0, 300)
        : undefined;
    const hasScore = updates.scoreA !== undefined || updates.scoreB !== undefined;
    if (hasScore) {
      try {
        const prev = db.getMatch(id);
        // Score déjà en base (écrit par recordScore, l'écran ne fait que relire) : rien à
        // réécrire ni à journaliser (#1980)
        const canon = (v: unknown) =>
          v && typeof v === 'object'
            ? JSON.stringify(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
            : JSON.stringify(v ?? null);
        const same = (x: unknown, y: unknown) => canon(x) === canon(y);
        if (
          prev &&
          !reason &&
          same(prev.scoreA, updates.scoreA ?? prev.scoreA) &&
          same(prev.scoreB, updates.scoreB ?? prev.scoreB) &&
          (updates.status === undefined || updates.status === prev.status) &&
          Object.keys(updates).every(k => ['scoreA', 'scoreB', 'status'].includes(k))
        ) {
          return;
        }
        db.updateMatch(id, updates);
        if (prev) {
          db.logScoreChange({
            matchId: id,
            poolId: prev.poolId ?? undefined,
            previousScoreA: prev.scoreA,
            previousScoreB: prev.scoreB,
            newScoreA: updates.scoreA ?? prev.scoreA,
            newScoreB: updates.scoreB ?? prev.scoreB,
            changedBy: reason ? 'correction' : 'ui',
            ...(reason ? { reason } : {}),
          });
        }
      } catch {
        db.updateMatch(id, updates);
      }
    } else {
      db.updateMatch(id, updates);
    }
    emitCompetitionEvent('matches:changed');

    // Propager l'assignation d'arbitre au serveur distant
    if (updates.refereeId) {
      for (const { server } of remoteServers.values()) {
        try {
          server.assignRefereeToMatch(id, updates.refereeId);
        } catch {
          /* non bloquant */
        }
      }
    }
  });

  ipcMain.handle(
    'db:upsertMultipleTableauMatches',
    async (_, competitionId: string, matches: any[]) => {
      const result = db.upsertMultipleTableauMatches(competitionId, matches);
      emitCompetitionEvent('matches:changed', competitionId);
      return result;
    }
  );

  // Session State handlers
  // Révision périmée (état réécrit par le MCP, #1880) : { conflict: true }, rien n'est écrit
  ipcMain.handle('db:saveSessionState', async (_, competitionId, state) => {
    return db.saveSessionStateChecked(competitionId, state) ? undefined : { conflict: true };
  });

  ipcMain.handle('db:getSessionState', async (_, competitionId) => {
    return db.getSessionState(competitionId);
  });

  // Sync save for beforeunload (renderer cannot await async IPC on close)
  ipcMain.on('db:saveSessionStateSync', (event, competitionId: string, state: unknown) => {
    try {
      const saved = db.saveSessionStateChecked(competitionId, state);
      db.forceSave();
      event.returnValue = saved;
    } catch (e) {
      logger.error(LogCategory.SYSTEM, '[DB] Sync session state save failed', toError(e));
      event.returnValue = false;
    }
  });

  // Pool handlers
  ipcMain.handle('db:updatePool', async (_, pool) => {
    return db.updatePool(pool);
  });
  ipcMain.handle('db:createPool', async (_, phaseId, number, poolId) => {
    return db.createPool(phaseId, number, poolId);
  });
  ipcMain.handle('db:clearPoolsForPhase', async (_, phaseId) => {
    return db.clearPoolsForPhase(phaseId);
  });
  ipcMain.handle('db:addFencerToPool', async (_, poolId, fencerId, position) => {
    return db.addFencerToPool(poolId, fencerId, position);
  });
  ipcMain.handle('db:syncPoolSnapshot', async (_, competitionId, snapshot) => {
    return db.syncPoolSnapshot(competitionId, snapshot);
  });
  ipcMain.handle('db:getPoolsByPhase', async (_, phaseId) => {
    return db.getPoolsByPhase(phaseId);
  });

  // Phase handlers
  ipcMain.handle('db:createPhase', async (_, competitionId, type, order, name) => {
    return db.createPhase(competitionId, type, order, name);
  });
  ipcMain.handle('db:getPhasesByCompetition', async (_, competitionId) => {
    return db.getPhasesByCompetition(competitionId);
  });

  // Referee handlers

  // Touch / Card read handlers
  // Cartons de plusieurs matchs pour les feuilles imprimées (#1829)
  // Statistiques combattants

  // Abandon snapshot handlers
  ipcMain.handle(
    'db:saveAbandonSnapshot',
    async (_, fencerId, competitionId, previousStatus, abandonType, snapshots) => {
      db.saveAbandonSnapshot(fencerId, competitionId, previousStatus, abandonType, snapshots);
    }
  );

  ipcMain.handle('db:getAbandonSnapshot', async (_, fencerId) => {
    return db.getAbandonSnapshot(fencerId);
  });

  ipcMain.handle('db:deleteAbandonSnapshot', async (_, fencerId) => {
    db.deleteAbandonSnapshot(fencerId);
  });

  // ── Classement saisonnier Quest ───────────────────────────────────────────────

  // ── Équipes ───────────────────────────────────────────────────────────────────

  ipcMain.handle('db:createTeam', async (_, competitionId: string, name: string, club: string) => {
    return db.createTeam(competitionId, name, club);
  });

  ipcMain.handle('db:getTeamsByCompetition', async (_, competitionId: string) => {
    return db.getTeamsByCompetition(competitionId);
  });

  ipcMain.handle('db:deleteTeam', async (_, teamId: string) => {
    return db.deleteTeam(teamId);
  });

  ipcMain.handle(
    'db:upsertTeamFencer',
    async (_, teamId: string, fencerId: string, teamOrder: number, isReserve: boolean) => {
      return db.upsertTeamFencer(teamId, fencerId, teamOrder, isReserve);
    }
  );

  ipcMain.handle('db:removeTeamFencer', async (_, teamId: string, fencerId: string) => {
    return db.removeTeamFencer(teamId, fencerId);
  });

  ipcMain.handle(
    'db:createTeamMatch',
    async (
      _,
      competitionId: string,
      poolNumber: number,
      teamAId: string,
      teamBId: string,
      round?: number
    ) => {
      return db.createTeamMatch(competitionId, poolNumber, teamAId, teamBId, round);
    }
  );

  ipcMain.handle('db:getTeamMatchesByCompetition', async (_, competitionId: string) => {
    return db.getTeamMatchesByCompetition(competitionId);
  });

  ipcMain.handle(
    'db:createTeamBout',
    async (
      _,
      matchId: string,
      boutOrder: number,
      fencerAId: string,
      fencerBId: string,
      maxScore: number
    ) => {
      return db.createTeamBout(matchId, boutOrder, fencerAId, fencerBId, maxScore);
    }
  );

  ipcMain.handle(
    'db:updateTeamBout',
    async (
      _,
      boutId: string,
      scoreA: number,
      scoreB: number,
      status: string,
      winnerId: string | null
    ) => {
      return db.updateTeamBout(boutId, scoreA, scoreB, status, winnerId);
    }
  );

  ipcMain.handle(
    'db:createTeamTableauMatch',
    async (
      _,
      competitionId: string,
      tableId: string,
      round: number,
      position: number,
      teamAId: string,
      teamBId: string
    ) => {
      return db.createTeamTableauMatch(competitionId, tableId, round, position, teamAId, teamBId);
    }
  );

  ipcMain.handle('db:getTeamTableauMatches', async (_, competitionId: string, tableId: string) => {
    return db.getTeamTableauMatches(competitionId, tableId);
  });

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
