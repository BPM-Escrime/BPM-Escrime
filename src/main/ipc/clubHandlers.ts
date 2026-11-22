/**
 * BellePoule Modern - Handlers IPC `club:*` restants : fichiers du Mode Club (#1872).
 * Photos d'un ZIP et sauvegardes .bpclub portent un chemin de fichier : fonctions du poste
 * (docs/adr/0021), hors contrat. Le reste du Mode Club passe par le contrat (docs/adr/0022,
 * engine/commands/club.ts).
 * Licensed under GPL-3.0
 */
import { ipcMain } from 'electron';
import * as fs from 'fs';
import { readPhotosZip } from './fileHandlers';
import { assertAuthorizedPath, readBoundedFile } from '../pathAuthorization';
import { CLUB_BACKUP_EXT, decodeClubBackup, encodeClubBackup } from '../clubBackupFile';
import type { DatabaseManager } from '../../database';

export interface ClubHandlersContext {
  db: DatabaseManager;
}

export function registerClubHandlers({ db }: ClubHandlersContext): void {
  ipcMain.handle('club:importPhotos', async (_, clubId: string, filepath: string) =>
    db.club.setPhotosByLicense(clubId, await readPhotosZip(filepath))
  );
  // Sauvegarde complète d'un club (.bpclub) pour la recharger sur un autre poste
  ipcMain.handle('club:exportBackup', async (_, clubId: string, filePath: string) => {
    const target = assertAuthorizedPath(filePath, 'write', [CLUB_BACKUP_EXT]);
    const backup = db.clubBackup.exportClub(clubId);
    await fs.promises.writeFile(target, await encodeClubBackup(backup));
    return { clubName: backup.clubName };
  });
  ipcMain.handle('club:importBackup', async (_, filePath: string, replace?: boolean) => {
    const source = assertAuthorizedPath(filePath, 'read', [CLUB_BACKUP_EXT]);
    const data = await decodeClubBackup(await readBoundedFile(source));
    return db.clubBackup.importClub(data, replace === true);
  });
}
