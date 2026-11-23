/**
 * BPM - Escrime - Handlers IPC app:getTtsConfig / app:getLogo / app:getLogos / app:saveLogos
 * (extraits de main.ts, #1341). Lecture de la synthèse vocale et des logos du poste au
 * démarrage de l'écran, et bibliothèque de logos : les écritures du logo actif et de la synthèse
 * vocale sont les opérations setRemoteLogo et setTtsConfig du contrat (#1981, docs/adr/0022).
 * Licensed under GPL-3.0
 */
import { app, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export function registerLogoTtsHandlers(): void {
  ipcMain.handle('app:getTtsConfig', async () => {
    const ttsPath = path.join(app.getPath('userData'), 'tts-config.json');
    try {
      return JSON.parse(await fs.promises.readFile(ttsPath, 'utf-8'));
    } catch {
      return null;
    }
  });

  ipcMain.handle('app:getLogo', async () => {
    const logoPath = path.join(app.getPath('userData'), 'logo.dat');
    try {
      return await fs.promises.readFile(logoPath, 'utf-8');
    } catch {
      return null;
    }
  });

  // Bibliothèque de logos (plusieurs logos, l'actif reste dans logo.dat)
  ipcMain.handle('app:getLogos', async () => {
    const libPath = path.join(app.getPath('userData'), 'logos.json');
    try {
      const parsed = JSON.parse(await fs.promises.readFile(libPath, 'utf-8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  ipcMain.handle('app:saveLogos', async (_, logos: unknown) => {
    try {
      if (!Array.isArray(logos) || logos.length > 50) return { success: false };
      const clean = logos.filter(
        (l): l is { id: string; name: string; data: string } =>
          !!l &&
          typeof l.id === 'string' &&
          typeof l.name === 'string' &&
          typeof l.data === 'string' &&
          l.data.startsWith('data:image/')
      );
      const libPath = path.join(app.getPath('userData'), 'logos.json');
      const tmp = `${libPath}.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify(clean), 'utf-8');
      await fs.promises.rename(tmp, libPath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Erreur inconnue' };
    }
  });
}
