/**
 * BPM - Escrime - Sauvegardes automatiques (toutes les 2 min, cf. main.ts)
 * Licensed under GPL-3.0
 *
 * - Base complète → dossier global (`resolveBackupDir`), fichier fixe.
 * - Épreuve avec un dossier propre sur ce poste (backup-settings.json, docs/adr/0030) → copie de
 *   cette seule épreuve dans ce dossier.
 * Chaque fichier est écrit en `.tmp` puis renommé : pas de fichier à moitié écrit.
 */
import fs from 'fs';
import path from 'path';
import {
  AUTOSAVE_FILE_NAME,
  competitionAutosaveName,
  readBackupSettings,
  resolveBackupDir,
} from './backupSettings';

/** Sous-ensemble de DatabaseManager utilisé par les sauvegardes */
export interface AutosaveSource {
  exportToFile(filepath: string): Promise<void>;
  exportCompetitionToFile(competitionId: string, filepath: string): Promise<void>;
  getAllCompetitions(): { id: string; title?: string }[];
}

async function writeAtomic(target: string, write: (tmp: string) => Promise<void>): Promise<void> {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  fs.rmSync(tmp, { force: true });
  await write(tmp);
  fs.renameSync(tmp, target);
}

export async function runBackupAutosave(
  db: AutosaveSource,
  userDataPath: string,
  documentsPath: string
): Promise<void> {
  const { dir } = resolveBackupDir(userDataPath, documentsPath);
  await writeAtomic(path.join(dir, AUTOSAVE_FILE_NAME), tmp => db.exportToFile(tmp));

  // Une compétition en échec (dossier supprimé, disque plein) n'empêche pas les autres
  const failures: string[] = [];
  const dirs = readBackupSettings(userDataPath).competitions ?? {};
  for (const comp of db.getAllCompetitions()) {
    const compDir = dirs[comp.id];
    if (!compDir) continue;
    const target = path.join(compDir, competitionAutosaveName(comp.title, comp.id));
    try {
      await writeAtomic(target, tmp => db.exportCompetitionToFile(comp.id, tmp));
    } catch (e) {
      failures.push(`${comp.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (failures.length > 0) throw new Error(`Sauvegarde compétition(s) : ${failures.join(' ; ')}`);
}
