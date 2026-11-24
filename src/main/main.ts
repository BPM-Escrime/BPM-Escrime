/**
 * BPM - Escrime - Electron Main Process
 * Licensed under GPL-3.0
 */

import { app, BrowserWindow, ipcMain, dialog, Notification, safeStorage } from 'electron';
import { loadOrCreateDatabaseKey } from './dbKey';
import * as path from 'path';
import * as fs from 'fs';
import { DatabaseManager } from '../database';
import { AutoUpdater } from './autoUpdater';
import { eventLoopMonitor } from './eventLoopMonitor';
import {
  fmt,
  getCyranoBadMatchLabels,
  getCyranoTeamOutLabels,
  getL,
  setUiLanguage,
} from './menuLabels';
import { emitCompetitionEvent } from './ipc/dbHandlers';
import { registerFileHandlers } from './ipc/fileHandlers';
import { registerWindowPrintHandlers, renderHtmlToPdfBuffer } from './ipc/windowPrintHandlers';
import { createMenuActions } from './menuActions';
import { createMenu } from './menu';
import { createMainWindow } from './mainWindow';
import { createSplashWindow, saveLanguageToFile, splashConfirmPromise } from './splash';
import { createTrainingPort } from './trainingPort';
import { dayStripServer } from './remote/stripHandover';
import { watchStripPlans } from './remote/stripPlan';
import { watchTeamArenas } from './remote/teamArenaSync';
import { createClubStation } from './clubPort';
import { createStationPort } from './stationPort';
import { applyStoredPrivacySettings, createPrivacyHandlers } from './ipc/privacyHandlers';
import { startRemoteServer } from './remoteLifecycle';
import { createRemoteAdminPort } from './remotePort';
import type { RemoteScoreServer } from './remoteScoreServer';
import { registerUpdaterHandlers } from './ipc/updaterHandlers';
import { collectDiagnosticInput } from './diagnosticInput';
import { importLegacyLogoFile } from './logoLibraryStore';
import { getVersionInfo } from './versionInfo';
import { readUpdaterSettings, resolveChannel } from './updaterSettings';
import { applyStoredProxySettings, createProxyService } from './proxySession';
import {
  competitionBackupDir,
  importLegacyCompetitionBackupDirs,
  resolveBackupDir,
} from './backupSettings';
import { runBackupAutosave } from './autosaveBackup';
import { remoteServers, stopRemoteServer } from './remoteRegistry';
import { remoteArenaCount } from './engine/commands/settings';
import { logger, LogCategory, toError } from '../shared/services/logger';
import { handleAllWindowsClosed, shutdownDb } from './appLifecycle';
import { CyranoServer } from './cyrano/server';
import { CyranoPisteDriver } from './cyrano/driver';
import { MqttBroker } from './opp2/mqttBroker';
import { Opp2PisteDriver } from './opp2/driver';
import { opp2ClientMayPublish } from './opp2/codec';
import { MultiPisteDriver } from './piste/multiDriver';
import { PisteHub } from './piste/pisteHub';
import { createDevicesPort, manualStripsOf } from './devicesPort';
import { StripControl } from './piste/stripControl';
import { publishStripControlChange } from './engine/api/events';
import { TRAINING_ID } from './trainingServer';
import { registerApiHandlers } from './engine/api/ipcAdapter';
import { emitChangeVia } from './mcp/mcpDomain';
import { createMcpController } from './mcp/mcpController';
import { parseCliArgs } from './cliArgs';
import { runBatchImport } from './batchImport';
import type { McpWriteDeps } from './mcp/mcpWriteTools';
import { setInkSavingProvider } from './printInk';

// --headless : process main sans fenêtre (#1880)
const cli = parseCliArgs(process.argv, process.env);
// --batch-import : journal sur la sortie d'erreur, la sortie standard ne porte que le rapport JSON
if (cli.batchImport || cli.mcpPrintConfig) {
  for (const level of ['log', 'info', 'debug', 'warn'] as const) console[level] = console.error;
}

