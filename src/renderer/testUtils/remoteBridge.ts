/**
 * Tests du serveur distant : simule le contrat d'API (docs/adr/0022) à partir de fonctions par
 * méthode de l'écran (`createRemoteApi`, src/renderer/api/remoteApi.ts, mêmes noms que l'ancien
 * groupe `remote` de window.electronAPI). Chaque opération du contrat reçoit son entrée nommée
 * et la rend en arguments positionnels à la méthode correspondante ; la méthode répond comme
 * l'ancien canal (`{ success, … }`) : un `success: false` devient un refus du contrat, que
 * l'écran rend sous la même enveloppe. Le contrat lui-même est couvert par
 * src/main/engine/commands/remote.test.ts.
 * Licensed under GPL-3.0
 */
import { ApiError, type ApiBridge } from '../../shared/api/client';
import type { ApiHandlers } from './apiBridge';
import { eventfulBridge } from './stationBridge';

/** Méthodes de l'écran simulées (vi.fn) : nom → fonction */
export type RemoteMocks = Record<string, unknown>;

type Input = Record<string, unknown>;

/** Opérations du contrat → méthode de l'écran, arguments positionnels, champ de la réponse */
const MAPPING: Record<string, [method: string, args: (i: Input) => unknown[], output?: string]> = {
  listNetworkInterfaces: ['getNetworkInterfaces', () => [], 'interfaces'],
  startRemoteServer: [
    'startServer',
    i => [i.competitionId, i.port, i.host, i.useHttps],
    'serverInfo',
  ],
  stopRemoteServer: ['stopServer', i => [i.competitionId]],
  reloadRemoteServer: [
    'reloadServer',
    ({ competitionId, ...options }) => [competitionId, options],
    'serverInfo',
  ],
  getRemoteServerInfo: ['getServerInfo', i => [i.competitionId], 'serverInfo'],
  getRemoteCertFingerprint: ['getCertFingerprint', () => [], 'fingerprint'],
  getRemoteFirewallDiagnosis: ['firewallCheck', i => [i.port]],
  startRemoteSession: [
    'startSession',
    i => [i.competitionId, i.strips, i.matches, i.showPhotos, i.kioskViews, i.cardAnnounce],
    'session',
  ],
  stopRemoteSession: ['stopSession', i => [i.competitionId]],
  launchRemoteCompetition: ['launchCompetition', i => [i.competitionId]],
  getRemoteSession: ['getSession', i => [i.competitionId], 'session'],
  listRemoteArenas: ['getArenas', i => [i.competitionId], 'arenas'],
  setRemoteStripCount: ['updateStripCount', i => [i.competitionId, i.count], 'session'],
  setRemoteShowPhotos: ['updateShowPhotos', i => [i.competitionId, i.value]],
  setRemoteCardAnnounce: ['updateCardAnnounce', i => [i.competitionId, i.value]],
  setActiveWave: ['setActiveWave', i => [i.competitionId, i.matchIds, i.poolsClosed]],
  moveMatchToArena: [
    'updateMatchArena',
    i => [i.competitionId, i.matchId, i.fromArena, i.toArena, i.fencerA, i.fencerB],
  ],
  setTeamArenaMatch: [
    'setTeamArenaMatch',
    i => [i.competitionId, i.arenaId, i.matchId, i.isLaserPoints],
  ],
  clearTeamArenaMatch: ['clearTeamArenaMatch', i => [i.competitionId, i.arenaId]],
  requestMatchSignature: ['requestMatchSignature', i => [i.competitionId, i.arenaId, i.request]],
  acknowledgeDtCall: ['acknowledgeDTCall', i => [i.competitionId, i.arenaId]],
  pushPoolFencersToStrips: ['updatePoolFencers', i => [i.competitionId, i.pools]],
  pushPoolMatchesToStrips: ['syncPoolMatches', i => [i.competitionId, i.pools]],
  pushPoolsToStrips: ['assignPools', i => [i.competitionId, i.pools]],
  pushTableauToStrips: ['refreshDeMatches', i => [i.competitionId, i.matches]],
  pushMatchFinishToStrips: [
    'finishPoolMatch',
    i => [i.competitionId, i.matchId, i.scoreA, i.scoreB, i.winner, i.specialStatus],
  ],
  pushMatchResetToStrips: ['resetPoolMatch', i => [i.competitionId, i.matchId]],
  setArenaPassword: ['setArenaPassword', i => [i.competitionId, i.arenaId, i.password]],
  configureRegistration: ['setRegistrationEnabled', i => [i.competitionId, i.enabled]],
  setRemoteTheme: ['updateTheme', i => [i.competitionId, i.theme]],
  setArenaTheme: ['updateArenaTheme', i => [i.competitionId, i.arenaId, i.theme, i.customTheme]],
  clearArenaThemeOverride: ['clearArenaThemeOverride', i => [i.competitionId, i.arenaId]],
  setArenaScreenTheme: [
    'updateArenaScreenTheme',
    i => [i.competitionId, i.arenaId, i.targetType, i.customTheme],
  ],
  setKioskViews: ['updateKioskViews', i => [i.competitionId, i.views]],
  setKioskTheme: ['updateKioskTheme', i => [i.competitionId, i.variables]],
  setRemoteWallpaper: ['setWallpaper', i => [i.competitionId, i.wallpaper]],
  setOrgNote: ['setOrgNote', i => [i.competitionId, i.note]],
  clearOrgNote: ['clearOrgNote', i => [i.competitionId]],
  setRemoteWebhook: ['setWebhookUrl', i => [i.url]],
  testRemoteWebhook: ['testWebhook', i => [i.url]],
  setRemoteLogo: ['updateLogo', i => [i.logo]],
  setTtsConfig: ['setTtsConfig', i => [i.config]],
  listRemoteClients: ['getConnectedClients', i => [i.competitionId], 'clients'],
  sendClientCommand: ['sendClientCommand', i => [i.competitionId, i.socketId, i.command]],
  broadcastClientCommand: ['broadcastCommand', i => [i.competitionId, i.command]],
  renameRemoteClient: ['renameClient', i => [i.competitionId, i.socketId, i.label]],
  identifyRemoteClient: ['identifyClient', i => [i.competitionId, i.socketId]],
  setClientKioskMode: ['setClientKioskMode', i => [i.competitionId, i.socketId, i.config]],
};

