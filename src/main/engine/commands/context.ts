/**
 * BPM - Escrime - Couche domaine (#1880) : logique métier du process main partagée
 * par le serveur MCP, le mode --headless et, à terme, les handlers IPC de l'écran.
 * Licensed under GPL-3.0
 */
import type { DatabaseManager } from '../../../database';
import type { EventAuthor } from '../../../database/repos/eventLogRepo';
import type { CompetitionSettings } from '../../../shared/types';
import type { ApiErrorCode } from '../../../shared/api/errors';
import type {
  ClubBackupEntry,
  ClubBout,
  ClubMember,
  ClubSyncStatus,
} from '../../../shared/types/club';
import type { DayStripBoard } from '../../../shared/types/eventDay';
import type { McpLogEntry, McpStatus } from '../../../shared/types/mcp';
import type { BackupDirDTO, ProxySettingsDTO } from '../../../shared/types/systemSettings';
import type { LogoLibraryEntry } from '../../../shared/types/appSettings';
import type { DiagnosticInput } from '../../diagnosticReport';
import type { PlaceSuggestion } from '../../../shared/domain/places/placeSearch';
import type { GregFormFields } from '../../../shared/utils/gregPublication';
import type { PrivacySettings } from '../../../shared/types/privacy';
import type { CustomTheme, FirewallDiagnosis } from '../../../shared/types/remote';
import type { RemoteServerInfo, TtsConfig } from '../../../shared/types/preload';
import type { TrainingServerInfo } from '../../../shared/types/training';
import type { TrainingTheme } from '../../../shared/utils/trainingThemes';
import type {
  CyranoFrameLog,
  CyranoHelloMode,
  CyranoStatus,
  Opp2Status,
  EffectiveStripDevice,
  StripDeviceAction,
  StripDeviceAlert,
  StripDeviceLink,
  StripDeviceOptions,
  StripLastSend,
  StripPanel,
} from '../../../shared/types/stripDevice';
import type { RemoteScoreServer } from '../../remoteScoreServer';
import type { StripControlTarget } from '../../piste/stripControl';

/** Écriture faite hors de l'écran : l'écran ouvert recharge les données concernées */
export interface DomainChange {
  /**
   * Nature : épreuves (liste, réglages), tireurs, arbitres, réglages du poste, état de session,
   * plan des pistes (docs/adr/0015)
   */
  scope: 'competitions' | 'fencers' | 'referees' | 'settings' | 'session' | 'strips';
  /** Épreuves touchées (vide = liste entière) */
  competitionIds: string[];
}

export interface CommandContext {
  db: DatabaseManager;
  /** Notifie l'écran d'une écriture hors écran (bus competition:event) */
  emitChange?: (change: DomainChange) => void;
  /**
   * Dossiers où l'agent (MCP) peut écrire des fichiers ; absent = aucune restriction
   * (tests, opérateur en ligne de commande).
   */
  allowedRoots?: () => string[];
  /** Auteur et source des écritures, inscrits au journal de l'épreuve (#1980) ; défaut : moteur */
  actor?: EventAuthor;
  /** Commande en cours (runCommand) : commune à ses événements du journal (ADR-0007) */
  commandId?: string;
  /**
   * Détails du journal des scores (score_audit_log) connus de l'appelant : arbitre, adresse
   * de la tablette (détection de conflit), motif (#1980)
   */
  scoreAudit?: { refereeId?: string; refereeName?: string; ipAddress?: string; reason?: string };
  /**
   * Serveur distant de l'épreuve (tablettes), quand le poste en a un : arrêté à la suppression
   * de l'épreuve, prévenu d'un changement de réglages (docs/adr/0018). Absent : MCP, tests.
   */
  remote?: {
    stop(competitionId: string): void;
    settingsChanged(competitionId: string, patch: Partial<CompetitionSettings>): void;
    /** Espace Vue DT du serveur de l'épreuve (docs/adr/0020) ; undefined : serveur arrêté */
    dtView?(competitionId: string): DtViewPort | undefined;
    /** Pilotage du serveur distant par l'écran : démarrage, session, réglages (docs/adr/0022) */
    admin?: RemoteAdminPort;
  };
  /**
   * Services du poste du Mode Club (tablettes du serveur d'entraînement, synchronisation,
   * sauvegardes) : dépendent d'Electron, branchés par main.ts (docs/adr/0022). Absent : tests.
   */
  club?: ClubPort;
  /**
   * Services du poste hors base (thèmes d'écrans, réglages RGPD, serveur MCP, pistes de la
   * journée, dossiers par défaut de l'agent) : branchés par main.ts (docs/adr/0022). Absent :
   * tests, MCP ; les opérations qui en ont besoin refusent par « unavailable ».
   */
  station?: StationPort;
  /**
   * Serveur d'entraînement (démo autonome, tablettes du Mode Club) : registre, certificat,
   * fenêtre principale, écrans de démo ; branché par main.ts (docs/adr/0022). Absent : tests, MCP.
   */
  training?: TrainingPort;
  /**
   * Pilotes des appareils de piste (Cyrano, OPP2) et PisteHub : branchés par main.ts
   * (docs/adr/0023). Absent : tests, MCP ; le pilotage refuse alors par « unavailable ».
   */
  devices?: DevicesPort;
}