// Database instance
const db = new DatabaseManager();
// Économie d'encre : réglage du poste lu à chaque impression / PDF (Paramètres → Documents)
setInkSavingProvider(() => db.settings.getSetting('inkSaving'));

// Auto updater
let autoUpdater: AutoUpdater | null = null;

// Main window reference
let mainWindow: BrowserWindow | null = null;
// Base ouverte : db:ready renvoyé à chaque chargement de page (préload whenDbReady, ADR-0030)
let dbReady = false;

// ============================================================================
// IPC Handlers - Database Operations
// ============================================================================

const createWindow = (initialLang?: string): void =>
  createMainWindow({
    initialLang,
    setMainWindow: win => {
      mainWindow = win;
      // Page (re)chargée après l'ouverture de la base (rechargement, fenêtre rouverte sous macOS)
      const contents = win?.webContents;
      contents?.on('did-finish-load', () => {
        if (dbReady) contents.send('db:ready');
      });
    },
    buildMenu: lang => buildMenu(lang),
  });

// RGPD (#1882) : archive .bpm chiffrée choisie par Fichier → Ouvrir, ouverte par le contrat
const privacyHandlers = createPrivacyHandlers({ getMainWindow: () => mainWindow });
const menuActions = createMenuActions({
  db,
  getMainWindow: () => mainWindow,
  onEncryptedBpm: privacyHandlers.requestEncryptedOpen,
  // Dossier de sauvegarde par défaut (Paramètres → Sauvegarde)
  getBackupDir: () => resolveBackupDir(app.getPath('userData'), app.getPath('documents')).dir,
  // Dossier propre de l'épreuve sur ce poste (docs/adr/0030)
  getCompetitionBackupDir: id => competitionBackupDir(app.getPath('userData'), id),
});
const { setCurrentCompetitionId } = menuActions;
const buildMenu = (language?: string): void =>
  createMenu(
    {
      db,
      getMainWindow: () => mainWindow,
      getAutoUpdater: () => autoUpdater,
      actions: menuActions,
    },
    language
  );

