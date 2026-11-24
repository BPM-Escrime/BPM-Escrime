/**
 * BPM - Escrime - Cycle de vie du serveur distant : démarrage, rechargement à chaud,
 * interfaces réseau (ex-canaux IPC remote:startServer, reloadServer… #1341, migrés vers le
 * contrat d'API par remotePort.ts, #1981 lot 2, docs/adr/0022). Aussi utilisé par le MCP (#1880).
 * Licensed under GPL-3.0
 */
import { app, type BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { DatabaseManager } from '../database';
import { RemoteScoreServer } from './remoteScoreServer';
import { ensureCert } from './certManager';
import { findAvailablePort, remoteServers, usedPorts } from './remoteRegistry';
import type { RemoteServerInfo } from '../shared/types/preload';
import { applyActiveWave } from './remote/activeWave';
import { pushStripPlan } from './remote/stripPlan';
import { setSharedMainWindow } from './mainWindowRef';
import { logger, LogCategory, toError } from '../shared/services/logger';

/** Paramètres réseau modifiables au rechargement (absents = valeur courante). */
export interface RemoteReloadOptions {
  port?: number;
  host?: string;
  useHttps?: boolean;
}

export interface RemoteLifecycleContext {
  db: DatabaseManager;
  getMainWindow(): BrowserWindow | null;
  /** Appelé après création d'un RemoteScoreServer pour brancher le PisteHub Cyrano (#1720). */
  onServerCreated?: (server: RemoteScoreServer) => void;
}

export type StartRemoteServerResult =
  | {
      success: true;
      serverInfo: {
        url: string;
        ip: string;
        port: number;
        useHttps: boolean;
        certFingerprint?: string;
      };
    }
  | { success: false; error: string };

/** Serveur distant d'une épreuve : écran (startRemoteServer du contrat, remotePort.ts) et MCP (#1880) */
export async function startRemoteServer(
  { db, getMainWindow, onServerCreated }: RemoteLifecycleContext,
  competitionId: string,
  port?: number,
  host?: string,
  useHttps?: boolean
): Promise<StartRemoteServerResult> {
  try {
    if (remoteServers.has(competitionId)) {
      return { success: false, error: 'remote_already_started' };
    }

    const effectivePort = findAvailablePort(port);
    const effectiveHost = host ?? '0.0.0.0';

    let tlsOptions: { cert: string; key: string } | undefined;
    let certFingerprint: string | undefined;
    if (useHttps) {
      try {
        const bundle = await ensureCert(app.getPath('userData'));
        tlsOptions = { cert: bundle.cert, key: bundle.key };
        certFingerprint = bundle.fingerprint;
      } catch (certError) {
        logger.error(LogCategory.NETWORK, 'Erreur génération certificat TLS:', toError(certError));
        return { success: false, error: 'tls_cert_failed' };
      }
    }

    const server = new RemoteScoreServer(db, effectivePort, effectiveHost, tlsOptions);
    try {
      await server.start();
    } catch (startError) {
      logger.error(LogCategory.NETWORK, 'Error binding remote server port:', toError(startError));
      return {
        success: false,
        error: (startError as { message?: string } | null)?.message ?? 'Port indisponible',
      };
    }
    applyActiveWave(competitionId, server);
    // Plan des pistes de l'épreuve, donnée du moteur (docs/adr/0015)
    pushStripPlan(db, competitionId, server);
    remoteServers.set(competitionId, {
      server,
      port: effectivePort,
      host: effectiveHost,
      useHttps: !!useHttps,
      certFingerprint,
    });
    usedPorts.add(effectivePort);
    onServerCreated?.(server);

    // Appliquer la config TTS persistée aux tablettes de ce nouveau serveur
    try {
      const ttsPath = path.join(app.getPath('userData'), 'tts-config.json');
      server.setTtsConfig(JSON.parse(await fs.promises.readFile(ttsPath, 'utf-8')));
    } catch {
      /* config TTS optionnelle */
    }
    setSharedMainWindow(getMainWindow());

    return {
      success: true,
      serverInfo: {
        url: server.getServerUrl(),
        ip: server.getLocalIPAddress(),
        port: effectivePort,
        useHttps: !!useHttps,
        certFingerprint,
      },
    };
  } catch (error) {
    logger.error(LogCategory.NETWORK, 'Error starting remote server:', toError(error));
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Erreur inconnue',
    };
  }
}

