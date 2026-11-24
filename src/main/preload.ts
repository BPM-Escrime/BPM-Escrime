/**
 * BPM - Escrime - Preload Script
 * Exposes safe APIs to the renderer process with type safety
 * Licensed under GPL-3.0
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import type {
  ElectronAPI,
  UpdateInfo,
  UpdateProgressEvent,
  ProxySettingsDTO,
} from '../shared/types/preload';

import { setPrintRequestHandler, type PrintRequestHandler } from './preloadApi/printHandler';
import { dbApi } from './preloadApi/dbApi';
import { fileApi } from './preloadApi/fileApi';
import { dialogApi } from './preloadApi/dialogApi';
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

  // RGPD (#1882) : Fichier → Ouvrir a choisi une archive chiffrée ; l'écran demande le mot de
  // passe et l'ouvre par le contrat (openCompetitionFile, ADR-0021). Le reste : contrat d'API.
  privacy: {
    onEncryptedBpmRequest: (callback: (fileName: string, content: string) => void) => {
      const handler = (_: IpcRendererEvent, fileName: string, content: string) =>
        callback(fileName, content);
      ipcRenderer.on('privacy:encrypted-bpm', handler);
      return () => ipcRenderer.removeListener('privacy:encrypted-bpm', handler);
    },
  },

  // Proxy réseau (Paramètres → Réseau)
  backup: {
    chooseDir: () => ipcRenderer.invoke('backup:chooseDir'),
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

  // Dossier de l'agent choisi par dialogue natif (#1880) ; les autres réglages du poste, salles,
  // journée et agent passent par le contrat d'API (docs/adr/0022)
  settings: {
    addAgentFolder: () => ipcRenderer.invoke('settings:addAgentFolder'),
  },
  // Remote event listeners (for real-time updates)
  onUpdateAvailable: (callback: (info: UpdateInfo) => void) =>
    subscribe('update:available', callback),
  onUpdateProgress: (callback: (data: UpdateProgressEvent) => void) =>
    subscribe('update:progress', callback),
  getLogo: () => ipcRenderer.invoke('app:getLogo'),
  getLogos: () => ipcRenderer.invoke('app:getLogos'),
  saveLogos: (logos: { id: string; name: string; data: string }[]) =>
    ipcRenderer.invoke('app:saveLogos', logos),
  getTtsConfig: () => ipcRenderer.invoke('app:getTtsConfig'),

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