// Mode Club : tablettes, synchro, sauvegardes du poste (port du contrat, docs/adr/0022)
const clubStation = createClubStation({ db, userDataPath: app.getPath('userData') });
// Dossiers accessibles à l'agent tant que l'opérateur n'en a pas choisi (Paramètres → Agent IA)
const defaultAgentFolders = (['documents', 'downloads', 'desktop'] as const).flatMap(name => {
  try {
    return [app.getPath(name)];
  } catch {
    return [];
  }
});
// Poste : thèmes, RGPD, serveur MCP, pistes de la journée (port du contrat, docs/adr/0022)
const stationServices = createStationPort({
  db,
  userDataDir: () => app.getPath('userData'),
  documentsDir: () => app.getPath('documents'),
  defaultAgentFolders,
  mcp: () => mcp,
  proxy: createProxyService(() => app.getPath('userData')),
  diagnostics: () => collectDiagnosticInput(getVersionInfo),
  // Compétition ouverte ou servie aux tablettes : anonymisation / effacement refusés (#1882)
  isCompetitionBusy: id => id === menuActions.getCurrentCompetitionId() || remoteServers.has(id),
  getServer: id => {
    const server = remoteServers.get(id)?.server;
    // Pistes indisponibles de l'épreuve lues en base (docs/adr/0015, #1878)
    return server
      ? dayStripServer(server, () => db.stripPlans.getStripPlan(id).unavailable)
      : undefined;
  },
});
// Plan des pistes (docs/adr/0015) : envoyé au serveur distant de l'épreuve à chaque changement
watchStripPlans(db, id => remoteServers.get(id)?.server);
// Arènes équipe : rafraîchies après toute commande d'équipe, d'où qu'elle vienne (#2267)
watchTeamArenas(id => remoteServers.get(id)?.server.teamArenaCtx);
// Contrat d'API unique (#1981) : api:invoke / api:subscribe
registerApiHandlers({
  db,
  actor: { source: 'screen' },
  emitChange: emitChangeVia((type, competitionId) => emitCompetitionEvent(type, competitionId)),
  // Épreuve supprimée ou réglages changés : tablettes de la saisie distante (docs/adr/0018)
  remote: {
    stop: id => void stopRemoteServer(id),
    settingsChanged: (id, patch) => {
      // Pistes passées en manuel par l'épreuve (docs/adr/0023) : modes des appareils renvoyés
      if (patch.manualStrips !== undefined) pisteHub.refreshManualStrips();
      const server = remoteServers.get(id)?.server;
      if (!server) return;
      if (patch.blackCardEnabled !== undefined) {
        server.updateBlackCardEnabled(patch.blackCardEnabled === true);
      }
      server.refreshCompetitionSettings();
    },
    // Espace Vue DT du serveur de l'épreuve (docs/adr/0020)
    dtView: id => remoteServers.get(id)?.server.dtView,
    // Pilotage du serveur par l'écran : démarrage, session, réglages (docs/adr/0022)
    admin: createRemoteAdminPort({
      lifecycle: {
        db,
        getMainWindow: () => mainWindow,
        // remoteServerContext est défini plus bas (PisteHub) : lu à l'appel
        onServerCreated: server => remoteServerContext.onServerCreated?.(server),
      },
      userDataDir: () => app.getPath('userData'),
    }),
  },
  club: clubStation.port,
  station: stationServices.port,
  // Serveur d'entraînement : démo autonome, tablettes du Mode Club (docs/adr/0022)
  training: createTrainingPort({
    db,
    getMainWindow: () => mainWindow,
    userDataDir: () => app.getPath('userData'),
  }),
  // Appareils de piste (Cyrano, OPP2), déclarés sur la salle (docs/adr/0023) : défini plus bas
  get devices() {
    return devicesPort;
  },
});
registerFileHandlers({ db, getMainWindow: () => mainWindow });

ipcMain.on('app:current-competition', (_, competitionId: unknown) => {
  setCurrentCompetitionId(typeof competitionId === 'string' ? competitionId : null);
});

registerWindowPrintHandlers({ getMainWindow: () => mainWindow });

// Cyrano scoring machine integration (#1720)
const cyranoServer = new CyranoServer();
// Appareils OPP2 (JSON sur MQTT) : broker intégré, démarré à la demande (#1960)
// Rôle dans le sujet (spéc. § 30.3) : seul BPM - Escrime publie `software/*`
const opp2Broker = new MqttBroker({ authorizePublish: (_, topic) => opp2ClientMayPublish(topic) });
const opp2Driver = new Opp2PisteDriver(opp2Broker, {
  software: { name: 'BPM - Escrime', version: app.getVersion() },
});
// Pilotes Cyrano (#1829) et OPP2 (#1960) du modèle commun des appareils de piste
const pisteDriver = new MultiPisteDriver([new CyranoPisteDriver(cyranoServer), opp2Driver]);
const pisteHub = new PisteHub(
  pisteDriver,
  // Toutes les épreuves : chaque piste suit celle de son affectation en cours (#1878)
  () => [...remoteServers.values()].map(entry => entry.server),
  {
    // Numéros de poule / de match du DISP lus en base
    coordsSource: db,
    // Pistes passées en manuel par chaque épreuve (docs/adr/0023)
    manualStrips: id => manualStripsOf(db, id),
    // BAD MATCH : notification native au DT (#1829), un clic ramène la fenêtre au premier plan
    onAlert: (piste, alert) => {
      if (!Notification.isSupported()) return;
      const labels = getCyranoBadMatchLabels();
      const arena = alert.arena.replace(/^arena/, '');
      const notification = new Notification({
        title: labels.title,
        body: fmt(labels.body, { piste, arena }),
      });
      notification.on('click', () => {
        mainWindow?.show();
        mainWindow?.focus();
      });
      notification.show();
    },
    // Relais par équipes : abandon ou exclusion annoncé par l'appareil (relais acquitté)
    onNotice: (piste, notice) => {
      if (!Notification.isSupported()) return;
      const labels = getCyranoTeamOutLabels();
      const notification = new Notification({
        title: labels.title,
        body: fmt(labels[notice.reason], { piste, relay: notice.relay, fencer: notice.fencer }),
      });
      notification.on('click', () => {
        mainWindow?.show();
        mainWindow?.focus();
      });
      notification.show();
    },
  }
);