export interface RemoteNetworkInterface {
  name: string;
  address: string;
}

/** Interfaces d'écoute : toutes (0.0.0.0), puis les IPv4 non locales */
export function listNetworkInterfaces(): RemoteNetworkInterface[] {
  const ifaces = os.networkInterfaces();
  const result: RemoteNetworkInterface[] = [{ name: 'Toutes les interfaces', address: '0.0.0.0' }];
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const iface of addrs || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        result.push({ name: `${name} (${iface.address})`, address: iface.address });
      }
    }
  }
  return result;
}

export type ReloadRemoteServerResult =
  | { success: true; serverInfo: RemoteServerInfo }
  | { success: false; error: string; port?: number };

/** Rechargement à chaud : port / interface / HTTPS changés sans perdre la session ni les pistes */
export async function reloadRemoteServer(
  competitionId: string,
  options: RemoteReloadOptions = {}
): Promise<ReloadRemoteServerResult> {
  try {
    const entry = remoteServers.get(competitionId);
    if (!entry) return { success: false, error: 'remote_not_started' };

    const host = options.host ?? entry.host;
    const useHttps = options.useHttps ?? entry.useHttps;
    const requested = options.port ?? entry.port;
    if (!Number.isInteger(requested) || requested < 1 || requested > 65535) {
      return { success: false, error: 'port_invalid' };
    }
    // Le port courant reste libre pour ce serveur ; un port d'un autre serveur est refusé
    if (requested !== entry.port && usedPorts.has(requested)) {
      return { success: false, error: 'port_in_use', port: requested };
    }

    let tlsOptions: { cert: string; key: string } | undefined;
    let certFingerprint: string | undefined;
    if (useHttps) {
      try {
        const bundle = await ensureCert(app.getPath('userData'));
        tlsOptions = { cert: bundle.cert, key: bundle.key };
        certFingerprint = bundle.fingerprint;
      } catch (certError) {
        logger.error(LogCategory.NETWORK, 'Erreur génération certificat TLS:', toError(certError));
        return { success: false, error: 'tls_cert_failed' };
      }
    }

    try {
      await entry.server.restart(requested, host, tlsOptions);
    } catch (restartError) {
      logger.error(LogCategory.NETWORK, 'Error reloading remote server:', toError(restartError));
      // Ancienne écoute rétablie par restart()
      return {
        success: false,
        error:
          (restartError as NodeJS.ErrnoException)?.code === 'EADDRINUSE'
            ? 'port_in_use'
            : toError(restartError).message,
        port: requested,
      };
    }

    usedPorts.delete(entry.port);
    usedPorts.add(requested);
    Object.assign(entry, { port: requested, host, useHttps, certFingerprint });

    return {
      success: true,
      serverInfo: {
        url: entry.server.getServerUrl(),
        ip: entry.server.getLocalIPAddress(),
        port: requested,
        useHttps,
        certFingerprint,
      },
    };
  } catch (error) {
    logger.error(LogCategory.NETWORK, 'Error reloading remote server:', toError(error));
    return { success: false, error: error instanceof Error ? error.message : 'Erreur inconnue' };
  }
}

/** Adresse du serveur de l'épreuve ; undefined : non démarré */
export function remoteServerInfo(competitionId: string): RemoteServerInfo | undefined {
  const entry = remoteServers.get(competitionId);
  if (!entry) return undefined;
  return {
    url: entry.server.getServerUrl(),
    ip: entry.server.getLocalIPAddress(),
    port: entry.port,
    useHttps: entry.useHttps,
    certFingerprint: entry.certFingerprint,
  };
}

/** Empreinte du certificat TLS auto-signé du poste (généré au besoin) */
export async function remoteCertFingerprint(): Promise<string> {
  const bundle = await ensureCert(app.getPath('userData'));
  return bundle.fingerprint;
}
