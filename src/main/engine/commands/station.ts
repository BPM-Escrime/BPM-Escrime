/**
 * BPM - Escrime - Commandes et requêtes du poste (#1981 lot 2, docs/adr/0022)
 * Réglages et salles, thèmes d'écrans, agent MCP : reprise de l'ancien ipc/settingsHandlers.ts,
 * themesHandlers.ts et mcpHandlers.ts. Journée multi-épreuves : eventDay.ts ; RGPD : privacy.ts.
 * Pas de journal : ce ne sont pas des faits de l'épreuve. Ce qui dépend d'Electron ou du
 * système de fichiers du poste passe par le port `ctx.station`, branché par main.ts.
 * Licensed under GPL-3.0
 */
import type { AppSettingKey } from '../../../shared/types/appSettings';
import { LEGACY_LOCAL_STORAGE_KEYS, fromLegacyStorage } from '../../../shared/types/appSettings';
import { logger, LogCategory, toError } from '../../../shared/services/logger';
import { onCompetitionEvent } from '../api/events';
import { CommandError, type CommandContext } from './context';
import { portOf, refuse, type StationHandler } from './stationSupport';
import { resolveSetting, type ResolvableKey } from './settings';
import { eventDayHandlers } from './eventDay';
import { privacyHandlers } from './privacy';
import { matchDurationHandlers } from './matchDurations';
import { normalizePlaceQuery } from '../../../shared/domain/places/placeSearch';
import { assertDirectory } from './files';
import { getCompetitionOrThrow } from './competitions';

/** Valeurs localStorage (clé historique → texte) converties en paramètres typés */
export function legacyValuesToSettings(
  values: Record<string, unknown>
): Partial<Record<AppSettingKey, unknown>> {
  const out: Partial<Record<AppSettingKey, unknown>> = {};
  for (const [storageKey, settingKey] of Object.entries(LEGACY_LOCAL_STORAGE_KEYS)) {
    if (!(storageKey in values)) continue;
    const raw = values[storageKey];
    const v = fromLegacyStorage(settingKey, typeof raw === 'string' ? raw : null);
    if (v !== undefined) out[settingKey] = v;
  }
  return out;
}

/** Dossiers de l'agent : choisis par l'opérateur, sinon ceux par défaut du poste */
const agentFolders = (ctx: CommandContext) => ({
  folders: ctx.db.settings.getSetting('agentFolders'),
  defaults: ctx.station?.defaultAgentFolders() ?? [],
});

/** Écriture d'une salle, puis tables des pilotes relues (appareils déclarés sur la salle) */
function withDevices<T>(ctx: CommandContext, write: () => T): T {
  const result = refuse(write);
  ctx.devices?.reload();
  return result;
}

type SettingsOps =
  | 'getStationSettings'
  | 'updateStationSettings'
  | 'getResolvedSetting'
  | 'importLegacySettings'
  | 'listAgentFolders'
  | 'addAgentFolder'
  | 'removeAgentFolder'
  | 'getBackupDir'
  | 'setBackupDir'
  | 'resetBackupDir'
  | 'getCompetitionBackupDir'
  | 'setCompetitionBackupDir'
  | 'resetCompetitionBackupDir'
  | 'getLogoLibrary'
  | 'updateLogoLibrary'
  | 'getProxySettings'
  | 'updateProxySettings'
  | 'testProxy'
  | 'listVenues'
  | 'saveVenue'
  | 'deleteVenue'
  | 'setDefaultVenue'
  | 'listPlaceSuggestions'
  | 'listScreenThemes'
  | 'saveScreenTheme'
  | 'deleteScreenTheme'
  | 'getMcpStatus'
  | 'updateMcpSettings'
  | 'regenerateMcpToken'
  | 'listMcpLog';

