/**
 * BPM - Escrime - Port du poste (#1981 lot 2, docs/adr/0022)
 * Branche sur le CommandContext ce que les opérations du poste ne peuvent pas faire seules :
 * thèmes d'écrans (<userData>/themes.json), réglages RGPD (<userData>/privacy-settings.json),
 * serveur MCP, pistes de la journée en temps réel (serveurs distants des épreuves), dossiers
 * par défaut de l'agent, recherche de lieu (docs/adr/0026), bibliothèque de logos
 * (<userData>/logos.json), proxy réseau (session Electron, fourni par main.ts), données du rapport
 * de diagnostic. Remplace les canaux `settings:*`, `themes:*`, `eventDay:*`, `privacy:*`,
 * `mcp:*`, `proxy:*`, `app:getLogos`, `app:saveLogos` et `diagnostic:exportReport` migrés.
 * Licensed under GPL-3.0
 */
import type { DatabaseManager } from '../database';
import type { StationPort } from './engine/commands/context';
import { createThemesStore } from './themesStore';
import {
  readPrivacySettings,
  sanitizePrivacySettings,
  writePrivacySettings,
} from './privacySettings';
import { setNameMasking } from './remote/publicDto';
import { createDayStripService, type DayStripServiceContext } from './remote/dayStripService';
import type { createMcpController } from './mcp/mcpController';
import {
  competitionBackupDir,
  resolveBackupDir,
  setCompetitionBackupDir,
  updateBackupSettings,
} from './backupSettings';
import { createPlaceSearch } from './placeSearch';
import { createLogoLibraryStore } from './logoLibraryStore';

export interface StationPortOptions {
  db: DatabaseManager;
  userDataDir: () => string;
  /** Documents de l'utilisateur : dossier de sauvegarde par défaut */
  documentsDir: () => string;
  defaultAgentFolders: string[];
  /** Contrôleur du serveur MCP, créé après le port : lu à l'appel */
  mcp: () => ReturnType<typeof createMcpController>;
  /** Épreuve ouverte à l'écran ou servie aux tablettes (#1882) */
  isCompetitionBusy: (competitionId: string) => boolean;
  getServer: DayStripServiceContext['getServer'];
  /** Proxy réseau appliqué à la session Electron (proxySession.ts) */
  proxy: StationPort['proxy'];
  /** Données techniques du rapport de diagnostic (diagnosticInput.ts) */
  diagnostics: StationPort['diagnostics'];
}

export interface StationServices {
  port: StationPort;
  /** Arrêt de l'affectation automatique des pistes (avant fermeture de l'application) */
  stop(): void;
}

export function createStationPort(opts: StationPortOptions): StationServices {
  const dayStrips = createDayStripService({ db: opts.db, getServer: opts.getServer });
  const port: StationPort = {
    defaultAgentFolders: () => opts.defaultAgentFolders,
    themes: createThemesStore(opts.userDataDir),
    privacy: {
      settings: () => readPrivacySettings(opts.userDataDir()),
      update: input => {
        const settings = sanitizePrivacySettings(input, readPrivacySettings(opts.userDataDir()));
        writePrivacySettings(opts.userDataDir(), settings);
        setNameMasking(settings.nameMasking);
        return settings;
      },
      isCompetitionBusy: opts.isCompetitionBusy,
    },
    mcp: {
      status: () => opts.mcp().status(),
      update: input => opts.mcp().update(input),
      regenerateToken: () => opts.mcp().regenerateAndApply(),
      log: () => opts.mcp().log(),
    },
    backup: {
      info: () => resolveBackupDir(opts.userDataDir(), opts.documentsDir()),
      set: dir => {
        updateBackupSettings(opts.userDataDir(), current => ({ ...current, dir }));
        return resolveBackupDir(opts.userDataDir(), opts.documentsDir());
      },
      reset: () => {
        // Dossiers propres des épreuves gardés
        updateBackupSettings(opts.userDataDir(), ({ dir: _dir, ...rest }) => rest);
        return resolveBackupDir(opts.userDataDir(), opts.documentsDir());
      },
      competitionDir: id => competitionBackupDir(opts.userDataDir(), id),
      setCompetitionDir: (id, dir) => setCompetitionBackupDir(opts.userDataDir(), id, dir),
    },
    places: { search: createPlaceSearch() },
    logos: createLogoLibraryStore(opts.userDataDir),
    proxy: opts.proxy,
    diagnostics: opts.diagnostics,
    dayStrips,
  };
  return { port, stop: () => dayStrips.dispose() };
}
