/**
 * BPM - Escrime - Logos du poste (docs/adr/0022) : bibliothèque (<userData>/logos.json, port
 * `ctx.station.logos`, opérations getLogoLibrary / updateLogoLibrary ; ex-canaux app:getLogos,
 * app:saveLogos). Le logo actif est le paramètre `logo` des réglages du poste, en base : seule
 * source (getStationSettings, setRemoteLogo). L'ancien fichier <userData>/logo.dat est repris
 * en base au démarrage puis supprimé (ex-canal app:getLogo).
 * Licensed under GPL-3.0
 */
import * as fs from 'fs';
import * as path from 'path';
import type { DatabaseManager } from '../database';
import {
  MAX_LOGO_CHARS,
  MAX_LOGO_LIBRARY,
  MAX_LOGO_NAME,
  type LogoLibraryEntry,
} from '../shared/types/appSettings';
import type { StationPort } from './engine/commands/context';
import { logger, LogCategory, toError } from '../shared/services/logger';

const LIBRARY_FILE = 'logos.json';
const LEGACY_ACTIVE_FILE = 'logo.dat';

/** Liste de logos valides (data URL d'image), sans doublon d'id, bornée */
export function sanitizeLogoEntries(raw: unknown): LogoLibraryEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: LogoLibraryEntry[] = [];
  for (const v of raw as unknown[]) {
    if (!v || typeof v !== 'object') continue;
    const e = v as Record<string, unknown>;
    if (
      typeof e.id !== 'string' ||
      !e.id ||
      typeof e.name !== 'string' ||
      typeof e.data !== 'string' ||
      !e.data.startsWith('data:image/') ||
      e.data.length > MAX_LOGO_CHARS ||
      seen.has(e.id)
    ) {
      continue;
    }
    seen.add(e.id);
    out.push({ id: e.id, name: e.name.slice(0, MAX_LOGO_NAME), data: e.data });
    if (out.length >= MAX_LOGO_LIBRARY) break;
  }
  return out;
}

export function createLogoLibraryStore(userDataDir: () => string): StationPort['logos'] {
  const file = () => path.join(userDataDir(), LIBRARY_FILE);
  return {
    list: async () => {
      try {
        return sanitizeLogoEntries(JSON.parse(await fs.promises.readFile(file(), 'utf-8')));
      } catch {
        return [];
      }
    },
    save: async logos => {
      const clean = sanitizeLogoEntries(logos);
      const target = file();
      const tmp = `${target}.tmp`;
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.writeFile(tmp, JSON.stringify(clean), 'utf-8');
      await fs.promises.rename(tmp, target);
      return clean;
    },
  };
}

/**
 * Reprise de l'ancien logo actif (<userData>/logo.dat) : copié en base si le poste n'y a pas
 * encore de logo, puis fichier supprimé (plus jamais lu ni écrit).
 */
export function importLegacyLogoFile(db: DatabaseManager, userDataDir: string): void {
  const legacy = path.join(userDataDir, LEGACY_ACTIVE_FILE);
  let logo: string;
  try {
    logo = fs.readFileSync(legacy, 'utf-8');
  } catch {
    return; // pas d'ancien fichier
  }
  try {
    if (logo.startsWith('data:image/') && logo.length <= MAX_LOGO_CHARS) {
      db.settings.importLegacySettings({ logo });
    }
    fs.unlinkSync(legacy);
  } catch (e) {
    logger.warn(LogCategory.SYSTEM, '[Logo] reprise de logo.dat impossible', toError(e));
  }
}
