/**
 * BPM - Escrime - Données techniques du rapport de diagnostic (#1326), lues sur le poste
 * Rapport rendu en contenu par getDiagnosticReport (docs/adr/0021, 0022) ; ex-canal
 * `diagnostic:exportReport`. Liste blanche des champs : diagnosticReport.ts.
 * Licensed under GPL-3.0
 */
import * as os from 'os';
import { app } from 'electron';
import type { DiagnosticInput } from './diagnosticReport';
import { remoteServers } from './remoteRegistry';

export function collectDiagnosticInput(
  getVersionInfo: () => { version: string; build: number; channel?: string }
): DiagnosticInput {
  const info = getVersionInfo();
  return {
    appVersion: info.version,
    build: info.build,
    channel: info.channel ?? 'unknown',
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    locale: app.getLocale(),
    electronVersion: process.versions.electron ?? 'unknown',
    chromeVersion: process.versions.chrome ?? 'unknown',
    nodeVersion: process.versions.node,
    uptimeSeconds: Math.round(process.uptime()),
    memoryRssMb: Math.round(process.memoryUsage().rss / 1048576),
    activeRemoteServers: remoteServers.size,
    generatedAt: new Date(),
  };
}
