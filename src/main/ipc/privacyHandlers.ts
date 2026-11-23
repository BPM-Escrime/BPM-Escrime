/**
 * BPM - Escrime - RGPD côté main (#1882) : réglages appliqués au démarrage, avis à l'écran
 * d'une archive .bpm chiffrée choisie par Fichier → Ouvrir. Droits des personnes, conservation,
 * export JSON d'une personne (getPersonData) et archives chiffrées (getEncryptedCompetitionFile,
 * openCompetitionFile) sont des opérations du contrat (docs/adr/0021, 0022). Plus aucun canal
 * `privacy:*` en ipcMain.
 * Licensed under GPL-3.0
 */
import type { BrowserWindow } from 'electron';
import * as path from 'path';
import type { DatabaseManager } from '../../database';
import { readPrivacySettings } from '../privacySettings';
import { setNameMasking } from '../remote/publicDto';
import { applyRetention } from '../engine/commands/privacy';
import { readBoundedFile } from '../pathAuthorization';
import { MAX_DATA_FILE_BYTES } from '../../shared/api/contractFiles';
import { logger, LogCategory, toError } from '../../shared/services/logger';

export interface PrivacyHandlersContext {
  getMainWindow(): BrowserWindow | null;
}

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

/**
 * Fichier → Ouvrir sur une archive chiffrée (menu natif) : l'écran reçoit le nom et le contenu,
 * demande le mot de passe puis ouvre l'archive par le contrat (openCompetitionFile, ADR-0021).
 * Aucun canal ipcMain : le mot de passe ne passe que par api:invoke.
 */
export function createPrivacyHandlers({ getMainWindow }: PrivacyHandlersContext) {
  const requestEncryptedOpen = async (filepath: string): Promise<void> => {
    const content = await readBoundedFile(filepath, MAX_DATA_FILE_BYTES);
    getMainWindow()?.webContents.send(
      'privacy:encrypted-bpm',
      path.basename(filepath),
      content.toString('base64')
    );
  };
  return { requestEncryptedOpen };
}
