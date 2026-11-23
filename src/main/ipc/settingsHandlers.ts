/**
 * BPM - Escrime - Handler IPC `settings:addAgentFolder` : dossier de l'agent choisi dans une
 * boîte de dialogue native (#1880). Les autres réglages du poste et les salles sont des
 * opérations du contrat (engine/commands/station.ts, docs/adr/0022) ; celle-ci reste en IPC car
 * elle ouvre un dialogue natif (ADR-0021).
 * Licensed under GPL-3.0
 */
import { dialog, ipcMain, type BrowserWindow } from 'electron';
import type { DatabaseManager } from '../../database';

export interface SettingsHandlersContext {
  db: DatabaseManager;
  /** Dossiers accessibles à l'agent tant que l'opérateur n'en a pas choisi */
  defaultAgentFolders?: string[];
  getMainWindow?: () => BrowserWindow | null;
}

export function registerSettingsHandlers({
  db,
  defaultAgentFolders = [],
  getMainWindow,
}: SettingsHandlersContext): void {
  // Dossiers où l'agent (MCP) lit des fichiers d'import et écrit des exports. Un dossier
  // n'entre dans la liste que par une boîte de dialogue native du main.
  ipcMain.handle('settings:addAgentFolder', async () => {
    const win = getMainWindow?.() ?? null;
    const options = { properties: ['openDirectory' as const] };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    const chosen = result.canceled ? undefined : result.filePaths[0];
    if (chosen) {
      const current = db.settings.getSetting('agentFolders');
      if (!current.includes(chosen)) {
        db.settings.updateSettings({ agentFolders: [...current, chosen] });
      }
    }
    return { folders: db.settings.getSetting('agentFolders'), defaults: defaultAgentFolders };
  });
}