/** Ce que les opérations du serveur distant appellent sur un RemoteScoreServer */
export type RemoteServerHandle = Pick<
  RemoteScoreServer,
  | 'startSession'
  | 'stopSession'
  | 'launchCompetition'
  | 'getSession'
  | 'getAllArenas'
  | 'updateStripCount'
  | 'updateShowPhotos'
  | 'updateCardAnnounce'
  | 'updateTheme'
  | 'updateArenaTheme'
  | 'clearArenaThemeOverride'
  | 'updateKioskViews'
  | 'updateKioskTheme'
  | 'updateArenaScreenTheme'
  | 'setArenaPassword'
  | 'setOrgNote'
  | 'clearOrgNote'
  | 'acknowledgeDTCall'
  | 'requestMatchSignature'
  | 'updateMatchArena'
  | 'updatePoolFencers'
  | 'syncPoolMatches'
  | 'assignPools'
  | 'refreshDeMatches'
  | 'resetPoolMatch'
  | 'finishPoolMatch'
  | 'setTeamArenaMatch'
  | 'clearTeamArenaMatch'
  | 'setWallpaper'
  | 'setRegistrationEnabled'
  | 'setCheckinEnabled'
  | 'setCheckinPassword'
  | 'setTrainerEnabled'
  | 'setTrainerPassword'
> & {
  clients: Pick<
    RemoteScoreServer['clients'],
    'list' | 'send' | 'broadcast' | 'rename' | 'identify' | 'setKioskMode'
  >;
};

/** Réglages valables pour tous les serveurs actifs (webhook, logo, synthèse vocale) */
export type RemoteSharedHandle = Pick<
  RemoteScoreServer,
  'setLogo' | 'setTtsConfig' | 'setWebhookUrl'
>;

/**
 * Serveur distant de l'épreuve, vu par les opérations de l'écran (docs/adr/0022) : cycle de vie
 * (registre, ports, certificat), serveur de l'épreuve, réglages du poste enregistrés sur disque.
 * Branché par main.ts (remotePort.ts) ; absent : tests, MCP, `--headless` sans écran.
 */
