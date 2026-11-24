/**
 * BPM - Escrime - Serveur distant : appels de l'écran au contrat d'API (#1981 lot 2,
 * docs/adr/0022). Un seul endroit traduit les appels de l'écran (arguments positionnels, mêmes
 * noms que l'ancien groupe `remote` de window.electronAPI) en opérations du contrat (entrées
 * nommées, shared/api/contractRemote.ts) et rend la réponse sous l'ancienne enveloppe
 * `{ success, error?, … }` : un refus du contrat (ApiError) devient `success: false` avec le code
 * traduit par `errors.<code>` (remote_not_running → remote_not_started…), ou le message pour
 * l'opérateur. Hors Electron, le client lève ApiError('unavailable'), rendu de même.
 * Les avis des tablettes (onRemoteActivity, onRemoteClients) gardent les formes de l'ancien
 * préload (onRemoteArenaUpdate, onRemoteMatchFinished…).
 * Licensed under GPL-3.0
 */
import { useMemo } from 'react';
import { ApiError, type BpmClient } from '../../shared/api/client';
import type {
  Arena,
  RemoteMatchPayload,
  CustomTheme,
  DisplayTheme,
  FirewallDiagnosis,
  MatchSignatureRequest,
  OrgNote,
  RemoteActivity,
  RemoteSession,
  ThemeTargetType,
} from '../../shared/types/remote';
import type {
  ConnectedClient,
  KioskScreenConfig,
  RemoteServerInfo,
  TtsConfig,
  TVCommand,
} from '../../shared/types/preload';
import type { Fencer } from '../../shared/types';
import { useBpmClient } from './BpmClientContext';
import { defaultBpmClient } from './IpcClient';

/** Réponse d'une opération du serveur distant : enveloppe historique des canaux remote:* */
export type RemoteResult<T extends object = object> = {
  success: boolean;
  /** Code traduisible (`errors.<code>`) ou message pour l'opérateur */
  error?: string;
  /** port_in_use : port refusé */
  port?: number;
} & Partial<T>;

/** Codes du catalogue rendus sous leur ancien nom, traduit par `errors.<code>` */
const LEGACY_CODES: Partial<Record<string, string>> = {
  remote_not_running: 'remote_not_started',
  remote_already_running: 'remote_already_started',
  tls_cert_failed: 'tls_cert_failed',
  port_in_use: 'port_in_use',
  strip_not_found: 'strip_not_found',
  match_not_found: 'match_not_found',
  invalid_url: 'invalid_url',
  // Serveur d'entraînement (trainingApi.ts)
  training_not_started: 'training_not_started',
  training_already_started: 'training_already_started',
  invalid_theme: 'invalid_theme',
};

/** Refus du contrat → `{ success: false, error }` */
function failure(e: unknown): RemoteResult {
  if (e instanceof ApiError) {
    const data = e.data as { port?: unknown } | undefined;
    return {
      success: false,
      error: LEGACY_CODES[e.code] ?? e.message,
      ...(typeof data?.port === 'number' ? { port: data.port } : {}),
    };
  }
  return { success: false, error: e instanceof Error ? e.message : String(e) };
}

/** Exécute l'appel ; `pick` range la réponse dans l'enveloppe (`{ serverInfo: … }`) */
export async function settle<T, R extends object = object>(
  call: () => Promise<T>,
  pick?: (value: T) => R
): Promise<RemoteResult<R>> {
  try {
    const value = await call();
    return { success: true, ...(pick ? pick(value) : {}) } as RemoteResult<R>;
  } catch (e) {
    return failure(e) as RemoteResult<R>;
  }
}

/** Y a-t-il un poste Electron à piloter ? (faux dans un navigateur, ou les tests sans pont) */
export const remoteAvailable = (): boolean =>
  typeof window !== 'undefined' && !!window.electronAPI?.api;

type NetworkOptions = { port?: number; host?: string; useHttps?: boolean };

