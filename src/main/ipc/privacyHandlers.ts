/**
 * BellePoule Modern - Handlers IPC `privacy:*` restants : outils RGPD (#1882).
 * Les droits des personnes, la durée de conservation et l'affichage des noms sur le réseau
 * sont des opérations du contrat (engine/commands/privacy.ts, docs/adr/0022). Restent en IPC
 * ce qui ouvre un dialogue natif ou porte un chemin de fichier (ADR-0021) : export JSON d'une
 * personne, archives .bpm chiffrées (export, ouverture par Fichier → Ouvrir).
 * Licensed under GPL-3.0
 */
import { dialog, ipcMain, type BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { DatabaseManager } from '../../database';
import { readPrivacySettings } from '../privacySettings';
import { setNameMasking } from '../remote/publicDto';
import { decryptBpmFile, encryptBpmFileTo, MIN_BPM_PASSWORD } from '../bpmCrypto';
import { applyRetention } from '../engine/commands/privacy';
import type { PrivacyPersonRef } from '../../shared/types/privacy';
import { logger, LogCategory, toError } from '../../shared/services/logger';

export interface PrivacyHandlersContext {
  db: DatabaseManager;
  getMainWindow(): BrowserWindow | null;
}

// Pas de troncature silencieuse (#1882) : les identifiants sont revalidés en base
const strIds = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

const asRecord = (input: unknown): Record<string, unknown> =>
  (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;

const asRef = (input: unknown): PrivacyPersonRef => {
  const r = asRecord(input);
  return { fencerIds: strIds(r.fencerIds), memberIds: strIds(r.memberIds) };
};

const safeFileName = (name: unknown, fallback: string): string => {
  const base = String(name ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  return base || fallback;
};

/** Au démarrage (base ouverte) : réglage d'affichage des noms + purge automatique */
export function applyStoredPrivacySettings(db: DatabaseManager, userDataDir: string): void {
  const settings = readPrivacySettings(userDataDir);
  setNameMasking(settings.nameMasking);
  if (!settings.autoPurge || !db.isOpen()) return;
  try {
    const r = applyRetention(db, settings);
    if (r.competitions || r.members) {
      logger.info(
        LogCategory.DATABASE,
        `[RGPD] conservation : ${r.competitions} compétition(s), ${r.members} membre(s) (${settings.retentionAction})`
      );
    }
  } catch (e) {
    logger.error(LogCategory.DATABASE, '[RGPD] purge automatique impossible', toError(e));
  }
}

export function createPrivacyHandlers({ db, getMainWindow }: PrivacyHandlersContext) {
  // Archive chiffrée choisie par Fichier → Ouvrir, en attente du mot de passe
  let pendingEncrypted: string | null = null;

  /** Fichier → Ouvrir sur une archive chiffrée : demande du mot de passe au renderer */
  const requestEncryptedOpen = (filepath: string): void => {
    pendingEncrypted = filepath;
    getMainWindow()?.webContents.send('privacy:encrypted-bpm', path.basename(filepath));
  };

  const register = (): void => {
    ipcMain.handle('privacy:exportPerson', async (_, ref: unknown, defaultName: unknown) => {
      const data = db.privacy.exportPerson(asRef(ref));
      if (data.competitions.length === 0 && data.club.length === 0) {
        return { success: false, error: 'not_found' };
      }
      const win = getMainWindow();
      const opts = {
        defaultPath: `${safeFileName(defaultName, 'donnees-personnelles')}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      };
      const result = win
        ? await dialog.showSaveDialog(win, opts)
        : await dialog.showSaveDialog(opts);
      if (result.canceled || !result.filePath) return { success: false, canceled: true };
      await fs.promises.writeFile(result.filePath, JSON.stringify(data, null, 2), 'utf8');
      return { success: true, path: result.filePath };
    });

    ipcMain.handle(
      'privacy:exportEncryptedBpm',
      async (_, competitionId: unknown, password: unknown) => {
        if (typeof password !== 'string' || password.length < MIN_BPM_PASSWORD) {
          return { success: false, error: 'password_too_short' };
        }
        const id = typeof competitionId === 'string' && competitionId ? competitionId : null;
        const competition = id ? db.getCompetition(id) : null;
        if (id && !competition) return { success: false, error: 'competition_not_found' };
        const win = getMainWindow();
        const opts = {
          defaultPath: `${safeFileName(competition?.title, 'competition')}.bpm`,
          filters: [{ name: 'BellePoule', extensions: ['bpm'] }],
        };
        const result = win
          ? await dialog.showSaveDialog(win, opts)
          : await dialog.showSaveDialog(opts);
        if (result.canceled || !result.filePath) return { success: false, canceled: true };
        // Copie en clair sous userData uniquement, jamais au chemin choisi (#1882)
        const plain = path.join(
          path.dirname(db.getPath()),
          `.export-${Date.now()}-${Math.random().toString(36).slice(2)}.bpm`
        );
        try {
          if (id) await db.exportCompetitionToFile(id, plain);
          else await db.exportToFile(plain);
          await encryptBpmFileTo(plain, result.filePath, password);
          return { success: true, path: result.filePath };
        } catch (e) {
          await fs.promises.unlink(`${result.filePath}.enc-tmp`).catch(() => undefined);
          return { success: false, error: String(e) };
        } finally {
          for (const f of [plain, `${plain}-wal`, `${plain}-shm`, `${plain}-journal`]) {
            await fs.promises.unlink(f).catch(() => undefined);
          }
        }
      }
    );

    ipcMain.handle('privacy:openEncryptedBpm', async (_, password: unknown) => {
      if (!pendingEncrypted) return { success: false, error: 'no_pending_file' };
      if (typeof password !== 'string' || !password) {
        return { success: false, error: 'wrong_password' };
      }
      const tmp = path.join(
        path.dirname(db.getPath()),
        `.decrypt-${Date.now()}-${Math.random().toString(36).slice(2)}.bpm`
      );
      try {
        await decryptBpmFile(pendingEncrypted, tmp, password);
        const ids = await db.mergeFromFile(tmp);
        const opened = pendingEncrypted;
        pendingEncrypted = null;
        getMainWindow()?.webContents.send('file:opened', opened, ids);
        return { success: true, ids };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { success: false, error: msg === 'wrong_password' ? msg : 'open_failed' };
      } finally {
        for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) {
          await fs.promises.unlink(f).catch(() => undefined);
        }
      }
    });

    ipcMain.handle('privacy:cancelEncryptedBpm', async () => {
      pendingEncrypted = null;
    });
  };

  return { register, requestEncryptedOpen };
}