const remoteServerContext = {
  db,
  getMainWindow: () => mainWindow,
  onServerCreated: (server: RemoteScoreServer) => {
    server.cyranoHook = (arenaId, update) => pisteHub.onArenaUpdate(arenaId, update, server);
    // Relais par équipes (/equipe{N}) sur l'appareil de piste (#1829)
    server.cyranoTeamHook = arenaId => pisteHub.onTeamArenaUpdate(arenaId, server);
    // Nouvelle épreuve suivie : appareils de sa salle chargés dans les pilotes (docs/adr/0023)
    devicesPort.reload();
  },
};
// Pilotage de la salle hors compétition (#2117) : affichage libre et accusé, sans journal
const stripControl = new StripControl({
  driver: pisteDriver,
  hold: piste => pisteHub.holdPanel(piste),
  onChange: publishStripControlChange,
});
// Pilotes Cyrano et OPP2 vus par le contrat (ex-canaux cyrano:* et opp2:*, docs/adr/0023)
const devicesPort = createDevicesPort({
  db,
  cyranoServer,
  broker: opp2Broker,
  opp2Driver,
  pisteHub,
  activeCompetitions: () => [...remoteServers.keys()].filter(id => id !== TRAINING_ID),
  stripControl,
  activeArenas: () =>
    [...remoteServers.entries()]
      .filter(([id]) => id !== TRAINING_ID)
      .map(([competitionId, entry]) => ({
        competitionId,
        arenas: entry.server
          .getAllArenas()
          .map(a => Number(String(a.id).replace(/^arena/, '')))
          .filter(n => Number.isInteger(n) && n > 0),
      })),
});

// Dépendances des outils MCP (#1880) : base, écran à rafraîchir, serveur distant, Cyrano, fichiers
const mcpDeps: McpWriteDeps = {
  db,
  // Écritures de l'agent : écran rafraîchi (#1880, lots 2 et 3)
  notify: (type, competitionId) => emitCompetitionEvent(type, competitionId),
  remoteServers: () => [...remoteServers.entries()],
  cyranoStatus: () => {
    const alerts = pisteHub.getAlerts();
    return {
      running: cyranoServer.running,
      port: cyranoServer.port,
      pistes: cyranoServer.getStatuses().map(p => ({ ...p, alert: alerts[p.piste] ?? null })),
    };
  },
  allowedRoots: () => {
    const folders = db.settings.getSetting('agentFolders');
    return folders.length > 0 ? folders : defaultAgentFolders;
  },
  // HTTPS et interface : paramètres du poste (app_settings), comme l'écran
  startRemote: async (competitionId, port) => {
    const { remoteInterface, remoteHttps } = db.settings.getSettings();
    const result = await startRemoteServer(
      remoteServerContext,
      competitionId,
      port,
      remoteInterface,
      remoteHttps
    );
    // Sans écran, aucune fenêtre ne règle les arènes : même règle que l'écran (#1880)
    if (result.success) {
      remoteServers
        .get(competitionId)
        ?.server.setArenaCount(remoteArenaCount({ db }, competitionId));
    }
    return result;
  },
  stopRemote: competitionId => stopRemoteServer(competitionId),
  renderPdf: html => renderHtmlToPdfBuffer(html),
};

