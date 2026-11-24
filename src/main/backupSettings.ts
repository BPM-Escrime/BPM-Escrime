/**
 * BPM - Escrime - Dossier de sauvegarde par défaut (Paramètres → Sauvegarde)
 * Licensed under GPL-3.0
 *
 * Fichier `<userData>/backup-settings.json` :
 * `{ "dir": "/chemin", "competitions": { "<id épreuve>": "/chemin" }, "legacyImported": true }`.
 * Sans réglage, le dossier par défaut est `<Documents>/BPM - Escrime`.
 * Les sauvegardes automatiques (toutes les 2 minutes) et « Enregistrer » y écrivent.
 * Dossier propre d'une épreuve : réglage du poste, par épreuve (docs/adr/0030), et non plus
 * `settings.backupDir` de l'épreuve, repris une seule fois au démarrage
 * (`importLegacyCompetitionBackupDirs`).
 */

import fs from 'fs';
import path from 'path';

export const BACKUP_SETTINGS_FILE = 'backup-settings.json';
/** Nom fixe de la sauvegarde automatique : écrasée à chaque cycle, jamais empilée */
export const AUTOSAVE_FILE_NAME = 'BPM-Escrime-autosave.bpm';

export interface BackupSettings {
  /** Dossier choisi par l'utilisateur ; absent = dossier par défaut */
  dir?: string;
  /** Dossier propre d'une épreuve sur ce poste : identifiant → chemin absolu (ADR-0030) */
  competitions?: Record<string, string>;
  /** Reprise des anciens `settings.backupDir` faite : jamais refaite (ADR-0030) */
  legacyImported?: boolean;
}

export interface BackupDirInfo {
  dir: string;
  isDefault: boolean;
}

/** Dossier par défaut : `<Documents>/BPM - Escrime` */
export function defaultBackupDir(documentsPath: string): string {
  return path.join(documentsPath, 'BPM - Escrime');
}

/** Chemin saisi valide : absolu, sans octet nul ; normalisé. */
export function sanitizeBackupDir(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const dir = input.trim();
  if (!dir || dir.includes('\0') || !path.isAbsolute(dir)) return null;
  return path.normalize(dir);
}

export function readBackupSettings(userDataPath: string): BackupSettings {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(userDataPath, BACKUP_SETTINGS_FILE), 'utf8')
    ) as { dir?: unknown; competitions?: unknown; legacyImported?: unknown };
    const dir = sanitizeBackupDir(raw.dir);
    const competitions: Record<string, string> = {};
    if (raw.competitions && typeof raw.competitions === 'object') {
      for (const [id, value] of Object.entries(raw.competitions as Record<string, unknown>)) {
        const compDir = sanitizeBackupDir(value);
        if (compDir) competitions[id] = compDir;
      }
    }
    return {
      ...(dir ? { dir } : {}),
      ...(Object.keys(competitions).length ? { competitions } : {}),
      ...(raw.legacyImported === true ? { legacyImported: true } : {}),
    };
  } catch {
    return {};
  }
}

export function writeBackupSettings(userDataPath: string, settings: BackupSettings): void {
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(
    path.join(userDataPath, BACKUP_SETTINGS_FILE),
    `${JSON.stringify(settings, null, 2)}\n`,
    'utf8'
  );
}

/** Dossier effectif de sauvegarde : réglage utilisateur, sinon dossier par défaut. */
export function resolveBackupDir(userDataPath: string, documentsPath: string): BackupDirInfo {
  const { dir } = readBackupSettings(userDataPath);
  return dir
    ? { dir, isDefault: false }
    : { dir: defaultBackupDir(documentsPath), isDefault: true };
}

/** Modifie le réglage : lu, transformé, réécrit en entier (les autres clés sont gardées) */
export function updateBackupSettings(
  userDataPath: string,
  change: (current: BackupSettings) => BackupSettings
): BackupSettings {
  const next = change(readBackupSettings(userDataPath));
  writeBackupSettings(userDataPath, next);
  return next;
}

/** Dossier propre d'une épreuve sur ce poste ; null : dossier du poste */
export function competitionBackupDir(userDataPath: string, competitionId: string): string | null {
  return readBackupSettings(userDataPath).competitions?.[competitionId] ?? null;
}

/** Fixe (chemin) ou retire (null) le dossier propre d'une épreuve */
export function setCompetitionBackupDir(
  userDataPath: string,
  competitionId: string,
  dir: string | null
): void {
  updateBackupSettings(userDataPath, current => {
    const competitions = { ...current.competitions };
    if (dir) competitions[competitionId] = dir;
    else delete competitions[competitionId];
    const { competitions: _old, ...rest } = current;
    return Object.keys(competitions).length ? { ...rest, competitions } : rest;
  });
}

/** Dossier existant (et non un fichier) ? */
const isDirectory = (dir: string): boolean => {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
};

export interface LegacyBackupDirReport {
  /** Épreuves dont le dossier a été repris */
  imported: string[];
  /** Épreuves dont le dossier a été ignoré (chemin invalide ou dossier absent) */
  ignored: { competitionId: string; dir: string }[];
}

/**
 * Reprise unique des anciens `competition.settings.backupDir` (ADR-0030) : chaque chemin qui
 * désigne un dossier existant devient le dossier propre de l'épreuve sur ce poste ; les autres
 * sont ignorés (rendus pour la trace). Un dossier déjà réglé sur le poste n'est pas remplacé.
 * Faite une fois (`legacyImported`) : une archive .bpm importée plus tard, venue d'un autre
 * poste, n'est jamais reprise. La clé reste dans le JSON des épreuves, ignorée.
 */
export function importLegacyCompetitionBackupDirs(
  userDataPath: string,
  competitions: readonly { id: string; settings?: unknown }[]
): LegacyBackupDirReport | null {
  const current = readBackupSettings(userDataPath);
  if (current.legacyImported) return null;
  const report: LegacyBackupDirReport = { imported: [], ignored: [] };
  const table = { ...current.competitions };
  for (const comp of competitions) {
    const raw = (comp.settings as { backupDir?: unknown } | undefined)?.backupDir;
    if (raw === undefined || raw === null || raw === '') continue;
    const dir = sanitizeBackupDir(raw);
    if (!dir || !isDirectory(dir)) {
      report.ignored.push({ competitionId: comp.id, dir: String(raw) });
      continue;
    }
    if (!table[comp.id]) table[comp.id] = dir;
    report.imported.push(comp.id);
  }
  const { competitions: _old, ...rest } = current;
  writeBackupSettings(userDataPath, {
    ...rest,
    ...(Object.keys(table).length ? { competitions: table } : {}),
    legacyImported: true,
  });
  return report;
}

/** Nom de la sauvegarde automatique d'une compétition : titre assaini + début d'id (unicité) */
export function competitionAutosaveName(title: string | undefined, competitionId: string): string {
  const base = (title ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  const shortId = competitionId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
  return `${base || 'competition'}-${shortId}-autosave.bpm`;
}