export function createRemoteApi(client: BpmClient) {
  const q = client.query.bind(client);
  const c = client.call.bind(client);
  /** Abonnement ; hors Electron (pas de pont) : aucun avis, rien à désinscrire */
  const listen: BpmClient['subscribe'] = (name, input, cb) => {
    try {
      return client.subscribe(name, input, cb);
    } catch {
      return () => undefined;
    }
  };
  return {
    // ── Cycle de vie du serveur ──
    getNetworkInterfaces: () =>
      settle(
        () => q('listNetworkInterfaces', {}),
        interfaces => ({ interfaces })
      ),
    startServer: (competitionId: string, port?: number, host?: string, useHttps?: boolean) =>
      settle(
        () => c('startRemoteServer', { competitionId, port, host, useHttps }),
        serverInfo => ({ serverInfo })
      ),
    stopServer: (competitionId: string) => settle(() => c('stopRemoteServer', { competitionId })),
    reloadServer: (competitionId: string, options?: NetworkOptions) =>
      settle(
        () => c('reloadRemoteServer', { competitionId, ...options }),
        serverInfo => ({ serverInfo })
      ),
    getServerInfo: (competitionId: string) =>
      settle(
        () => q('getRemoteServerInfo', { competitionId }),
        serverInfo => ({ serverInfo })
      ),
    getCertFingerprint: () =>
      settle(
        () => q('getRemoteCertFingerprint', {}),
        fingerprint => ({ fingerprint })
      ),
    /** Diagnostic pare-feu : un échec de lecture est un constat « illisible », jamais un rejet */
    firewallCheck: async (port: number): Promise<FirewallDiagnosis> => {
      try {
        return await q('getRemoteFirewallDiagnosis', { port });
      } catch {
        return {
          supported: true,
          port: 0,
          networkCategories: [],
          findings: [{ level: 'error', code: 'unreadable' }],
        };
      }
    },

    // ── Session et pistes ──
    startSession: (
      competitionId: string,
      strips: number,
      matches?: object[],
      showPhotos?: boolean,
      kioskViews?: Record<string, boolean>,
      cardAnnounce?: boolean
    ) =>
      settle(
        () =>
          c('startRemoteSession', {
            competitionId,
            strips,
            matches: matches as RemoteMatchPayload[] | undefined,
            showPhotos,
            kioskViews,
            cardAnnounce,
          }),
        (session): { session: RemoteSession } => ({ session })
      ),
    stopSession: (competitionId: string) => settle(() => c('stopRemoteSession', { competitionId })),
    launchCompetition: (competitionId: string) =>
      settle(() => c('launchRemoteCompetition', { competitionId })),
    getSession: (competitionId: string) =>
      settle(
        () => q('getRemoteSession', { competitionId }),
        (session): { session?: RemoteSession } => (session ? { session } : {})
      ),
    getArenas: (competitionId: string) =>
      settle(
        () => q('listRemoteArenas', { competitionId }),
        (arenas): { arenas: Arena[] } => ({ arenas })
      ),
    updateStripCount: (competitionId: string, count: number) =>
      settle(
        () => c('setRemoteStripCount', { competitionId, count }),
        (session): { session?: RemoteSession } => (session ? { session } : {})
      ),
    updateShowPhotos: (competitionId: string, value: boolean) =>
      settle(() => c('setRemoteShowPhotos', { competitionId, value })),
    updateCardAnnounce: (competitionId: string, value: boolean) =>
      settle(() => c('setRemoteCardAnnounce', { competitionId, value })),
    /**
     * Tournoi des rapières : matchs de la vague active proposés aux tablettes (`null` : tous) ;
     * `poolsClosed` : vagues terminées, plus aucun match de poule proposé (#1118)
     */
    setActiveWave: (competitionId: string, matchIds: string[] | null, poolsClosed?: boolean) =>
      settle(() => c('setActiveWave', { competitionId, matchIds, poolsClosed })),
    updateMatchArena: (
      competitionId: string,
      matchId: string,
      fromArena: number | null,
      toArena: number | null,
      fencerA?: Fencer | null,
      fencerB?: Fencer | null
    ) =>
      settle(() =>
        c('moveMatchToArena', { competitionId, matchId, fromArena, toArena, fencerA, fencerB })
      ),
    setTeamArenaMatch: (
      competitionId: string,
      arenaId: string,
      matchId: string,
      isLaserPoints: boolean
    ) => settle(() => c('setTeamArenaMatch', { competitionId, arenaId, matchId, isLaserPoints })),
    clearTeamArenaMatch: (competitionId: string, arenaId: string) =>
      settle(() => c('clearTeamArenaMatch', { competitionId, arenaId })),
    requestMatchSignature: (
      competitionId: string,
      arenaId: string,
      request: MatchSignatureRequest
    ) => settle(() => c('requestMatchSignature', { competitionId, arenaId, request })),
    acknowledgeDTCall: (competitionId: string, arenaId: string) =>
      settle(() => c('acknowledgeDtCall', { competitionId, arenaId })),

    // ── Synchro d'affichage : l'écran pousse son état aux tablettes (aucun fait écrit) ──
    updatePoolFencers: (
      competitionId: string,
      updates: Array<{ poolId: string; fencers: Fencer[] }>
    ) => settle(() => c('pushPoolFencersToStrips', { competitionId, pools: updates })),
    syncPoolMatches: (
      competitionId: string,
      poolsData: Array<{ poolId: string; matches: object[] }>
    ) =>
      settle(() =>
        c('pushPoolMatchesToStrips', {
          competitionId,
          pools: poolsData as Array<{ poolId: string; matches: RemoteMatchPayload[] }>,
        })
      ),
    /** Réassigne les poules aux pistes pendant une session active (#1037) */
    assignPools: (
      competitionId: string,
      poolsData: Array<{
        poolId: string;
        poolNumber?: number;
        strip?: number | null;
        fencers?: Fencer[];
        matches: object[];
      }>
    ) =>
      settle(() =>
        c('pushPoolsToStrips', {
          competitionId,
          pools: poolsData as Array<
            Omit<(typeof poolsData)[number], 'matches'> & { matches: RemoteMatchPayload[] }
          >,
        })
      ),
    refreshDeMatches: (competitionId: string, matches: object[]) =>
      settle(() =>
        c('pushTableauToStrips', { competitionId, matches: matches as RemoteMatchPayload[] })
      ),
    finishPoolMatch: (
      competitionId: string,
      matchId: string,
      scoreA: number,
      scoreB: number,
      winner?: 'A' | 'B',
      specialStatus?: 'abandon' | 'forfait' | 'exclusion'
    ) =>
      settle(() =>
        c('pushMatchFinishToStrips', {
          competitionId,
          matchId,
          scoreA,
          scoreB,
          winner,
          specialStatus,
        })
      ),
    resetPoolMatch: (competitionId: string, matchId: string) =>
      settle(() => c('pushMatchResetToStrips', { competitionId, matchId })),

    // ── Mots de passe, inscription, pointage, espace formateurs ──
    setArenaPassword: (competitionId: string, arenaId: string, password: string) =>
      settle(() => c('setArenaPassword', { competitionId, arenaId, password })),
    setRegistrationEnabled: (competitionId: string, enabled: boolean) =>
      settle(() => c('configureRegistration', { competitionId, enabled })),
    setCheckinEnabled: (competitionId: string, enabled: boolean) =>
      settle(() => c('configureCheckin', { competitionId, enabled })),
    setCheckinPassword: (competitionId: string, password: string) =>
      settle(() => c('configureCheckin', { competitionId, password })),
    setTrainerEnabled: (competitionId: string, enabled: boolean) =>
      settle(() => c('configureTrainerSpace', { competitionId, enabled })),
    setTrainerPassword: (competitionId: string, password: string) =>
      settle(() => c('configureTrainerSpace', { competitionId, password })),

    // ── Thèmes et affichages ──
    updateTheme: (competitionId: string, theme: DisplayTheme) =>
      settle(() => c('setRemoteTheme', { competitionId, theme })),
    updateArenaTheme: (
      competitionId: string,
      arenaId: string,
      theme: DisplayTheme,
      customTheme?: CustomTheme
    ) => settle(() => c('setArenaTheme', { competitionId, arenaId, theme, customTheme })),
    clearArenaThemeOverride: (competitionId: string, arenaId: string) =>
      settle(() => c('clearArenaThemeOverride', { competitionId, arenaId })),
    updateArenaScreenTheme: (
      competitionId: string,
      arenaId: string,
      targetType: ThemeTargetType,
      customTheme?: CustomTheme
    ) =>
      settle(() => c('setArenaScreenTheme', { competitionId, arenaId, targetType, customTheme })),
    updateKioskViews: (competitionId: string, views: Record<string, boolean>) =>
      settle(() => c('setKioskViews', { competitionId, views })),
    updateKioskTheme: (competitionId: string, variables: Record<string, string>) =>
      settle(() => c('setKioskTheme', { competitionId, variables })),
    setWallpaper: (competitionId: string, wallpaper: string | null) =>
      settle(() => c('setRemoteWallpaper', { competitionId, wallpaper })),
    setOrgNote: (competitionId: string, note: OrgNote) =>
      settle(() => c('setOrgNote', { competitionId, note })),
    clearOrgNote: (competitionId: string) => settle(() => c('clearOrgNote', { competitionId })),

    // ── Réglages valables pour tous les serveurs du poste ──
    setWebhookUrl: (url: string | null) => settle(() => c('setRemoteWebhook', { url })),
    testWebhook: (url: string) =>
      settle(
        () => c('testRemoteWebhook', { url }),
        (res): { status?: number } => (res.status === undefined ? {} : { status: res.status })
      ),
    updateLogo: (logo: string | null) => settle(() => c('setRemoteLogo', { logo })),
    setTtsConfig: (config: TtsConfig) => settle(() => c('setTtsConfig', { config })),

    // ── Clients connectés (écrans, tablettes) ──
    getConnectedClients: async (competitionId: string) => {
      const res = await settle(
        () => q('listRemoteClients', { competitionId }),
        (clients): { clients: ConnectedClient[] } => ({ clients })
      );
      return { ...res, clients: res.clients ?? [] };
    },
    sendClientCommand: (competitionId: string, socketId: string, command: TVCommand) =>
      settle(() => c('sendClientCommand', { competitionId, socketId, command })),
    broadcastCommand: (competitionId: string, command: TVCommand) =>
      settle(() => c('broadcastClientCommand', { competitionId, command })),
    renameClient: (competitionId: string, socketId: string, label: string) =>
      settle(() => c('renameRemoteClient', { competitionId, socketId, label })),
    identifyClient: (competitionId: string, socketId: string) =>
      settle(() => c('identifyRemoteClient', { competitionId, socketId })),
    setClientKioskMode: (competitionId: string, socketId: string, config: KioskScreenConfig) =>
      settle(() => c('setClientKioskMode', { competitionId, socketId, config })),

    // ── Avis du serveur distant (onRemoteActivity, onRemoteClients) ──
    /** Avis d'un genre, de l'épreuve donnée (toutes si absente). Renvoie la désinscription. */
    onActivity: <K extends RemoteActivity['kind']>(
      kind: K,
      competitionId: string | undefined,
      callback: (event: Extract<RemoteActivity, { kind: K }>) => void
    ) =>
      listen('onRemoteActivity', { competitionId }, event => {
        if (event.kind === kind) callback(event as Extract<RemoteActivity, { kind: K }>);
      }),
    /** Liste des clients connectés modifiée (épreuve du serveur émetteur, null : inconnue) */
    onClientListUpdate: (
      callback: (clients: ConnectedClient[], competitionId: string | null) => void,
      competitionId?: string
    ) => listen('onRemoteClients', { competitionId }, e => callback(e.clients, e.competitionId)),
  };
}

export type RemoteApi = ReturnType<typeof createRemoteApi>;

/** API du serveur distant de l'écran, sur le client du contrat (stable tant que le client l'est) */
export function useRemoteApi(): RemoteApi {
  const client = useBpmClient();
  return useMemo(() => createRemoteApi(client), [client]);
}

/** API du serveur distant hors React (services de l'écran) : client par défaut */
export const remoteApi: RemoteApi = createRemoteApi(defaultBpmClient);
