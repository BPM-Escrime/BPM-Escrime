/**
 * BellePoule Modern - Port du serveur d'entraînement (#1981 lot 2, docs/adr/0022)
 * Branche sur le CommandContext ce que les opérations de l'entraînement ne peuvent pas faire
 * seules : registre des serveurs et ports (remoteRegistry), certificat TLS, synthèse vocale du
 * poste (<userData>/tts-config.json), fenêtre principale, écrans de démo. Remplace les canaux
 * `training:*` de l'ancien ipc/trainingHandlers.ts.
 * Licensed under GPL-3.0
 */
import * as fs from 'fs';
import * as path from 'path';
import type { BrowserWindow } from 'electron';
import type { DatabaseManager } from '../database';
import type { TrainingServerInfo } from '../shared/types/training';
import { CommandError, type TrainingPort } from './engine/commands/context';
import { ensureCert } from './certManager';
import { closeDemoScreens, openDemoScreens } from './demoScreens';
import { setSharedMainWindow } from './mainWindowRef';
import { applyTrainingTheme } from './remote/trainingTheme';
import { findAvailablePort, remoteServers, usedPorts } from './remoteRegistry';
import { RemoteScoreServer } from './remoteScoreServer';
import {
  bindTrainingToMainWindow,
  stopTrainingServer,
  TRAINING_ID,
  unbindTrainingFromMainWindow,
} from './trainingServer';

export interface TrainingPortOptions {
  db: DatabaseManager;
  getMainWindow(): BrowserWindow | null;
  userDataDir: () => string;
}

const entryInfo = (
  entry: NonNullable<ReturnType<typeof remoteServers.get>>
): TrainingServerInfo => ({
  url: entry.server.getServerUrl(),
  ip: entry.server.getLocalIPAddress(),
  port: entry.port,
  useHttps: entry.useHttps,
  certFingerprint: entry.certFingerprint,
});

export function createTrainingPort({
  db,
  getMainWindow,
  userDataDir,
}: TrainingPortOptions): TrainingPort {
  return {
    server: () => remoteServers.get(TRAINING_ID)?.server,
    info: () => {
      const entry = remoteServers.get(TRAINING_ID);
      return entry ? entryInfo(entry) : undefined;
    },
    start: async ({ port, host, useHttps }) => {
      if (remoteServers.has(TRAINING_ID)) {
        throw new CommandError('training_already_started', 'Serveur d’entraînement déjà démarré');
      }
      const effectivePort = findAvailablePort(port);
      const effectiveHost = host ?? '0.0.0.0';
      let tlsOptions: { cert: string; key: string } | undefined;
      let certFingerprint: string | undefined;
      if (useHttps) {
        try {
          const bundle = await ensureCert(userDataDir());
          tlsOptions = { cert: bundle.cert, key: bundle.key };
          certFingerprint = bundle.fingerprint;
        } catch {
          throw new CommandError('tls_cert_failed', 'Impossible de générer le certificat TLS');
        }
      }
      const server = new RemoteScoreServer(db, effectivePort, effectiveHost, tlsOptions);
      try {
        await server.start();
      } catch (startError) {
        throw new CommandError(
          'remote_refused',
          (startError as { message?: string } | null)?.message ?? 'Port indisponible'
        );
      }
      remoteServers.set(TRAINING_ID, {
        server,
        port: effectivePort,
        host: effectiveHost,
        useHttps: !!useHttps,
        certFingerprint,
      });
      usedPorts.add(effectivePort);
      try {
        const ttsPath = path.join(userDataDir(), 'tts-config.json');
        server.setTtsConfig(JSON.parse(await fs.promises.readFile(ttsPath, 'utf-8')));
      } catch {
        /* optionnel */
      }
      setSharedMainWindow(getMainWindow());
      bindTrainingToMainWindow(getMainWindow());
      return {
        url: server.getServerUrl(),
        ip: server.getLocalIPAddress(),
        port: effectivePort,
        useHttps: !!useHttps,
        certFingerprint,
      };
    },
    stop: () => {
      if (!stopTrainingServer()) return false;
      unbindTrainingFromMainWindow();
      return true;
    },
    applyTheme: theme => {
      const entry = remoteServers.get(TRAINING_ID);
      if (entry) applyTrainingTheme(entry.server, theme);
    },
    openDemoScreens: strips => {
      const entry = remoteServers.get(TRAINING_ID);
      if (!entry) return 0;
      // URL lue côté main : l'écran ne choisit pas l'adresse chargée
      const count = openDemoScreens(entry.server.getServerUrl(), strips);
      // Fermer la fenêtre principale ferme aussi les écrans (sinon l'app resterait ouverte)
      const main = getMainWindow();
      if (main && !main.listeners('closed').includes(closeDemoScreens)) {
        main.once('closed', closeDemoScreens);
      }
      return count;
    },
  };
}