export interface RemoteAdminPort {
  /** Interfaces d'écoute : toutes (0.0.0.0), puis les IPv4 non locales */
  networkInterfaces(): Array<{ name: string; address: string }>;
  /** Démarre le serveur de l'épreuve ; refuse par CommandError / ApiError (déjà démarré, TLS, port) */
  start(
    competitionId: string,
    options: { port?: number; host?: string; useHttps?: boolean }
  ): Promise<RemoteServerInfo>;
  /** Recharge à chaud (port, interface, HTTPS) sans perdre session ni pistes */
  reload(
    competitionId: string,
    options: { port?: number; host?: string; useHttps?: boolean }
  ): Promise<RemoteServerInfo>;
  /** Adresse du serveur de l'épreuve ; undefined : non démarré */
  info(competitionId: string): RemoteServerInfo | undefined;
  /** Empreinte du certificat TLS auto-signé du poste (généré au besoin) */
  certFingerprint(): Promise<string>;
  /** Diagnostic du pare-feu Windows (lecture seule) */
  firewallCheck(port: number): Promise<FirewallDiagnosis>;
  /** Serveur de l'épreuve ; undefined : non démarré */
  server(competitionId: string): RemoteServerHandle | undefined;
  /** Tous les serveurs actifs (épreuves et entraînement) */
  servers(): RemoteSharedHandle[];
  /** Logo des écrans poussé aux serveurs actifs (enregistré en base par setRemoteLogo) */
  setLogo(logo: string | null): Promise<void>;
  /** Synthèse vocale : fichier du poste puis serveurs actifs */
  setTtsConfig(config: TtsConfig): Promise<void>;
  /** Vague active des rapières : mémorisée même serveur arrêté, appliquée au serveur s'il tourne */
  setActiveWave(competitionId: string, matchIds: string[] | null, poolsClosed: boolean): void;
  /** Message de test au webhook, envoyé depuis le main (la CSP de l'écran bloque l'hôte) */
  testWebhook(url: string): Promise<{ success: boolean; status?: number; error?: string }>;
}

/** Ce que les opérations de l'entraînement appellent sur le RemoteScoreServer d'entraînement */
export type TrainingServerHandle = Pick<
  RemoteScoreServer,
  | 'startTrainingSession'
  | 'stopTrainingSession'
  | 'getTrainingHistory'
  | 'getSession'
  | 'getAllArenas'
>;

/**
 * Serveur d'entraînement vu par les opérations du contrat (docs/adr/0022). Il vit dans le
 * registre des serveurs distants sous `__training__` ; il s'arrête quand la fenêtre principale
 * se ferme ou se recharge. Branché par main.ts (trainingPort.ts).
 */
export interface TrainingPort {
  /** Serveur d'entraînement ; undefined : non démarré */
  server(): TrainingServerHandle | undefined;
  /** Adresse du serveur ; undefined : non démarré */
  info(): TrainingServerInfo | undefined;
  /** Démarre le serveur ; refuse par CommandError (déjà démarré, TLS, port indisponible) */
  start(options: { port?: number; host?: string; useHttps?: boolean }): Promise<TrainingServerInfo>;
  /** Arrête le serveur (démo et écrans de démo compris) ; false s'il ne tournait pas */
  stop(): boolean;
  /** Applique le thème (déjà contrôlé) à tous les écrans du serveur démarré */
  applyTheme(theme: TrainingTheme): void;
  /** Ouvre les fenêtres de la démo sur le serveur démarré ; renvoie leur nombre */
  openDemoScreens(strips: number): number;
}

/**
 * Pilotes des appareils de piste vus par les opérations du contrat (docs/adr/0023). Les tables
 * des pilotes ne sont jamais envoyées par l'écran : `reload` relit les appareils des salles des
 * épreuves suivies. Branché par main.ts (devicesPort.ts).
 */