// Serveur MCP intégré, désactivé par défaut (#1880) : 127.0.0.1 + jeton
const mcp = createMcpController({
  deps: mcpDeps,
  userDataDir: () => app.getPath('userData'),
  secretBox: safeStorage,
  version: app.getVersion(),
  // --mcp, --mcp-port, --mcp-write : utilisable sans écran, réglages enregistrés inchangés
  override: { enabled: cli.mcp, port: cli.mcpPort, allowWrite: cli.mcpWrite },
});
/** Démarrage du MCP à l'ouverture de la base (un seul démarrage, attendu en --headless) */
let mcpReady: ReturnType<typeof mcp.apply> | null = null;

registerUpdaterHandlers({ getAutoUpdater: () => autoUpdater });

// App info handlers
ipcMain.handle('app:getVersionInfo', async () => {
  return getVersionInfo();
});

// Language change handler — rebuild native menu in the new language
ipcMain.on('app:language-changed', (_, lang: string) => {
  setUiLanguage(lang);
  saveLanguageToFile(lang);
  buildMenu(lang);
  for (const { server } of remoteServers.values()) {
    server.setLanguage(lang);
  }
});

// ============================================================================
// App Lifecycle
// ============================================================================

// Lit tous les chunks JS/CSS du renderer en arrière-plan pour les mettre dans
// le cache OS (page cache). Quand Chromium les charge ensuite via loadFile(),
// ils sont déjà en RAM → pas d'accès disque sur le chemin critique.
function prewarmRendererChunks(): void {
  if (process.env.NODE_ENV === 'development') return;
  const rendererDist = path.join(__dirname, '..', 'renderer');
  fs.readdir(rendererDist, (_err, files) => {
    if (!files) return;
    for (const f of files) {
      if (f.endsWith('.js') || f.endsWith('.css')) {
        fs.readFile(path.join(rendererDist, f), () => {});
      }
    }
  });
}

// Rendu logiciel pour VMware/ARM sans GPU — activer via BPM_ESCRIME_SW_RENDER=1
if (process.platform === 'linux' && process.env.BPM_ESCRIME_SW_RENDER === '1') {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('use-gl', 'swiftshader');
}

async function openDatabase(): Promise<void> {
  // Initialize database dans un répertoire inscriptible (userData)
  // Sur Windows, process.cwd() peut pointer vers C:\Windows\System32 (non inscriptible)
  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'bellepoule.db');

  // Migration : si une BDD existe à l'ancien emplacement mais pas au nouveau, la copier
  const legacyDbPath = path.join(process.cwd(), 'bellepoule.db');
  if (legacyDbPath !== dbPath && fs.existsSync(legacyDbPath) && !fs.existsSync(dbPath)) {
    try {
      if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true });
      fs.copyFileSync(legacyDbPath, dbPath);
      logger.info(LogCategory.SYSTEM, `Migration BDD: ${legacyDbPath} -> ${dbPath}`);
    } catch (e) {
      logger.error(LogCategory.SYSTEM, 'Échec migration BDD:', toError(e));
    }
  }

  // RGPD (#1882) : base chiffrée au repos (SQLCipher), clé dans le trousseau système
  try {
    const dbKey = await loadOrCreateDatabaseKey(userDataPath, safeStorage, dbPath);
    if (!dbKey) {
      logger.warn(
        LogCategory.SYSTEM,
        'Trousseau système indisponible : base non chiffrée au repos'
      );
    }
    await db.open(dbPath, { encryptionKey: dbKey });
    logger.info(LogCategory.SYSTEM, dbKey ? 'Base chiffrée (SQLCipher)' : 'Base en clair');
  } catch (e) {
    // Base illisible (clé absente ou incorrecte) : on n'écrase rien, on arrête proprement
    logger.error(LogCategory.SYSTEM, 'Ouverture de la base impossible:', toError(e));
    dialog.showErrorBox('BPM - Escrime', e instanceof Error ? e.message : String(e));
    app.quit();
    return;
  }
  // MCP : démarré une fois la base ouverte, s'il est activé (#1880)
  mcpReady = mcp.apply();
  logger.info(LogCategory.SYSTEM, 'Base de données ouverte:', db.getPath());
  // Noms abrégés sur le réseau + purge automatique des données échues (RGPD, #1882)
  applyStoredPrivacySettings(db, userDataPath);
  // Logo actif : ancien fichier logo.dat repris en base, seule source (docs/adr/0022)
  importLegacyLogoFile(db, userDataPath);
  importLegacyBackupDirs(userDataPath);
}

