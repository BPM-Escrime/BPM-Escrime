/**
 * BPM - Escrime - Serveur d'entraînement : identité dans le registre, arrêt, liaison à la
 * fenêtre principale (ex-ipc/trainingHandlers.ts, #1155 ; canaux `training:*` migrés vers le
 * contrat d'API par trainingPort.ts, #1981 lot 2, docs/adr/0022). Aucun canal IPC ici : le Mode
 * Club (clubPort.ts) et le port d'entraînement s'en servent.
 * Licensed under GPL-3.0
 */
import type { BrowserWindow } from 'electron';
import { closeDemoScreens } from './demoScreens';
import { remoteServers, usedPorts } from './remoteRegistry';

export const TRAINING_ID = '__training__';

/**
 * Arrête le serveur d'entraînement (démo comprise) : arbitre virtuel, écrans de démo, port.
 * Renvoie false s'il ne tournait pas.
 */
export function stopTrainingServer(): boolean {
  const entry = remoteServers.get(TRAINING_ID);
  if (!entry) return false;
  closeDemoScreens();
  entry.server.stop();
  usedPorts.delete(entry.port);
  remoteServers.delete(TRAINING_ID);
  return true;
}

/** Détache les écouteurs posés sur la fenêtre principale par bindToMainWindow. */
let unbindMainWindow: (() => void) | null = null;

/** Détache le serveur d'entraînement de la fenêtre principale (arrêt demandé par l'écran). */
export function unbindTrainingFromMainWindow(): void {
  unbindMainWindow?.();
}

/**
 * Le serveur d'entraînement n'est piloté que par la fenêtre principale : fermée (macOS, l'app
 * reste dans le Dock) ou rechargée (état React perdu, plus de bouton « Arrêter »), il ne doit
 * pas continuer en arrière-plan (démo qui joue encore, saisie distante encore acceptée).
 */
export function bindTrainingToMainWindow(main: BrowserWindow | null): void {
  if (!main || main.isDestroyed()) return;
  const stop = () => {
    stopTrainingServer();
    detach();
  };
  const detach = () => {
    unbindMainWindow = null;
    main.removeListener('closed', stop);
    if (!main.isDestroyed()) main.webContents.removeListener('did-navigate', stop);
  };
  unbindMainWindow?.();
  main.once('closed', stop);
  main.webContents.once('did-navigate', stop);
  unbindMainWindow = detach;
}