/** Une réponse `{ success: false, error }` de l'ancien canal devient un refus du contrat */
function refusalOf(res: { error?: string; port?: number }): ApiError {
  const error = res.error ?? '';
  if (error === 'remote_not_started' || error === 'server_not_started') {
    return new ApiError('remote_not_running', 'Saisie distante de l’épreuve non démarrée');
  }
  if (error === 'port_in_use') {
    return new ApiError('port_in_use', 'Port déjà utilisé', { port: res.port });
  }
  return new ApiError('remote_refused', error);
}

/** Gestionnaires du contrat pour `fakeApiBridge`, à partir des méthodes de l'écran simulées */
export function remoteHandlers(mocks: RemoteMocks): ApiHandlers {
  const handlers: ApiHandlers = {};
  for (const [op, [method, toArgs, output]] of Object.entries(MAPPING)) {
    handlers[op] = async input => {
      const fn = mocks[method] as ((...args: unknown[]) => unknown) | undefined;
      if (!fn) throw new Error(`Méthode du serveur distant non simulée : ${method}`);
      const res = (await fn(...toArgs(input))) as
        { success?: boolean; error?: string; port?: number; [k: string]: unknown } | undefined;
      // Méthode sans valeur de retour (vi.fn()) : succès
      if (!res || typeof res !== 'object') return undefined;
      if (res.success === false) throw refusalOf(res);
      if (op === 'testRemoteWebhook') return { status: res.status };
      return output ? res[output] : undefined;
    };
  }
  return handlers;
}

/**
 * `window.electronAPI` d'un test du serveur distant : pont du contrat. `extra` ajoute d'autres
 * opérations du contrat ou des groupes de l'API Electron.
 */
export function remoteElectron(
  mocks: RemoteMocks,
  extra: { api?: ApiHandlers; [group: string]: unknown } = {}
): { api: ApiBridge; emit: (name: string, event: unknown) => void; [group: string]: unknown } {
  const { api: extraApi, ...rest } = extra;
  const { api, emit } = eventfulBridge({ ...remoteHandlers(mocks), ...extraApi });
  return { ...rest, api, emit };
}
