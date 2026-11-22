/**
 * BellePoule Modern - Port du Mode Club (#1981 lot 2, docs/adr/0022)
 * Branche sur le CommandContext ce que les commandes du club ne peuvent pas faire seules :
 * serveur d'entraînement (tablettes arbitre), dossier de synchronisation (sélecteur natif),
 * sauvegardes locales. Remplace les canaux `club:*` de l'ancien ipc/clubHandlers.ts.
 * Licensed under GPL-3.0
 */
import { BrowserWindow, dialog } from 'electron';
import type { DatabaseManager } from '../database';
import type { ClubPort } from './engine/commands/context';
import { publishClubSynced } from './engine/api/events';
import { ClubSyncService } from './clubSync';
import { createClubBackup, listClubBackups, restoreClubBackup } from './clubBackups';
import { remoteServers } from './remoteRegistry';
import { TRAINING_ID } from './ipc/trainingHandlers';
import { trainingFinishListeners, type TrainingFinishRecord } from './remote/matchFinish';
import {
  clubBoutIdOf,
  linkedClubSession,
  pushClubBout,
  releaseClubBout,
  setLinkedClubSession,
} from './remote/clubArena';

/** Score final d'une tablette arbitre → combat du club terminé (saisie « referee ») */
export function onClubRemoteFinish(db: DatabaseManager, record: TrainingFinishRecord): void {
  const boutId = clubBoutIdOf(record?.id);
  if (!boutId) return;
  const bout = db.club.getBout(boutId);
  if (!bout || bout.status === 'cancelled') return;
  db.club.finishBout(boutId, {
    scoreA: record.scoreA,
    scoreB: record.scoreB,
    entryMode: 'referee',
    duration: record.durationSec,
  });
}

const trainingServer = () => remoteServers.get(TRAINING_ID);

async function pickSyncDir(): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow();
  const options: Electron.OpenDialogOptions = {
    title: 'Dossier de synchronisation du club',
    properties: ['openDirectory', 'createDirectory'],
  };
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

export interface ClubStation {
  port: ClubPort;
  /** Arrêt de la synchro périodique (avant fermeture de l'application) */
  stop(): void;
}

/** Démarre la synchro périodique et écoute les scores des tablettes ; renvoie le port du club */
export function createClubStation(opts: {
  db: DatabaseManager;
  userDataPath: string;
}): ClubStation {
  const { db, userDataPath } = opts;
  trainingFinishListeners.add(record => onClubRemoteFinish(db, record));
  // Reprise du fichier par la synchro : les vues du club se rechargent (onClubSynced)
  const service = new ClubSyncService(db, userDataPath, clubId => publishClubSynced(clubId));
  service.start();

  const port: ClubPort = {
    remoteStatus: () => {
      const entry = trainingServer();
      const active = !!entry?.server.hasSession();
      return {
        active,
        url: entry ? entry.server.getServerUrl() : null,
        strips: active ? entry!.server.getArenaCount() : 0,
      };
    },
    pushBout: (bout, a, b) => pushClubBout(trainingServer()?.server, bout, a, b),
    linkSession: id => setLinkedClubSession(id),
    linkedSession: () => linkedClubSession(),
    releaseBout: id => releaseClubBout(trainingServer()?.server, id),
    sync: {
      status: clubId => service.status(clubId),
      // Choix du dossier puis activation ; null si le sélecteur est annulé
      enable: async clubId => {
        const dir = await pickSyncDir();
        return dir ? service.enable(clubId, dir) : null;
      },
      disable: clubId => service.disable(clubId),
      now: clubId => service.sync(clubId),
      resolve: (clubId, keep) => service.resolve(clubId, keep),
    },
    // Sauvegardes locales (2 par club) : liste, création (rotation), restauration
    backups: {
      list: clubId => listClubBackups(userDataPath, clubId),
      create: clubId => createClubBackup(db, userDataPath, clubId),
      restore: async (clubId, backupId) => {
        const result = await restoreClubBackup(db, userDataPath, clubId, backupId);
        // Les vues du club se rechargent comme après une reprise de synchro
        publishClubSynced(clubId);
        return result;
      },
    },
  };
  return { port, stop: () => service.stop() };
}