const settingsHandlers: { [N in SettingsOps]: StationHandler<N> } = {
  // ── Réglages du poste ──
  getStationSettings: ctx => refuse(() => ctx.db.settings.getSettings()),
  updateStationSettings: (ctx, input) => refuse(() => ctx.db.settings.updateSettings(input)),
  getResolvedSetting: (ctx, { key, competitionId, eventDayId }) =>
    refuse(() => resolveSetting(ctx, key as ResolvableKey, { competitionId, eventDayId })),
  // Reprise douce + miroir : valeurs localStorage de l'écran (clés historiques).
  // mode 'missing' (démarrage) : seules les clés absentes de la base ; 'write' : écriture courante.
  importLegacySettings: (ctx, { values, mode }) =>
    refuse(() => {
      const settings = legacyValuesToSettings(values);
      if (mode === 'write') {
        const written: string[] = [];
        for (const [key, value] of Object.entries(settings)) {
          try {
            ctx.db.settings.updateSettings({ [key]: value });
            written.push(key);
          } catch (e) {
            logger.warn(LogCategory.SYSTEM, `importLegacySettings ${key} ignoré`, toError(e));
          }
        }
        return written;
      }
      return ctx.db.settings.importLegacySettings(settings);
    }),
  listAgentFolders: ctx => refuse(() => agentFolders(ctx)),
  // ── Dossiers choisis par desktop.pickDirectory (docs/adr/0030) : vérifiés ici ──
  addAgentFolder: (ctx, { path }) => {
    const folder = assertDirectory(path);
    return refuse(() => {
      const current = ctx.db.settings.getSetting('agentFolders');
      if (!current.includes(folder)) {
        ctx.db.settings.updateSettings({ agentFolders: [...current, folder] });
      }
      return agentFolders(ctx);
    });
  },
  getBackupDir: ctx => refuse(() => portOf(ctx).backup.info()),
  setBackupDir: (ctx, { path }) => {
    const backup = portOf(ctx).backup;
    const dir = assertDirectory(path, { writable: true });
    return refuse(() => backup.set(dir));
  },
  resetBackupDir: ctx => refuse(() => portOf(ctx).backup.reset()),
  getCompetitionBackupDir: (ctx, { competitionId }) => {
    const backup = portOf(ctx).backup;
    getCompetitionOrThrow(ctx, competitionId);
    return { dir: backup.competitionDir(competitionId) };
  },
  setCompetitionBackupDir: (ctx, { competitionId, path }) => {
    const backup = portOf(ctx).backup;
    getCompetitionOrThrow(ctx, competitionId);
    const dir = assertDirectory(path, { writable: true });
    refuse(() => backup.setCompetitionDir(competitionId, dir));
    return { dir };
  },
  // Épreuve effacée : entrée retirée quand même (rien à vérifier pour revenir au défaut)
  resetCompetitionBackupDir: (ctx, { competitionId }) => {
    refuse(() => portOf(ctx).backup.setCompetitionDir(competitionId, null));
    return { dir: null };
  },
  removeAgentFolder: (ctx, { folder }) =>
    refuse(() => {
      const current = ctx.db.settings.getSetting('agentFolders');
      ctx.db.settings.updateSettings({ agentFolders: current.filter(f => f !== folder) });
      return agentFolders(ctx);
    }),
  // ── Bibliothèque de logos (<userData>/logos.json) ; logo actif : paramètre `logo` ──
  getLogoLibrary: ctx => portOf(ctx).logos.list(),
  updateLogoLibrary: (ctx, { logos }) => portOf(ctx).logos.save(logos),
  // ── Proxy réseau du poste (session Electron) ──
  getProxySettings: ctx => portOf(ctx).proxy.settings(),
  updateProxySettings: async (ctx, input) => {
    const applied = await portOf(ctx).proxy.update(input);
    if (!applied) {
      throw new CommandError(
        'station_refused',
        'Adresse de proxy invalide : hôte:port, schéma http, https, socks4 ou socks5, sans identifiants'
      );
    }
    return applied;
  },
  testProxy: ctx => portOf(ctx).proxy.test(),
  // ── Salles ──
  listVenues: ctx => refuse(() => ctx.db.settings.listVenues()),
  // Appareils de piste déclarés sur la salle (docs/adr/0023) : pilotes rechargés
  saveVenue: (ctx, input) => withDevices(ctx, () => ctx.db.settings.upsertVenue(input)),
  deleteVenue: (ctx, { venueId }) => withDevices(ctx, () => ctx.db.settings.deleteVenue(venueId)),
  setDefaultVenue: (ctx, { venueId }) =>
    withDevices(ctx, () => ctx.db.settings.setDefaultVenue(venueId)),
  // ── Recherche de lieu (docs/adr/0026) : texte trop court ou poste sans service → rien ──
  listPlaceSuggestions: async (ctx, { query, language }) => {
    const q = normalizePlaceQuery(query);
    const places = ctx.station?.places;
    if (!places) return { suggestions: [], unavailable: true };
    return q ? places.search(q, language) : { suggestions: [], unavailable: false };
  },
  // ── Thèmes d'écrans ──
  listScreenThemes: ctx => portOf(ctx).themes.list(),
  saveScreenTheme: (ctx, { theme }) => portOf(ctx).themes.save(theme),
  deleteScreenTheme: (ctx, { themeId }) => portOf(ctx).themes.remove(themeId),
  // ── Agent MCP ──
  getMcpStatus: ctx => portOf(ctx).mcp.status(),
  updateMcpSettings: (ctx, input) => portOf(ctx).mcp.update(input),
  regenerateMcpToken: ctx => portOf(ctx).mcp.regenerateToken(),
  listMcpLog: ctx => portOf(ctx).mcp.log(),
};

/**
 * Abonnement onStationSettingsChanged : l'agent (MCP) a modifié les paramètres du poste, publié
 * sur le bus de données par `emitChange` (scope « settings »).
 */
export const onStationSettingsChanged = (
  _ctx: CommandContext,
  _input: Record<string, never>,
  emit: (event: Record<string, never>) => void
): (() => void) =>
  onCompetitionEvent(e => {
    if (e.type === 'settings:changed') emit({});
  });

/** Toutes les opérations du poste, hors abonnement */
export const stationHandlers = {
  ...settingsHandlers,
  ...eventDayHandlers,
  ...privacyHandlers,
  ...matchDurationHandlers,
};