export interface DevicesPort {
  /** Relit les appareils des salles ; `focus` : épreuve suivie en plus (panneau de l'écran) */
  reload(focus?: string): void;
  cyrano: {
    running(): boolean;
    /** Démarre le serveur UDP ; refuse par CommandError (interface invalide, port pris) */
    start(options: { port?: number; host?: string; hello?: CyranoHelloMode }): Promise<number>;
    stop(): Promise<void>;
    status(): CyranoStatus;
    log(): CyranoFrameLog[];
  };
  opp2: {
    running(): boolean;
    /** Démarre le broker MQTT et le pilote ; refuse par CommandError */
    start(options: { port?: number }): Promise<number>;
    stop(): Promise<void>;
    status(): Opp2Status;
  };
  /** Épreuve suivie par chaque piste du pilote */
  routes(): Record<string, string | null>;
  setOptions(options: StripDeviceOptions): void;
  /** Action de secours ; false si elle ne s'applique pas */
  action(piste: string, action: StripDeviceAction): boolean;
  /** Pilotage de la salle hors compétition (#2117) */
  control: {
    /** Salle pilotée : ses appareils chargés dans les pilotes en plus des épreuves suivies */
    watchVenue(venueId: string): void;
    /** Épreuves en saisie distante et arènes de leur séance */
    activeArenas(): { competitionId: string; arenas: number[] }[];
    /** Liaison d'une piste chargée dans le pilote ; null : pilote arrêté ou appareil non chargé */
    link(device: EffectiveStripDevice): StripDeviceLink | null;
    /** Alerte de la piste (BAD MATCH : l'appareil affiche un autre match) ; null : aucune */
    alert(piste: string): StripDeviceAlert | null;
    /** Affichage libre envoyé ; false : piste inconnue du pilote */
    send(target: StripControlTarget, panel: StripPanel): boolean;
    /** Dernier envoi à la piste ; `match` : seulement s'il visait cette piste de cette salle */
    last(piste: string, match?: { venueId: string; strip: number }): StripLastSend | null;
  };
}

/** Résultat d'un envoi vers un serveur externe ; `error` : message ou code du dépôt */
export interface SendResult {
  success: boolean;
  error?: string;
}

/** Services du poste (réglages, thèmes, RGPD, agent, journée) : ce qui dépasse la base */
export interface StationPort {
  /** Dossiers accessibles à l'agent tant que l'opérateur n'en a pas choisi */
  defaultAgentFolders(): string[];
  /** Bibliothèque de thèmes d'écrans (<userData>/themes.json) */
  themes: {
    list(): Promise<CustomTheme[]>;
    save(theme: CustomTheme): Promise<void>;
    remove(themeId: string): Promise<void>;
  };
  /** Réglages RGPD (<userData>/privacy-settings.json) et épreuves occupées */
  privacy: {
    settings(): PrivacySettings;
    /** Fusionne, assainit, enregistre et applique l'affichage des noms sur le réseau */
    update(input: Partial<PrivacySettings>): PrivacySettings;
    /** Épreuve ouverte à l'écran ou servie aux tablettes : à ne pas anonymiser ni effacer */
    isCompetitionBusy(competitionId: string): boolean;
  };
  /** Serveur MCP intégré : réglages, jeton, journal des appels */
  mcp: {
    status(): Promise<McpStatus>;
    /** Enregistre les réglages puis démarre, redémarre ou arrête le serveur */
    update(input: { enabled?: boolean; port?: number; allowWrite?: boolean }): Promise<McpStatus>;
    regenerateToken(): Promise<McpStatus>;
    log(): McpLogEntry[];
  };
  /** Dossier de sauvegarde du poste (<userData>/backup-settings.json) */
  backup: {
    info(): BackupDirDTO;
    /** Dossier du poste (chemin déjà vérifié par la commande) */
    set(dir: string): BackupDirDTO;
    /** Revient au dossier par défaut ; dossiers propres des épreuves gardés */
    reset(): BackupDirDTO;
    /** Dossier propre d'une épreuve sur ce poste ; null : dossier du poste (docs/adr/0030) */
    competitionDir(competitionId: string): string | null;
    /** Fixe (chemin vérifié) ou retire (null) le dossier propre d'une épreuve */
    setCompetitionDir(competitionId: string, dir: string | null): void;
  };
  /**
   * Recherche de lieu sur Internet (Photon, Géoplateforme ; docs/adr/0026). Absent : tests,
   * poste sans réseau sortant ; la requête répond alors « indisponible ».
   */
  places?: {
    search(
      query: string,
      language: string
    ): Promise<{ suggestions: PlaceSuggestion[]; unavailable: boolean }>;
  };
  /**
   * Publication des résultats (#1981 lot 4, docs/adr/0022) : envoi vers GREG, dépôt FTP / FTPS
   * / HTTP PUT. XML déjà construit par le moteur. Absent : tests, MCP ; la commande répond
   * « indisponible ». Le mot de passe n'est ni logué ni renvoyé.
   */
  publication?: {
    greg(request: { fileName: string; xml: string; fields: GregFormFields }): Promise<SendResult>;
    remote(request: {
      fileName: string;
      xml: string;
      url: string;
      user: string;
      password: string;
    }): Promise<SendResult>;
  };
  /** Bibliothèque de logos (<userData>/logos.json) ; le logo actif est le paramètre `logo` */
  logos: {
    list(): Promise<LogoLibraryEntry[]>;
    /** Remplace la bibliothèque (écriture atomique) ; renvoie ce qui est enregistré */
    save(logos: LogoLibraryEntry[]): Promise<LogoLibraryEntry[]>;
  };
  /** Proxy réseau (<userData>/proxy-settings.json), appliqué à la session Electron */
  proxy: {
    settings(): ProxySettingsDTO;
    /** Normalise, applique puis enregistre ; null : réglage invalide, rien n'est changé */
    update(input: ProxySettingsDTO): Promise<ProxySettingsDTO | null>;
    /** Route résolue pour GitHub et requête réelle */
    test(): Promise<{ ok: boolean; resolved: string }>;
  };
  /** Données techniques du rapport de diagnostic (versions, système, mémoire) */
  diagnostics(): DiagnosticInput;
  /** Pistes de la journée en temps réel (serveurs distants des épreuves) */
  dayStrips: {
    board(dayId: string): DayStripBoard | null;
    assign(dayId: string, strip: number, key: string): boolean;
  };
}

