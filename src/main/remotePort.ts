/**
 * BPM - Escrime - Port du serveur distant (#1981 lot 2, docs/adr/0022)
 * Branche sur le CommandContext ce que les opérations du serveur distant ne peuvent pas faire
 * seules : registre des serveurs et ports (remoteRegistry), certificat TLS, pare-feu, logo et
 * synthèse vocale du poste (logo poussé aux serveurs, tts-config.json), webhook. Remplace les canaux
 * `remote:*` migrés (ipc/remoteServerHandlers, remoteSettingsHandlers, remoteClientsHandlers,
 * webhookHandlers…).
 * Licensed under GPL-3.0
 */
import * as fs from 'fs';
import * as path from 'path';
import { ApiError } from '../shared/api/client';
import { CommandError, type RemoteAdminPort } from './engine/commands/context';
import { remoteServers } from './remoteRegistry';
import {
  listNetworkInterfaces,
  reloadRemoteServer,
  remoteCertFingerprint,
  remoteServerInfo,
  startRemoteServer,
  type RemoteLifecycleContext,
} from './remoteLifecycle';
import { setActiveWave } from './remote/activeWave';
import { runFirewallCheck } from './remote/firewallCheck';
import { postWebhook } from './webhook';

export interface RemotePortOptions {
  lifecycle: RemoteLifecycleContext;
  userDataDir: () => string;
}

/** Refus du démarrage (codes historiques du lancement → catalogue du contrat) */
function startRefusal(error: string): CommandError {
  if (error === 'remote_already_started') {
    return new CommandError('remote_already_running', 'Saisie distante déjà démarrée');
  }
  if (error === 'tls_cert_failed') {
    return new CommandError('tls_cert_failed', 'Impossible de générer le certificat TLS');
  }
  return new CommandError('remote_refused', error);
}

/** Refus du rechargement */
function reloadRefusal(error: string, port?: number): Error {
  if (error === 'remote_not_started') {
    return new CommandError('remote_not_running', 'Saisie distante de l’épreuve non démarrée');
  }
  if (error === 'port_invalid') return new ApiError('invalid_input', 'Port invalide (1–65535)');
  if (error === 'port_in_use') {
    return new ApiError('port_in_use', `Le port ${port ?? ''} est déjà utilisé`, { port });
  }
  return startRefusal(error);
}

export function createRemoteAdminPort(opts: RemotePortOptions): RemoteAdminPort {
  const servers = () => [...remoteServers.values()].map(entry => entry.server);
  return {
    networkInterfaces: listNetworkInterfaces,
    start: async (competitionId, { port, host, useHttps }) => {
      const result = await startRemoteServer(opts.lifecycle, competitionId, port, host, useHttps);
      if (result.success) return result.serverInfo;
      throw startRefusal(result.error);
    },
    reload: async (competitionId, options) => {
      const result = await reloadRemoteServer(competitionId, options);
      if (result.success) return result.serverInfo;
      throw reloadRefusal(result.error, result.port);
    },
    info: remoteServerInfo,
    certFingerprint: remoteCertFingerprint,
    firewallCheck: async port => runFirewallCheck(port),
    server: competitionId => remoteServers.get(competitionId)?.server,
    servers,
    // Logo enregistré en base par setRemoteLogo (paramètre du poste `logo`, seule source)
    setLogo: async logo => {
      for (const server of servers()) server.setLogo(logo);
    },
    setTtsConfig: async config => {
      const ttsPath = path.join(opts.userDataDir(), 'tts-config.json');
      await fs.promises.writeFile(ttsPath, JSON.stringify(config), 'utf-8');
      for (const server of servers()) server.setTtsConfig(config);
    },
    setActiveWave: (competitionId, matchIds, poolsClosed) =>
      setActiveWave(competitionId, matchIds, poolsClosed),
    testWebhook: url =>
      postWebhook(url, { text: '✅ BPM - Escrime — test de notification webhook' }),
  };
}
