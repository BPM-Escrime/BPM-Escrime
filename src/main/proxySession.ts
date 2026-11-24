/**
 * BPM - Escrime - Proxy réseau appliqué à la session Electron (Paramètres → Réseau)
 * Réglage lu et écrit par les opérations du poste getProxySettings, updateProxySettings et
 * testProxy (port `ctx.station.proxy`, docs/adr/0022) ; ex-canaux `proxy:*`.
 * L'adresse ne porte jamais d'identifiants (refusés par normalizeProxyServer).
 * Licensed under GPL-3.0
 */
import { session } from 'electron';
import {
  readProxySettings,
  sanitizeProxySettings,
  toElectronProxyConfig,
  writeProxySettings,
  type ProxySettings,
} from './proxySettings';
import { getJson } from './updateHttp';
import type { StationPort } from './engine/commands/context';
import { logger, LogCategory, toError } from '../shared/services/logger';

const TEST_URL = 'https://api.github.com/repos/BPM-Escrime/BPM-Escrime';

/** Applique le proxy à la session par défaut et coupe les connexions ouvertes. */
export async function applyProxySettings(settings: ProxySettings): Promise<void> {
  const ses = session.defaultSession;
  await ses.setProxy(toElectronProxyConfig(settings));
  await ses.closeAllConnections();
  logger.info(
    LogCategory.SYSTEM,
    `[Proxy] ${settings.mode}${settings.server ? ` ${settings.server}` : ''}`
  );
}

/** Au démarrage (après app.whenReady), avant le premier accès réseau. */
export async function applyStoredProxySettings(userDataDir: string): Promise<void> {
  try {
    await applyProxySettings(readProxySettings(userDataDir));
  } catch (e) {
    logger.error(LogCategory.SYSTEM, '[Proxy] application impossible', toError(e));
  }
}

/** Proxy du port du poste : lecture, application puis enregistrement, essai sur GitHub */
export function createProxyService(userDataDir: () => string): StationPort['proxy'] {
  return {
    settings: () => readProxySettings(userDataDir()),
    update: async input => {
      const settings = sanitizeProxySettings(input);
      if (!settings) return null;
      await applyProxySettings(settings);
      writeProxySettings(userDataDir(), settings);
      return settings;
    },
    test: async () => {
      const resolved = await session.defaultSession.resolveProxy(TEST_URL);
      const ok = (await getJson(TEST_URL, 8000)) !== null;
      return { ok, resolved };
    },
  };
}