/** Mode Club : ce qui dépasse la base (serveur d'entraînement, dossier de synchro, sauvegardes) */
export interface ClubPort {
  /** Serveur d'entraînement : actif, adresse, nombre de pistes */
  remoteStatus(): { active: boolean; url: string | null; strips: number };
  /** Place le combat sur l'arène de sa piste */
  pushBout(
    bout: ClubBout,
    memberA: ClubMember | null,
    memberB: ClubMember | null
  ): 'ok' | 'no_server' | 'no_arena' | 'busy';
  /** Séance dont les tablettes lancent des combats par scan des cartes (null : aucune) */
  linkSession(sessionId: string | null): void;
  linkedSession(): string | null;
  /** Combat annulé : l'arène reprend un match libre */
  releaseBout(boutId: string): void;
  sync: {
    status(clubId: string): ClubSyncStatus;
    /** Sélecteur de dossier natif puis activation ; null si annulé */
    enable(clubId: string): Promise<ClubSyncStatus | null>;
    disable(clubId: string): ClubSyncStatus;
    now(clubId: string): Promise<ClubSyncStatus>;
    resolve(clubId: string, keep: 'file' | 'app'): Promise<ClubSyncStatus>;
  };
  backups: {
    list(clubId: string): ClubBackupEntry[];
    create(clubId: string): Promise<ClubBackupEntry[]>;
    /** Notifie les vues du club (onClubSynced) une fois restaurée */
    restore(clubId: string, backupId: string): Promise<{ clubName: string }>;
  };
}

/** Espace Vue DT : réglé par configureDtView, lu par getDtViewStatus (docs/adr/0020) */
export interface DtViewPort {
  status(): { enabled: boolean; configured: boolean };
  setEnabled(enabled: boolean): void;
  /** Vide : mot de passe retiré. Lève une erreur si trop court. */
  setPassword(password: string): void;
}

/** Erreur métier : message destiné à l'opérateur (ou à l'agent), code stable */
export class CommandError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'CommandError';
  }
}