/**
 * Dossiers propres des épreuves : anciens `settings.backupDir` repris une fois dans le réglage
 * du poste (docs/adr/0030) ; dossier absent ignoré et tracé. La clé reste dans l'épreuve, ignorée.
 */
function importLegacyBackupDirs(userDataPath: string): void {
  try {
    const report = importLegacyCompetitionBackupDirs(userDataPath, db.getAllCompetitions());
    if (!report) return;
    if (report.imported.length) {
      logger.info(LogCategory.SYSTEM, `Dossiers de sauvegarde repris : ${report.imported.length}`);
    }
    for (const { competitionId, dir } of report.ignored) {
      logger.warn(
        LogCategory.SYSTEM,
        `Dossier de sauvegarde de l'épreuve ${competitionId} ignoré (introuvable) : ${dir}`
      );
    }
  } catch (e) {
    logger.error(LogCategory.SYSTEM, 'Reprise des dossiers de sauvegarde impossible:', toError(e));
  }
}

// Autosave every 2 minutes
let autosaveInterval: NodeJS.Timeout | null = null;

let autosaveInFlight = false;

const startAutosave = () => {
  if (autosaveInterval) clearInterval(autosaveInterval);
  autosaveInterval = setInterval(
    async () => {
      if (autosaveInFlight) return; // éviter l'empilement si la sauvegarde précédente traîne
      autosaveInFlight = true;
      try {
        await db.saveAsync(); // async I/O — ne bloque pas le main thread
        await runBackupAutosave(db, app.getPath('userData'), app.getPath('documents'));
        logger.info(LogCategory.SYSTEM, 'Autosave completed at', new Date().toISOString());
        mainWindow?.webContents.send('autosave:completed');
      } catch (error) {
        logger.error(LogCategory.SYSTEM, 'Autosave failed:', toError(error));
        mainWindow?.webContents.send('autosave:failed');
      } finally {
        autosaveInFlight = false;
      }
    },
    2 * 60 * 1000
  ); // 2 minutes
};

