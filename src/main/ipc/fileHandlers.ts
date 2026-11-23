/**
 * BPM - Escrime - Handlers IPC `file:*` (écriture au chemin choisi, impression, tableur,
 * fichiers fédéraux) et `dialog:*` (boîtes de dialogue natives) — extraits de main.ts, #1341.
 * Les fichiers de données (.bpm, .bpf, photos) passent par le contrat en contenu (ADR-0021).
 * Licensed under GPL-3.0
 */
import { app, dialog, ipcMain, type BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { DatabaseManager } from '../../database';
import { assertAuthorizedPath, authorizePath, readBoundedFile } from '../pathAuthorization';
import { MAX_DATA_FILE_BYTES } from '../../shared/api/contractFiles';
import { readImportText, rowsToXlsx } from '../xlsxToCsv';
import { logger, LogCategory, toError } from '../../shared/services/logger';

/** Fichiers lus d'un seul choix multiple du dialogue (binaire) */
const MAX_OPEN_FILES = 5;

export interface FileHandlersContext {
  db: DatabaseManager;
  getMainWindow(): BrowserWindow | null;
}

export function registerFileHandlers({ db, getMainWindow }: FileHandlersContext): void {
  ipcMain.handle('file:export', async (_, filepath) => {
    await db.exportToFile(assertAuthorizedPath(filepath, 'write'));
  });

  ipcMain.handle('file:import', async (_, filepath) => {
    await db.importFromFile(assertAuthorizedPath(filepath, 'read'));
  });

  // File content write handler
  ipcMain.handle('file:writeContent', async (_, filepath: string, content: unknown) => {
    // Chemin issu d'une boîte de dialogue native uniquement (#1146)
    const resolved = assertAuthorizedPath(filepath, 'write');
    const appDir = path.resolve(app.getAppPath());
    if (resolved.startsWith(appDir)) {
      throw new Error('Writing inside app directory is not allowed');
    }
    // Texte (UTF-8) ou octets d'un fichier de données rendu par le contrat (ADR-0021)
    if (content instanceof Uint8Array) await fs.promises.writeFile(resolved, content);
    else if (typeof content === 'string') await fs.promises.writeFile(resolved, content, 'utf-8');
    else throw new Error('Contenu invalide');
  });

  // Tableur Excel (.xlsx) écrit depuis une grille de valeurs (Mode Club : inventaire)
  ipcMain.handle(
    'file:writeSpreadsheet',
    async (_, filepath: string, rows: unknown, sheetName?: unknown) => {
      const resolved = assertAuthorizedPath(filepath, 'write');
      const appDir = path.resolve(app.getAppPath());
      if (resolved.startsWith(appDir)) {
        throw new Error('Writing inside app directory is not allowed');
      }
      if (!Array.isArray(rows) || rows.length > 20000) {
        throw new Error('Tableau invalide (20 000 lignes max)');
      }
      const grid = rows.map(
        r =>
          (Array.isArray(r) ? r : [])
            .slice(0, 200)
            .map(v => (typeof v === 'number' || typeof v === 'string' ? v : '')) as (
            string | number
          )[]
      );
      await fs.promises.writeFile(
        resolved,
        await rowsToXlsx(grid, typeof sheetName === 'string' ? sheetName : undefined)
      );
    }
  );

  // Dialog handlers
  ipcMain.handle('dialog:openFile', async (_, raw) => {
    const { binary, ...options } = (raw ?? {}) as Electron.OpenDialogOptions & {
      binary?: unknown;
    };
    const result = await dialog.showOpenDialog(getMainWindow()!, options);

    if (!result.canceled && result.filePaths.length > 0) {
      const filePath = result.filePaths[0];
      // Fichier de données (ADR-0021) : octets bornés, rendus au contrat par l'écran
      if (binary === true) {
        const files: Array<{ filePath: string; bytes: Uint8Array }> = [];
        // Plusieurs fichiers (extranet fédéral, #2134) : MAX_OPEN_FILES au plus
        for (const p of result.filePaths.slice(0, MAX_OPEN_FILES)) {
          files.push({
            filePath: p,
            bytes: new Uint8Array(await readBoundedFile(p, MAX_DATA_FILE_BYTES)),
          });
        }
        return { filePath, bytes: files[0].bytes, ...(files.length > 1 ? { files } : {}) };
      }
      authorizePath(filePath, 'read');
      try {
        const content = await readImportText(filePath);
        return { filePath, content };
      } catch (error) {
        logger.error(LogCategory.SYSTEM, 'Error reading file:', toError(error));
        return { filePath, content: '' };
      }
    }

    return null;
  });

  ipcMain.handle('dialog:saveFile', async (_, options) => {
    const result = await dialog.showSaveDialog(getMainWindow()!, options);
    if (!result.canceled && result.filePath) authorizePath(result.filePath, 'write');
    return result;
  });
}
