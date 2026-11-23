/**
 * BPM - Escrime - Handlers IPC `backup:*` : sélecteur natif des dossiers de sauvegarde
 * (lecture et remise à zéro : getBackupDir / resetBackupDir du contrat, #2134)
 * (Paramètres → Sauvegarde ; dossier dédié d'une compétition).
 * Le chemin ne vient que du sélecteur natif de dossier.
 * Licensed under GPL-3.0
 */
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { resolveBackupDir, writeBackupSettings, type BackupDirInfo } from '../backupSettings';

export function getBackupDirInfo(): BackupDirInfo {
  return resolveBackupDir(app.getPath('userData'), app.getPath('documents'));
}

/** Sélecteur natif de dossier ; null si annulé */
async function pickDirectory(): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow();
  const options: Electron.OpenDialogOptions = {
    properties: ['openDirectory', 'createDirectory'],
  };
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

export function registerBackupHandlers(): void {
  ipcMain.handle('backup:chooseDir', async () => {
    const chosen = await pickDirectory();
    if (chosen) writeBackupSettings(app.getPath('userData'), { dir: chosen });
    return getBackupDirInfo();
  });

  // Dossier dédié d'une compétition : choisi ici, enregistré avec la compétition
  ipcMain.handle('backup:pickCompetitionDir', async () => pickDirectory());
}
