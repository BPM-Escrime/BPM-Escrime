/**
 * BellePoule Modern - Preload Script
 * Exposes safe APIs to the renderer process with type safety
 * Licensed under GPL-3.0
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import type {
  TrainingCustomRules,
  ElectronAPI,
  CompetitionEventType,
  UpdateInfo,
  UpdateProgressEvent,
  ProxySettingsDTO,
  RemoteArenaUpdateEvent,
  RemoteMatchFinishedEvent,
} from '../shared/types/preload';

import { setPrintRequestHandler, type PrintRequestHandler } from './preloadApi/printHandler';
import { dbApi } from './preloadApi/dbApi';
import { fileApi } from './preloadApi/fileApi';
import { dialogApi } from './preloadApi/dialogApi';
import { remoteApi } from './preloadApi/remoteApi';
import { subscribe } from './preloadApi/subscribe';
import { apiBridge } from './preloadApi/apiBridge';

// Expose protected methods that allow the renderer process
// to use the ipcRenderer without exposing the entire object

const electronApi = {
  // Contrat d'API unique (#1981) : préférer BpmClient (src/renderer/api) à cet accès direct
  api: apiBridge,

  // Database operations with validation
  db: dbApi,

  // File operations with validation
  file: fileApi,

  // Dialog operations with validation
  dialog: dialogApi,

  // Menu event listeners : chaque on* retourne sa fonction de désabonnement (#1894)
  onMenuNewCompetition: (callback: () => void) => subscribe('menu:new-competition', callback),
  onMenuSave: (callback: () => void) => subscribe('menu:save', callback),
  onMenuCompetitionProperties: (callback: () => void) =>
    subscribe('menu:competition-properties', callback),
  onMenuAddFencer: (callback: () => void) => subscribe('menu:add-fencer', callback),
  onMenuAddReferee: (callback: () => void) => subscribe('menu:add-referee', callback),
  onMenuNextPhase: (callback: () => void) => subscribe('menu:next-phase', callback),
  onMenuExport: (callback: (format: string) => void) => subscribe('menu:export', callback),
  onMenuImport: (callback: (format: string, filepath: string, content: string) => void) =>
    subscribe('menu:import', callback),
  onMenuOpenSettings: (callback: () => void) => subscribe('menu:open-settings', callback),
  onMenuReportIssue: (callback: () => void) => subscribe('menu:report-issue', callback),
  onShowAbout: (callback: () => void) => subscribe('menu:show-about', callback),
  onFileOpened: (callback: (filepath: string, competitionIds?: string[]) => void) =>
    subscribe('file:opened', callback),
  setCurrentCompetition: (competitionId: string | null) =>
    ipcRenderer.send('app:current-competition', competitionId),
  onFileSaved: (callback: (filepath: string) => void) => subscribe('file:saved', callback),
  onAutosaveCompleted: (callback: () => void) => subscribe('autosave:completed', callback),
  onAutosaveFailed: (callback: () => void) => subscribe('autosave:failed', callback),
  onDbReady: (callback: () => void) => ipcRenderer.once('db:ready', callback),

  // Boîte d'impression intégrée (#1214)
  printDialog: {
    getPrinters: () => ipcRenderer.invoke('print:getPrinters'),
    render: (html: string, settings?: Record<string, unknown>) => {
      if (!html || typeof html !== 'string') throw new Error('HTML content is required');
      return ipcRenderer.invoke('print:render', html, settings);
    },
    execute: (html: string, settings?: Record<string, unknown>) => {
      if (!html || typeof html !== 'string') throw new Error('HTML content is required');
      return ipcRenderer.invoke('print:execute', html, settings);
    },
    savePdf: (html: string, settings?: Record<string, unknown>, title?: string) => {
      if (!html || typeof html !== 'string') throw new Error('HTML content is required');
      return ipcRenderer.invoke('print:savePdf', html, settings, title);
    },
    systemDialog: (html: string) => {
      if (!html || typeof html !== 'string') throw new Error('HTML content is required');
      return ipcRenderer.invoke('print:systemDialog', html);
    },
    /** Le renderer enregistre la fenêtre d'impression qui traite les demandes `file.printHtml` */
    setHandler: (handler: PrintRequestHandler | null) => {
      setPrintRequestHandler(handler);
    },
  },

  // Utility functions
  print: () => ipcRenderer.invoke('window:print'),
  setWindowSize: (width: number, height: number, options?: { force?: boolean }) =>
    ipcRenderer.invoke('window:setSize', width, height, options),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  getEventLoopDelay: (reset?: boolean) =>
    ipcRenderer.invoke('perf:getEventLoopDelay', reset === true),
  getVersionInfo: () => ipcRenderer.invoke('app:getVersionInfo'),

  // Updater functions
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    setSilentMode: (enabled: boolean) => {
      if (typeof enabled !== 'boolean') {
        throw new Error('Enabled must be a boolean');
      }
      return ipcRenderer.invoke('updater:setSilentMode', enabled);
    },
    getSilentMode: () => ipcRenderer.invoke('updater:getSilentMode'),
    hasPendingUpdate: () => ipcRenderer.invoke('updater:hasPendingUpdate'),
    getPendingUpdateInfo: () => ipcRenderer.invoke('updater:getPendingUpdateInfo'),
    installPendingUpdate: () => ipcRenderer.invoke('updater:installPendingUpdate'),
    downloadAndInstall: () => ipcRenderer.invoke('updater:downloadAndInstall'),
    getAutoCheck: () => ipcRenderer.invoke('updater:getAutoCheck'),
    setAutoCheck: (enabled: boolean) => {
      if (typeof enabled !== 'boolean') {
        throw new Error('Enabled must be a boolean');
      }
      return ipcRenderer.invoke('updater:setAutoCheck', enabled);
    },
    getDownloadDir: () => ipcRenderer.invoke('updater:getDownloadDir'),
    chooseDownloadDir: () => ipcRenderer.invoke('updater:chooseDownloadDir'),
    resetDownloadDir: () => ipcRenderer.invoke('updater:resetDownloadDir'),
    getChannel: () => ipcRenderer.invoke('updater:getChannel'),
    setChannel: (channel: 'stable' | 'dev') => {
      if (channel !== 'stable' && channel !== 'dev') {
        throw new Error('Invalid channel');
      }
      return ipcRenderer.invoke('updater:setChannel', channel);
    },
  },

  // RGPD (#1882) : droits des personnes, conservation, .bpm chiffrés
  mcp: {
    getStatus: () => ipcRenderer.invoke('mcp:getStatus'),
    setSettings: (settings: { enabled?: boolean; port?: number; allowWrite?: boolean }) =>
      ipcRenderer.invoke('mcp:setSettings', settings),
    regenerateToken: () => ipcRenderer.invoke('mcp:regenerateToken'),
    getLog: () => ipcRenderer.invoke('mcp:getLog'),
  },

  privacy: {
    getSettings: () => ipcRenderer.invoke('privacy:getSettings'),
    setSettings: (settings: unknown) => ipcRenderer.invoke('privacy:setSettings', settings),
    findPersons: (query: string) => ipcRenderer.invoke('privacy:findPersons', query),
    exportPerson: (ref: unknown, defaultName?: string) =>
      ipcRenderer.invoke('privacy:exportPerson', ref, defaultName),
    getPersonData: (ref: unknown) => ipcRenderer.invoke('privacy:getPersonData', ref),
    anonymizePerson: (ref: unknown) => ipcRenderer.invoke('privacy:anonymizePerson', ref),
    erasePerson: (ref: unknown) => ipcRenderer.invoke('privacy:erasePerson', ref),
    retentionCandidates: () => ipcRenderer.invoke('privacy:retentionCandidates'),
    applyRetention: (selection?: unknown) =>
      ipcRenderer.invoke('privacy:applyRetention', selection),
    exportEncryptedBpm: (competitionId: string | null, password: string) =>
      ipcRenderer.invoke('privacy:exportEncryptedBpm', competitionId, password),
    openEncryptedBpm: (password: string) =>
      ipcRenderer.invoke('privacy:openEncryptedBpm', password),
    cancelEncryptedBpm: () => ipcRenderer.invoke('privacy:cancelEncryptedBpm'),
    onEncryptedBpmRequest: (callback: (fileName: string) => void) => {
      const handler = (_: IpcRendererEvent, fileName: string) => callback(fileName);
      ipcRenderer.on('privacy:encrypted-bpm', handler);
      return () => ipcRenderer.removeListener('privacy:encrypted-bpm', handler);
    },
  },

  // Proxy réseau (Paramètres → Réseau)
  backup: {
    get: () => ipcRenderer.invoke('backup:get'),
    chooseDir: () => ipcRenderer.invoke('backup:chooseDir'),
    resetDir: () => ipcRenderer.invoke('backup:resetDir'),
    pickCompetitionDir: () => ipcRenderer.invoke('backup:pickCompetitionDir'),
  },
  proxy: {
    get: () => ipcRenderer.invoke('proxy:get'),
    set: (settings: ProxySettingsDTO) => ipcRenderer.invoke('proxy:set', settings),
    test: () => ipcRenderer.invoke('proxy:test'),
  },

  // Rapport de diagnostic (fichier JSON, sans port réseau) (#1326)
  diagnostic: {
    exportReport: () => ipcRenderer.invoke('diagnostic:exportReport'),
  },

  // Publication des résultats sur GREG (escrime-info.com), envoi fait par le main (#1328)
  greg: {
    publish: (request: unknown) => ipcRenderer.invoke('greg:publish', request),
  },

  // Connecteur FTP/FTPS : dépôt du fichier de résultats (#1331)
  ftp: {
    publish: (request: unknown) => ipcRenderer.invoke('ftp:publish', request),
  },

  // Chiffrement OS (safeStorage) pour secrets locaux
  crypto: {
    isAvailable: (): Promise<boolean> => ipcRenderer.invoke('crypto:isAvailable'),
    protect: (plaintext: string): Promise<string | null> => {
      if (typeof plaintext !== 'string') throw new Error('plaintext must be a string');
      return ipcRenderer.invoke('crypto:protect', plaintext);
    },
    unprotect: (ciphertext: string): Promise<string | null> => {
      if (typeof ciphertext !== 'string') throw new Error('ciphertext must be a string');
      return ipcRenderer.invoke('crypto:unprotect', ciphertext);
    },
  },

  // Remote score server functions
  remote: remoteApi,

  // Journée multi-épreuves (#1714)
  eventDay: {
    list: () => ipcRenderer.invoke('eventDay:list'),
    create: (data: { name: string; date: string; stripCount?: number }) =>
      ipcRenderer.invoke('eventDay:create', data),
    update: (id: string, updates: { name?: string; date?: string; stripCount?: number }) =>
      ipcRenderer.invoke('eventDay:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('eventDay:delete', id),
    setCompetitionDay: (competitionId: string, dayId: string | null) =>
      ipcRenderer.invoke('eventDay:setCompetitionDay', competitionId, dayId),
    listReferees: (dayId: string) => ipcRenderer.invoke('eventDay:listReferees', dayId),
    createReferee: (dayId: string, data: Record<string, unknown>) =>
      ipcRenderer.invoke('eventDay:createReferee', dayId, data),
    updateReferee: (id: string, data: Record<string, unknown>) =>
      ipcRenderer.invoke('eventDay:updateReferee', id, data),
    deleteReferee: (id: string) => ipcRenderer.invoke('eventDay:deleteReferee', id),
    syncReferees: (dayId: string) => ipcRenderer.invoke('eventDay:syncReferees', dayId),
    getOverview: (dayId: string) => ipcRenderer.invoke('eventDay:getOverview', dayId),
    getBusyElsewhere: (competitionId: string) =>
      ipcRenderer.invoke('eventDay:getBusyElsewhere', competitionId),
    getStripOccupation: (dayId: string) => ipcRenderer.invoke('eventDay:getStripOccupation', dayId),
    getStripBoard: (dayId: string) => ipcRenderer.invoke('eventDay:getStripBoard', dayId),
    assignStrip: (dayId: string, strip: number, key: string) =>
      ipcRenderer.invoke('eventDay:assignStrip', dayId, strip, key),
    setStripRule: (dayId: string, strip: number, rule: unknown) =>
      ipcRenderer.invoke('eventDay:setStripRule', dayId, strip, rule),
    setAutoAssign: (dayId: string, on: boolean) =>
      ipcRenderer.invoke('eventDay:setAutoAssign', dayId, on),
  },

  // Paramétrage global du poste et salles (#1880)
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (updates: Record<string, unknown>) => ipcRenderer.invoke('settings:update', updates),
    importLegacy: (values: Record<string, string | null>, mode: 'missing' | 'write') =>
      ipcRenderer.invoke('settings:importLegacy', values, mode),
    resolve: (key: string, scope?: { competitionId?: string; eventDayId?: string }) =>
      ipcRenderer.invoke('settings:resolve', key, scope ?? {}),
    listVenues: () => ipcRenderer.invoke('settings:listVenues'),
    upsertVenue: (input: import('../shared/types/appSettings').VenueInput) =>
      ipcRenderer.invoke('settings:upsertVenue', input),
    setDefaultVenue: (id: string) => ipcRenderer.invoke('settings:setDefaultVenue', id),
    deleteVenue: (id: string) => ipcRenderer.invoke('settings:deleteVenue', id),
    getAgentFolders: () => ipcRenderer.invoke('settings:getAgentFolders'),
    addAgentFolder: () => ipcRenderer.invoke('settings:addAgentFolder'),
    removeAgentFolder: (folder: string) => ipcRenderer.invoke('settings:removeAgentFolder', folder),
  },
  // Mode Club (#1872) : fichiers seulement (photos ZIP, sauvegardes .bpclub, docs/adr/0021) ;
  // le reste passe par le contrat d'API (docs/adr/0022)
  club: {
    importPhotos: (clubId: string, filepath: string) => {
      if (!filepath || typeof filepath !== 'string') throw new Error('Filepath is required');
      return ipcRenderer.invoke('club:importPhotos', clubId, filepath);
    },
    exportBackup: (clubId: string, filePath: string) =>
      ipcRenderer.invoke('club:exportBackup', clubId, filePath),
    importBackup: (filePath: string, replace?: boolean) =>
      ipcRenderer.invoke('club:importBackup', filePath, replace),
  },

  training: {
    startServer: (port?: number, host?: string, useHttps?: boolean) =>
      ipcRenderer.invoke('training:startServer', port, host, useHttps),
    stopServer: () => ipcRenderer.invoke('training:stopServer'),
    startSession: (strips: number, weapon: string, customRules?: TrainingCustomRules) =>
      ipcRenderer.invoke('training:startSession', strips, weapon, customRules),
    stopSession: () => ipcRenderer.invoke('training:stopSession'),
    setTheme: (theme: string) => ipcRenderer.invoke('training:setTheme', theme),
    getHistory: () => ipcRenderer.invoke('training:getHistory'),
    getSession: () => ipcRenderer.invoke('training:getSession'),
    getArenas: () => ipcRenderer.invoke('training:getArenas'),
    getServerInfo: () => ipcRenderer.invoke('training:getServerInfo'),
    openDemoScreens: (strips: number) => ipcRenderer.invoke('training:openDemoScreens', strips),
  },

  // Remote event listeners (for real-time updates)
  onUpdateAvailable: (callback: (info: UpdateInfo) => void) =>
    subscribe('update:available', callback),
  onUpdateProgress: (callback: (data: UpdateProgressEvent) => void) =>
    subscribe('update:progress', callback),
  onRemoteArenaUpdate: (callback: (data: RemoteArenaUpdateEvent) => void) =>
    subscribe('arena:update', callback),
  onRemoteMatchFinished: (callback: (data: RemoteMatchFinishedEvent) => void) =>
    subscribe('match:finished', callback),
  onTrainingMatchFinished: (callback: Parameters<ElectronAPI['onTrainingMatchFinished']>[0]) =>
    subscribe('training:match_finished', callback),
  onCompetitionEvent: (
    callback: (event: { type: CompetitionEventType; competitionId?: string }) => void
  ) => subscribe('competition:event', callback),
  onRemoteFencerExcluded: (
    callback: (data: { fencerId: string; matchId: string; reason?: 'black_card' }) => void
  ) => subscribe('remote:fencer_excluded', callback),
  onRemoteFencerReinstated: (
    callback: (data: {
      fencerId: string;
      matchId: string;
      status: string;
      scoreA: number;
      scoreB: number;
    }) => void
  ) => subscribe('remote:fencer_reinstated', callback),
  onRemoteCheckinUpdated: (
    callback: (data: { kind: 'fencer' | 'referee'; id: string; present: boolean }) => void
  ) => subscribe('remote:checkin_updated', callback),
  onRemoteRefereeChanged: (callback: (data: { matchId: string; refereeId: string }) => void) =>
    subscribe('remote:referee_changed', callback),
  onKioskNoteUpdate: (callback: Parameters<ElectronAPI['onKioskNoteUpdate']>[0]) =>
    subscribe('kiosk:note', callback),
  onDTCall: (callback: (data: import('../shared/types/remote').DTCallEvent) => void) =>
    subscribe('remote:dt_call', callback),
  onDTCallCancel: (callback: (data: { arenaId: string }) => void) =>
    subscribe('remote:dt_cancel', callback),

  onScoreIpConflict: (callback: Parameters<ElectronAPI['onScoreIpConflict']>[0]) =>
    subscribe('score:ip-conflict', callback),

  onPoolSignatureUpdated: (
    callback: (data: { poolId: string; signedFencerIds: string[]; totalFencers: number }) => void
  ) => subscribe('pool:signature:updated', callback),

  onTableauSignatureUpdated: (callback: (data: { matchId: string; fencerId: string }) => void) =>
    subscribe('tableau:signature:updated', callback),

  getLogo: () => ipcRenderer.invoke('app:getLogo'),
  getLogos: () => ipcRenderer.invoke('app:getLogos'),
  saveLogos: (logos: { id: string; name: string; data: string }[]) =>
    ipcRenderer.invoke('app:saveLogos', logos),
  getTtsConfig: () => ipcRenderer.invoke('app:getTtsConfig'),
  onLogoLoaded: (callback: (logo: string | null) => void) => subscribe('app:logoLoaded', callback),

  // Bibliothèque de thèmes persistante
  themes: {
    list: () => ipcRenderer.invoke('themes:list'),
    save: (theme: unknown) => ipcRenderer.invoke('themes:save', theme),
    delete: (id: string) => ipcRenderer.invoke('themes:delete', id),
  },

  // Remove listeners
  removeAllListeners: (channel: string) => ipcRenderer.removeAllListeners(channel),

  // Notify main process of language change (to rebuild native menu)
  notifyLanguageChanged: (lang: string) => ipcRenderer.send('app:language-changed', lang),

  // Écran de démarrage (splash) affiché ou non
  splash: {
    getEnabled: () => ipcRenderer.invoke('app:getSplashEnabled'),
    setEnabled: (enabled: boolean) => {
      if (typeof enabled !== 'boolean') throw new Error('Enabled must be a boolean');
      return ipcRenderer.invoke('app:setSplashEnabled', enabled);
    },
  },

  // Cyrano scoring machine integration (#1720)
  cyrano: {
    start: (options?: { port?: number; host?: string; compe?: string }) =>
      ipcRenderer.invoke('cyrano:start', options),
    stop: () => ipcRenderer.invoke('cyrano:stop'),
    isRunning: () => ipcRenderer.invoke('cyrano:isRunning'),
    setPistes: (pistes: unknown[]) => ipcRenderer.invoke('cyrano:setPistes', pistes),
    getStatus: () => ipcRenderer.invoke('cyrano:getStatus'),
    getLog: () => ipcRenderer.invoke('cyrano:getLog'),
    setOptions: (options: unknown) => ipcRenderer.invoke('cyrano:setOptions', options),
    pisteAction: (piste: string, action: string) =>
      ipcRenderer.invoke('cyrano:pisteAction', piste, action),
    loadPistes: (competitionId: string) => ipcRenderer.invoke('cyrano:loadPistes', competitionId),
    savePistes: (competitionId: string, pistes: unknown[]) =>
      ipcRenderer.invoke('cyrano:savePistes', competitionId, pistes),
    getPistesScope: (competitionId: string) =>
      ipcRenderer.invoke('cyrano:getPistesScope', competitionId),
    getRoutes: () => ipcRenderer.invoke('cyrano:getRoutes'),
  },

  // Appareils de piste OPP2 : broker MQTT intégré (#1960)
  opp2: {
    start: (options?: { port?: number }) => ipcRenderer.invoke('opp2:start', options),
    stop: () => ipcRenderer.invoke('opp2:stop'),
    isRunning: () => ipcRenderer.invoke('opp2:isRunning'),
    setPistes: (pistes: unknown[]) => ipcRenderer.invoke('opp2:setPistes', pistes),
    getStatus: () => ipcRenderer.invoke('opp2:getStatus'),
  },

  // Language injected before renderer loads (avoids race with localStorage read)
  initialLanguage: (() => {
    const arg = process.argv.find(a => a.startsWith('--initial-lang='));
    return arg ? arg.slice('--initial-lang='.length) : null;
  })(),
} satisfies ElectronAPI;

contextBridge.exposeInMainWorld('electronAPI', electronApi);

// Type declarations for the renderer
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
