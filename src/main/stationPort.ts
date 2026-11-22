/**
 * BellePoule Modern - Port du poste (#1981 lot 2, docs/adr/0022)
 * Branche sur le CommandContext ce que les opérations du poste ne peuvent pas faire seules :
 * thèmes d'écrans (<userData>/themes.json), réglages RGPD (<userData>/privacy-settings.json),
 * serveur MCP, pistes de la journée en temps réel (serveurs distants des épreuves), dossiers
 * par défaut de l'agent. Remplace les canaux `settings:*`, `themes:*`, `eventDay:*`,
 * `privacy:*` et `mcp:*` migrés.
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

export interface StationPortOptions {
  db: DatabaseManager;
  userDataDir: () => string;
  defaultAgentFolders: string[];
  /** Contrôleur du serveur MCP, créé après le port : lu à l'appel */
  mcp: () => ReturnType<typeof createMcpController>;
  /** Épreuve ouverte à l'écran ou servie aux tablettes (#1882) */
  isCompetitionBusy: (competitionId: string) => boolean;
  getServer: DayStripServiceContext['getServer'];
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
    dayStrips,
  };
  return { port, stop: () => dayStrips.dispose() };
}
