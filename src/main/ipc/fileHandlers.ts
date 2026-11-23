/**
 * BellePoule Modern - Handlers IPC `file:*` (écriture au chemin choisi, impression, tableur,
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
import { FEDERAL_MAX_INPUTS, unpackFederalFiles, type FederalInput } from '../federalFiles';
import { logger, LogCategory, toError } from '../../shared/services/logger';

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
      if (binary === true)
        return {
          filePath,
          bytes: new Uint8Array(await readBoundedFile(filePath, MAX_DATA_FILE_BYTES)),
        };
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

  // Fichiers de l'extranet fédéral (#1938) : .zip, ou .xml / .fff / .txt isolés
  ipcMain.handle('dialog:openFederalFiles', async () => {
    const result = await dialog.showOpenDialog(getMainWindow()!, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'FFE / FIE (.zip, .xml, .fff, .txt)',
          extensions: ['zip', 'xml', 'cotcot', 'fff', 'txt', 'csv'],
        },
        { name: '*', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const inputs: FederalInput[] = [];
    for (const filePath of result.filePaths.slice(0, FEDERAL_MAX_INPUTS)) {
      inputs.push({ name: path.basename(filePath), bytes: await readBoundedFile(filePath) });
    }
    return {
      names: inputs.map(i => i.name),
      files: await unpackFederalFiles(inputs),
    };
  });

  // Même lecture pour des fichiers glissés-déposés (contenu transmis par le renderer)
  ipcMain.handle('file:unpackFederalFiles', async (_, raw: unknown) => {
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > FEDERAL_MAX_INPUTS) {
      throw new Error('Fichiers invalides');
    }
    const inputs = raw.map((item: unknown): FederalInput => {
      const { name, bytes } = (item ?? {}) as { name?: unknown; bytes?: unknown };
      if (typeof name !== 'string' || !(bytes instanceof Uint8Array)) {
        throw new Error('Fichier invalide');
      }
      return { name, bytes };
    });
    return unpackFederalFiles(inputs);
  });

  ipcMain.handle('dialog:saveFile', async (_, options) => {
    const result = await dialog.showSaveDialog(getMainWindow()!, options);
    if (!result.canceled && result.filePath) authorizePath(result.filePath, 'write');
    return result;
  });
}