app.whenReady().then(async () => {
  eventLoopMonitor.start();
  // Proxy réseau choisi dans les Paramètres, avant tout accès réseau
  await applyStoredProxySettings(app.getPath('userData'));

  if (cli.headless) {
    app.dock?.hide();
    await openDatabase();
    // Langue du poste lue en base (#1880) : libellés du main et des serveurs distants
    setUiLanguage(db.settings.getSetting('language'));
    if (cli.mcpPrintConfig) {
      // Configuration du client (URL, jeton) sur la sortie standard : à la demande de l'opérateur
      let exitCode = 0;
      try {
        if (cli.mcpNewToken) await mcp.regenerateToken();
        process.stdout.write(`${JSON.stringify(await mcp.clientConfig(), null, 2)}\n`);
      } catch (e) {
        process.stderr.write(`${toError(e).message}\n`);
        exitCode = 1;
      }
      shutdownDb(db);
      app.exit(exitCode);
      return;
    }
    if (cli.batchImport) {
      const result = await runBatchImport(mcpDeps, cli.batchImport, cli.dryRun);
      process.stdout.write(
        `${JSON.stringify(result.report ?? { error: result.error }, null, 2)}\n`
      );
      shutdownDb(db);
      app.exit(result.exitCode);
      return;
    }
    startAutosave();
    const status = await (mcpReady ?? mcp.apply());
    logger.info(
      LogCategory.SYSTEM,
      `[Headless] Prêt, sans fenêtre ; MCP ${status.running ? status.url : status.enabled ? `en échec (${status.error})` : 'désactivé'}`
    );
    return;
  }

  // Afficher le splash immédiatement pendant que tout le reste charge
  createSplashWindow();

  // Cache V8 bytecode désactivé : session.setCodeCachePath provoque un crash natif
  // (access violation dans electron.exe) au démarrage sous Windows avec Electron 44.

  prewarmRendererChunks();

  // Attendre que l'utilisateur confirme la langue dans le splash
  const confirmedLang = await splashConfirmPromise;

  // Créer la fenêtre principale avec la langue choisie
  createWindow(confirmedLang);

  await openDatabase();

  // Signaler au renderer que la DB est prête (page pas encore chargée : renvoyé au chargement)
  dbReady = true;
  mainWindow?.webContents.send('db:ready');

  // Initialize auto updater — dialog différé après affichage de la fenêtre
  if (mainWindow) {
    autoUpdater = new AutoUpdater(mainWindow, {
      // Pas de téléchargement sans validation de l'utilisateur (#1467)
      autoDownload: false,
      autoInstall: false,
      checkInterval: 12,
      // Canal figé au packaging (docs/VERSIONING.md) : un build dev suit les pré-releases
      // Choix utilisateur (Préférences), sinon canal figé au packaging (docs/VERSIONING.md)
      betaChannel:
        resolveChannel(readUpdaterSettings(app.getPath('userData')), getVersionInfo().channel) ===
        'dev',
      silent: false,
      installOnQuit: false,
    });

    const win = mainWindow;
    win.once('show', async () => {
      if (!autoUpdater) return;
      if (autoUpdater.hasPendingUpdate()) {
        const pendingInfo = autoUpdater.getPendingUpdateInfo();
        logger.info(
          LogCategory.SYSTEM,
          `[Main] Mise à jour en attente trouvée: v${pendingInfo?.version}`
        );
        const L = getL();
        const result = await dialog.showMessageBox(win, {
          type: 'info',
          title: L.updPendingTitle,
          message: fmt(L.updPendingMsg, { version: pendingInfo?.version }),
          detail: L.updInstallDetail,
          buttons: [L.updInstallNow, L.updLater],
          defaultId: 0,
          cancelId: 1,
        });
        if (result.response === 0) {
          await autoUpdater.checkAndInstallPendingUpdate();
        }
      }
    });
  }

  startAutosave();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Arrêt propre en --headless (Ctrl+C, service)
if (cli.headless) {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => app.quit());
}

app.on('window-all-closed', () => {
  // --headless : aucune fenêtre principale ; une fenêtre cachée (rendu PDF du MCP) qui se
  // ferme ne doit pas arrêter le process (#1880)
  if (cli.headless) return;
  // macOS : la base reste ouverte (l'app vit dans le Dock, cf. appLifecycle.ts)
  handleAllWindowsClosed(process.platform, db, () => app.quit());
});

app.on('before-quit', () => {
  void mcp.stop();
  clubStation.stop();
  stationServices.stop();
  shutdownDb(db); // no-op si déjà fermé
});

// Promesses rejetées non gérées : journaliser sans terminer le processus (#1007)
process.on('unhandledRejection', reason => {
  logger.error(LogCategory.SYSTEM, 'Unhandled Rejection:', toError(reason));
});

// Handle uncaught exceptions - save before crash
process.on('uncaughtException', error => {
  logger.error(LogCategory.SYSTEM, 'Uncaught Exception:', toError(error));
  try {
    db.saveSync();
  } catch (e) {
    logger.error(LogCategory.SYSTEM, 'Failed to save on crash:', toError(e));
  }
  // showMessageBox est asynchrone : showErrorBox bloquerait le processus principal
  // (serveur distant compris) jusqu'au clic de l'opérateur (#993).
  void dialog
    .showMessageBox({
      type: 'error',
      title: getL().errTitle,
      message: fmt(getL().unexpectedError, { error: error.message }),
    })
    .catch(() => undefined);
});
