/**
 * BellePoule Modern - Avis du serveur distant à l'écran du poste (#1981 lot 2, docs/adr/0010 et
 * 0022). Remplace les `mainWindow.webContents.send('match:finished' …)` du serveur : l'avis est
 * publié sur le bus du main, que lit l'abonnement `onRemoteActivity` du contrat. Sans fenêtre
 * principale (MCP, --headless), rien n'est émis, comme avec l'ancien envoi IPC.
 * Licensed under GPL-3.0
 */
import type { RemoteActivity } from '../../shared/types/remote';
import type { TrainingActivity } from '../../shared/types/training';
import { publishRemoteActivity, publishTrainingActivity } from '../engine/api/events';
import { getSharedMainWindow } from '../mainWindowRef';

export function notifyScreen(event: RemoteActivity): void {
  if (getSharedMainWindow()) publishRemoteActivity(event);
}

/** Avis du serveur d'entraînement (onTrainingActivity) : même règle, sans fenêtre rien n'est émis */
export function notifyTraining(event: TrainingActivity): void {
  if (getSharedMainWindow()) publishTrainingActivity(event);
}
