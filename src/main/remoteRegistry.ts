/**
 * BellePoule Modern - Registre des serveurs distants actifs (extrait de main.ts, #1155) :
 * un serveur par compétition (+ mode entraînement), ports réservés.
 * Licensed under GPL-3.0
 */
import type { RemoteScoreServer } from './remoteScoreServer';
import { getSharedMainWindow } from './mainWindowRef';
import { publishRemoteClients } from './engine/api/events';
import type { ConnectedClient } from '../shared/types/preload';

// Remote score servers — one per competition (key = competitionId)
export const remoteServers = new Map<
  string,
  {
    server: RemoteScoreServer;
    port: number;
    host: string;
    useHttps: boolean;
    certFingerprint?: string;
  }
>();
export const usedPorts = new Set<number>();
const BASE_REMOTE_PORT = 8066;

export function findAvailablePort(preferred?: number): number {
  if (preferred && !usedPorts.has(preferred)) return preferred;
  const start = preferred ? preferred + 1 : BASE_REMOTE_PORT;
  let port = start;
  while (usedPorts.has(port)) port++;
  return port;
}

export function stopRemoteServer(competitionId: string): boolean {
  const entry = remoteServers.get(competitionId);
  if (!entry) return false;
  entry.server.stop();
  usedPorts.delete(entry.port);
  remoteServers.delete(competitionId);
  return true;
}

/**
 * Publie la liste des clients (abonnement onRemoteClients), avec l'id de compétition du serveur
 * émetteur (#1292). Sans fenêtre principale, rien n'est émis, comme l'ancien envoi IPC.
 */
export function sendClientListToWindow(
  server: RemoteScoreServer,
  clients: ConnectedClient[]
): void {
  if (!getSharedMainWindow()) return;
  const owner = [...remoteServers].find(([, e]) => e.server === server)?.[0] ?? null;
  publishRemoteClients({ competitionId: owner, clients });
}
