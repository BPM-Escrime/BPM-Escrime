/**
 * BPM - Escrime - Preload API Types
 * Type-safe API interfaces for IPC communication
 * Licensed under GPL-3.0
 */

import type { SettingsAPI } from './settingsApi';
import {
  Card,
  Competition,
  Match,
  Pool,
  PoolSnapshot,
  Score,
  Phase,
  FencerCompetitionStats,
} from '../types';
import type { MatchSignatureRequest, ArenaUpdate } from './remote';
import type { PrivacyAPI } from './privacy';
import type { McpScreenEvent } from './mcp';
export type { ClubMemberReport } from './club';

// Re-export Pool for preload
export type { Pool, PoolSnapshot } from '../types';
export type { TrainingCustomRules, TrainingMatchRecord, TrainingServerInfo } from './training';

// Config TTS (minuteur vocal) des tablettes d'arbitrage, réglée dans les paramètres globaux
export interface TtsConfig {
  voiceName: string | null; // Nom de la voix (SpeechSynthesisVoice.name) ; null = voix par défaut de la langue
  rate: number; // Vitesse d'élocution (0.5 – 2)
  announce: Record<string, boolean>; // Paliers annoncés : '60','30','10','5','countdown','0'
}

// ============================================================================
// Database API Types
// ============================================================================

export interface FencerUpdateData {
  lastName?: string;
  firstName?: string;
  birthDate?: Date;
  gender?: string;
  nationality?: string;
  region?: string;
  department?: string;
  club?: string;
  license?: string;
  ranking?: number;
  status?: string;
  photo?: string;
  handedness?: 'R' | 'L';
  exclusionReason?: 'black_card' | 'dns' | null;
}

export interface MatchCreateData {
  id?: string;
  number: number;
  fencerAId?: string;
  fencerBId?: string;
  maxScore: number;
  poolId?: string;
  tableId?: string;
  round?: number;
  position?: number;
}

export interface MatchUpdateData {
  scoreA?: {
    value: number | null;
    isVictory: boolean;
    isAbstention?: boolean;
    isExclusion?: boolean;
    isForfait?: boolean;
  };
  scoreB?: {
    value: number | null;
    isVictory: boolean;
    isAbstention?: boolean;
    isExclusion?: boolean;
    isForfait?: boolean;
  };
  status?: string;
  strip?: number;
  startTime?: Date;
  endTime?: Date;
  duration?: number;
  refereeId?: string | null;
}

// ============================================================================
// Fighter Statistics Types
// ============================================================================

export type {
  MatchTouchData,
  MatchCardData,
  MatchTimingData,
  SimulatedMatchEvents,
  ArenaExitData,
} from './matchEvents';

export type { FencerCompetitionStats };

export interface FencerMatchRecord {
  matchId: string;
  number: number;
  opponentId: string | null;
  opponentLastName: string | null;
  opponentFirstName: string | null;
  scoreA: string | null; // JSON Score
  scoreB: string | null; // JSON Score
  side: 'A' | 'B';
  status: string;
  startTime: string | null;
  endTime: string | null;
  duration: number | null;
  poolId: string | null;
  tableId: string | null;
  round: number | null;
  touches: Array<{
    id: string;
    zone: string;
    points: number;
    timestamp: string;
    isValidInSuddenDeath: boolean;
    isReversed: boolean;
  }>;
  cards: Array<{
    id: string;
    cardType: string;
    reason: string;
    cardGroup: number;
    timestamp: string;
    pointsAwarded: number;
    resultingExclusion: boolean;
  }>;
}

export interface FencerHistory {
  matches: FencerMatchRecord[];
}

export interface MatchSnapshot {
  matchId: string;
  status: string;
  scoreA: {
    value: number | null;
    isVictory: boolean;
    isAbstention: boolean;
    isExclusion: boolean;
    isForfait: boolean;
  } | null;
  scoreB: {
    value: number | null;
    isVictory: boolean;
    isAbstention: boolean;
    isExclusion: boolean;
    isForfait: boolean;
  } | null;
}

export interface AbandonSnapshot {
  id: string;
  fencerId: string;
  competitionId: string;
  previousStatus: string;
  abandonType: 'abandon' | 'forfait' | 'exclusion';
  matchSnapshots: MatchSnapshot[];
  createdAt: string;
}

export interface SessionState {
  currentPhase?: number;
  selectedPool?: string;
  selectedTable?: string;
  uiState?: Record<string, unknown>;
  lastSaveTime?: Date;
}

// ============================================================================
// File API Types
// ============================================================================

export interface FileOpenOptions {
  title: string;
  filters: Array<{
    name: string;
    extensions: string[];
  }>;
  properties?: Array<'openFile' | 'openDirectory' | 'multiSelections'>;
}

export interface FileSaveOptions {
  title: string;
  filters: Array<{
    name: string;
    extensions: string[];
  }>;
  defaultPath?: string;
}

export interface FileOpenResult {
  filePath: string;
  content?: string;
  /** Octets du fichier, quand le dialogue a été ouvert avec `binary` (ADR-0021) */
  bytes?: Uint8Array;
}

export interface FileSaveResult {
  filePath: string;
  success: boolean;
  canceled?: boolean;
}

// ============================================================================
// Dialog API Types
// ============================================================================

export interface DialogOpenOptions {
  title?: string;
  defaultPath?: string;
  filters?: Array<{
    name: string;
    extensions: string[];
  }>;
  properties?: Array<'openFile' | 'openDirectory' | 'multiSelections'>;
  /** Lit les octets du fichier (`bytes`) au lieu du texte (ADR-0021) */
  binary?: boolean;
}

export interface DialogSaveOptions {
  title?: string;
  defaultPath?: string;
  filters?: Array<{
    name: string;
    extensions: string[];
  }>;
}

// ============================================================================
// Menu Event Types
// ============================================================================

export interface MenuEventData {
  format?: string;
  filepath?: string;
  content?: string;
}

// ============================================================================
// Version Info Types
// ============================================================================

export interface VersionInfo {
  version: string;
  build: number;
  date: string;
  /** Canal de distribution (docs/VERSIONING.md) ; absent sur les anciens builds */
  channel?: 'dev' | 'rc' | 'stable';
}

// ============================================================================
// Updater API Types
// ============================================================================

export interface UpdateInfo {
  hasUpdate: boolean;
  currentBuild: number;
  latestBuild: number;
  latestVersion: string;
  downloadUrl: string;
  releaseNotes: string;
}

/** Progression du téléchargement d'une mise à jour (`update:progress`) */
export interface UpdateProgressEvent {
  progress: number;
  downloaded?: number;
  total?: number;
  latestVersion?: string;
  latestBuild?: number;
  currentBuild?: number;
}

export type { ProxySettingsDTO, ProxyAPI, BackupDirDTO, BackupAPI } from './systemSettings';
import type { ProxyAPI, BackupAPI } from './systemSettings';

export interface UpdaterAPI {
  check: () => Promise<UpdateInfo | null>;
  setSilentMode: (enabled: boolean) => Promise<{ success: boolean; silent: boolean }>;
  getSilentMode: () => Promise<{ silent: boolean }>;
  hasPendingUpdate: () => Promise<{ hasPending: boolean }>;
  getPendingUpdateInfo: () => Promise<{ version: string; path: string } | null>;
  installPendingUpdate: () => Promise<{ success: boolean; error?: string }>;
  /** Télécharge, vérifie (SHA-256) puis propose l'installation, sans navigateur */
  downloadAndInstall: () => Promise<{ success: boolean; error?: string }>;
  /** Vérification automatique au démarrage + périodique (préférence persistée) */
  getAutoCheck: () => Promise<{ enabled: boolean }>;
  setAutoCheck: (
    enabled: boolean
  ) => Promise<{ success: boolean; enabled?: boolean; error?: string }>;
  /** Répertoire de téléchargement des mises à jour (défaut = dossier privé userData) */
  getDownloadDir: () => Promise<{ dir: string; defaultDir: string; isDefault: boolean }>;
  chooseDownloadDir: () => Promise<{
    success: boolean;
    dir?: string;
    canceled?: boolean;
    error?: string;
  }>;
  resetDownloadDir: () => Promise<{ success: boolean; dir?: string; error?: string }>;
  /** Canal : stable (releases main) ou dev (pré-releases incluses) */
  getChannel: () => Promise<{ channel: 'stable' | 'dev' }>;
  setChannel: (
    channel: 'stable' | 'dev'
  ) => Promise<{ success: boolean; channel?: 'stable' | 'dev'; error?: string }>;
}

// ============================================================================
// Remote Score Server API Types
// ============================================================================

export interface RemoteServerInfo {
  url: string;
  ip: string;
  port: number;
  useHttps?: boolean;
  certFingerprint?: string;
}

export interface ConnectedClient {
  socketId: string;
  clientType: 'arena' | 'kiosk' | 'public' | 'pool' | 'dashboard' | 'lobby' | 'referee';
  arenaId?: string;
  ip: string;
  userAgent: string;
  connectedAt: string;
  lastSeen: string;
  label?: string;
  screenId?: string;
  battery?: { level: number; charging: boolean; updatedAt: string };
}

export interface KioskScreenConfig {
  poules: boolean;
  classement: boolean;
  final: boolean;
  direct: boolean;
  suivants: boolean;
  tableau: boolean;
  rotationSec: number;
  /** Badge « fin estimée » de la phase en cours (défaut : affiché, #1077) */
  eta?: boolean;
}

export interface TVCommand {
  type: 'refresh' | 'navigate' | 'message' | 'ping' | 'identify' | 'kiosk:config';
  url?: string;
  text?: string;
  duration?: number;
  kioskConfig?: Partial<KioskScreenConfig>;
  screenLabel?: string;
}

// ============================================================================
// Complete API Interface Types
// ============================================================================

type CardRef = { matchId: string; fencerId: string; cardType: string };
export interface DatabaseAPI {
  // Competitions
  getAllCompetitions: () => Promise<Competition[]>;

  // Fencers
  updateFencer: (id: string, updates: FencerUpdateData) => Promise<void>;

  // Matches
  createMatch: (match: MatchCreateData, poolId?: string) => Promise<Match>;
  updateMatch: (id: string, updates: MatchUpdateData) => Promise<void>;
  upsertMultipleTableauMatches: (
    competitionId: string,
    matches: Array<{
      matchId: string;
      round: number;
      position: number;
      fencerAId?: string | null;
      fencerBId?: string | null;
      scoreA?: Partial<Score> | null;
      scoreB?: Partial<Score> | null;
      status?: string;
      maxScore?: number;
      isBye?: boolean;
    }>
  ) => Promise<void>;

  // Pools
  createPool: (phaseId: string, number: number, poolId?: string) => Promise<Pool>;
  clearPoolsForPhase: (phaseId: string) => Promise<void>;
  addFencerToPool: (poolId: string, fencerId: string, position: number) => Promise<void>;
  syncPoolSnapshot: (competitionId: string, snapshot: PoolSnapshot) => Promise<void>;
  getPoolsByPhase: (phaseId: string) => Promise<Pool[]>;
  updatePool: (pool: Pool) => Promise<void>;

  // Phases
  createPhase: (competitionId: string, type: string, order: number, name: string) => Promise<Phase>;
  getPhasesByCompetition: (competitionId: string) => Promise<Phase[]>;

  // Referees

  // Touch / Card read

  getCardsByMatchIds: (ids: string[]) => Promise<CardRef[]>; // feuilles imprimées (#1829)
  // Session State
  /** conflict : état réécrit par le MCP depuis le chargement (#1880), rien n'est écrit */
  saveSessionState: (id: string, state: SessionState) => Promise<void | { conflict: true }>;
  saveSessionStateSync: (competitionId: string, state: unknown) => boolean;
  getSessionState: (competitionId: string) => Promise<SessionState | null>;

  // Statistiques combattants
  saveAbandonSnapshot: (
    fencerId: string,
    competitionId: string,
    previousStatus: string,
    abandonType: string,
    matchSnapshots: MatchSnapshot[]
  ) => Promise<void>;
  getAbandonSnapshot: (fencerId: string) => Promise<AbandonSnapshot | null>;
  deleteAbandonSnapshot: (fencerId: string) => Promise<void>;

  // Score audit log

  // Classement saisonnier Quest

  // Match timeline

  // Équipes
  createTeam: (competitionId: string, name: string, club: string) => Promise<{ id: string }>;
  getTeamsByCompetition: (competitionId: string) => Promise<
    Array<{
      id: string;
      name: string;
      club: string;
      fencers: Array<{
        fencerId: string;
        fencerLastName: string;
        fencerFirstName: string;
        teamOrder: number;
        isReserve: boolean;
      }>;
    }>
  >;
  deleteTeam: (teamId: string) => Promise<void>;
  upsertTeamFencer: (
    teamId: string,
    fencerId: string,
    teamOrder: number,
    isReserve: boolean
  ) => Promise<void>;
  removeTeamFencer: (teamId: string, fencerId: string) => Promise<void>;
  createTeamMatch: (
    competitionId: string,
    poolNumber: number,
    teamAId: string,
    teamBId: string,
    round?: number
  ) => Promise<{ id: string }>;
  getTeamMatchesByCompetition: (competitionId: string) => Promise<
    Array<{
      id: string;
      poolNumber: number;
      round: number | null;
      teamAId: string;
      teamBId: string;
      scoreBoutsA: number;
      scoreBoutsB: number;
      status: string;
      winnerId: string | null;
      currentBoutIndex: number;
      bouts: Array<{
        id: string;
        boutOrder: number;
        fencerAId: string;
        fencerBId: string;
        scoreA: number;
        scoreB: number;
        maxScore: number;
        status: string;
        winnerId: string | null;
      }>;
    }>
  >;
  createTeamBout: (
    matchId: string,
    boutOrder: number,
    fencerAId: string,
    fencerBId: string,
    maxScore: number
  ) => Promise<{ id: string }>;
  updateTeamBout: (
    boutId: string,
    scoreA: number,
    scoreB: number,
    status: string,
    winnerId: string | null
  ) => Promise<void>;
  createTeamTableauMatch: (
    competitionId: string,
    tableId: string,
    round: number,
    position: number,
    teamAId: string,
    teamBId: string
  ) => Promise<{ id: string }>;
  getTeamTableauMatches: (
    competitionId: string,
    tableId: string
  ) => Promise<
    Array<{
      id: string;
      round: number;
      position: number;
      teamAId: string;
      teamBId: string;
      scoreBoutsA: number;
      scoreBoutsB: number;
      status: string;
      winnerId: string | null;
      currentBoutIndex: number;
      bouts: Array<{
        id: string;
        boutOrder: number;
        fencerAId: string;
        fencerBId: string;
        scoreA: number;
        scoreB: number;
        maxScore: number;
        status: string;
        winnerId: string | null;
      }>;
    }>
  >;
  createTeamMatchCard: (
    matchId: string,
    teamId: string,
    type: 'white' | 'yellow' | 'red' | 'black',
    reason: string
  ) => Promise<{ id: string }>;
  getTeamMatchCards: (matchId: string) => Promise<
    Array<{
      id: string;
      matchId: string;
      teamId: string;
      type: string;
      reason: string;
      createdAt: string;
    }>
  >;
  /** Cartons individuels des relais par équipes, persistés (#1086) */
  createTeamBoutCard: (boutId: string, card: Card) => Promise<{ id: string }>;
  getTeamBoutCards: (matchId: string) => Promise<Array<{ boutId: string; card: Card }>>;
}

export interface FileAPI {
  export: (filepath: string) => Promise<FileSaveResult>;
  import: (filepath: string) => Promise<FileOpenResult>;
  /** Décode des fichiers glissés-déposés (.zip de l'extranet, .xml, .fff, .txt) (#1938) */
  unpackFederalFiles: (
    inputs: Array<{ name: string; bytes: Uint8Array }>
  ) => Promise<FederalTextFile[]>;
  /** Écrit un texte (UTF-8) ou des octets au chemin choisi par le dialogue natif */
  writeContent: (filepath: string, content: string | Uint8Array) => Promise<void>;
  /** Classeur .xlsx écrit par le main (une feuille) */
  writeSpreadsheet: (
    filepath: string,
    rows: (string | number)[][],
    sheetName?: string
  ) => Promise<void>;
  printHtml: (html: string) => Promise<{ success: boolean; error?: string }>;
  printHtmlToPDF: (
    html: string,
    outputPath: string
  ) => Promise<{ success: boolean; path?: string; error?: string }>;
  /** Pages du HTML rendu en PDF (sommaire du dossier de compétition) */
  countHtmlPages: (html: string) => Promise<{ success: boolean; pages?: number; error?: string }>;
  previewPdf: (
    html: string,
    title?: string
  ) => Promise<{ success: boolean; path?: string; error?: string }>;
}

/** Fichiers de l'extranet fédéral décodés (#1938) */
export interface FederalTextFile {
  name: string;
  content: string;
}

export interface DialogAPI {
  openFile: (options: DialogOpenOptions) => Promise<FileOpenResult | null>;
  /** Choisit le .zip de l'extranet (ou .xml / .fff / .txt) ; fichiers décodés un par un */
  openFederalFiles: () => Promise<{ names: string[]; files: FederalTextFile[] } | null>;
  saveFile: (options: DialogSaveOptions) => Promise<FileSaveResult | null>;
}

export interface MenuAPI {
  onMenuNewCompetition: (callback: () => void) => () => void;
  onMenuSave: (callback: () => void) => () => void;
  onMenuCompetitionProperties: (callback: () => void) => () => void;
  onMenuAddFencer: (callback: () => void) => () => void;
  onMenuAddReferee: (callback: () => void) => () => void;
  onMenuNextPhase: (callback: () => void) => () => void;
  onMenuExport: (callback: (format: string) => void) => () => void;
  onMenuImport: (
    callback: (format: string, filepath: string, content: string) => void
  ) => () => void;
  onMenuOpenSettings: (callback: () => void) => () => void;
  onMenuReportIssue: (callback: () => void) => () => void;
  onShowAbout: (callback: () => void) => () => void;
  /** competitionIds : compétitions fusionnées depuis le .bpm ouvert (#1117) */
  onFileOpened: (callback: (filepath: string, competitionIds?: string[]) => void) => () => void;
  /** Compétition affichée : « Enregistrer sous » l'exporte seule */
  setCurrentCompetition?: (competitionId: string | null) => void;
  onFileSaved: (callback: (filepath: string) => void) => () => void;
  onAutosaveCompleted: (callback: () => void) => () => void;
  onAutosaveFailed: (callback: () => void) => () => void;
  onDbReady: (callback: () => void) => void;
}

export interface UtilityAPI {
  print: () => Promise<void>;
  /** `force` : préréglage explicite → sort du maximisé / plein écran ; sinon ignoré si maximisée */
  setWindowSize: (width: number, height: number, options?: { force?: boolean }) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  /** Lag de la boucle d'événements du process principal (ms) ; `reset` démarre une nouvelle fenêtre */
  getEventLoopDelay: (reset?: boolean) => Promise<{
    samples: number;
    meanMs: number;
    p50Ms: number;
    p99Ms: number;
    maxMs: number;
  }>;
  getVersionInfo: () => Promise<VersionInfo>;
  removeAllListeners: (channel: string) => void;
}

// ============================================================================
// Bracket Node Types
// ============================================================================

export interface BracketNodeData {
  id: string;
  competitionId: string;
  round: number;
  position: number;
  fencerAId: string | null;
  fencerBId: string | null;
  winnerId: string | null;
  isBye: boolean;
  matchId: string | null;
}

// ============================================================================
// Score Audit Log Types
// ============================================================================

export interface ScoreAuditLogEntry {
  id: string;
  matchId: string;
  competitionId: string;
  changedBy: string;
  timestamp: string; // ISO 8601
  field: 'scoreA' | 'scoreB' | 'status';
  previousValue: string | null; // JSON
  newValue: string | null; // JSON
}

export interface ScoreAuditEntry {
  id: string;
  matchId: string;
  arenaId: string | null;
  poolId: string | null;
  matchNumber: number | null;
  poolNumber: number | null;
  previousScoreA: Partial<Score> | null;
  previousScoreB: Partial<Score> | null;
  newScoreA: Partial<Score> | null;
  newScoreB: Partial<Score> | null;
  changedBy: string;
  changedAt: string; // ISO 8601
  reason: string | null;
  refereeId: string | null;
  refereeName: string | null;
  ipAddress: string | null;
  /** Tour du tableau (1 = finale, 2 = demies…) ; null pour un match de poule */
  tableauRound?: number | null;
  tableauPosition?: number | null;
}

export interface ScoreIpConflict {
  matchId: string;
  poolId: string;
  matchNumber: number | null;
  poolNumber: number | null;
  originalIp: string;
  originalReferee: string | null;
  attemptIp: string;
  attemptReferee: string;
  timestamp: string; // ISO 8601
}

// ============================================================================
// Arena State Types
// ============================================================================

export interface ArenaStateData {
  arenaId: string;
  competitionId: string;
  currentMatchId: string | null;
  strip: number;
  isActive: boolean;
  lastUpdated: string; // ISO 8601
  extraData?: Record<string, unknown>;
}

/** Chiffrement OS (safeStorage) pour secrets locaux. Renvoie null si indisponible. */
export interface CryptoAPI {
  isAvailable: () => Promise<boolean>;
  protect: (plaintext: string) => Promise<string | null>;
  unprotect: (ciphertext: string) => Promise<string | null>;
}

/** Boîte d'impression intégrée (#1214) */
export interface PrintDialogSettings {
  printer: string;
  copies: number;
  /** Plages « 1-3, 5 », vide = toutes */
  pages: string;
  orientation: 'auto' | 'portrait' | 'landscape';
  paperSize: 'auto' | 'A3' | 'A4' | 'A5' | 'Letter' | 'Legal';
  color: boolean;
  duplex: 'simplex' | 'shortEdge' | 'longEdge';
  margins: 'default' | 'none' | 'minimum';
  /** Échelle en % (10-200) */
  scale: number;
}

/** Rapport de diagnostic exporté en JSON (#1326) */
export interface DiagnosticAPI {
  exportReport: () => Promise<{ success: boolean; cancelled?: boolean; error?: string }>;
}

/** Publication GREG (escrime-info.com) : fichier XML + champs du formulaire (#1328) */
export interface GregAPI {
  publish: (request: {
    fileName: string;
    xml: string;
    fields: Record<string, string>;
  }) => Promise<{ success: boolean; error?: string }>;
}

/** Connecteur FTP/FTPS : dépôt du fichier de résultats (#1331) */
export interface FtpAPI {
  publish: (request: {
    fileName: string;
    xml: string;
    url: string;
    user: string;
    password: string;
  }) => Promise<{ success: boolean; error?: string }>;
}

export interface PrintDialogAPI {
  getPrinters: () => Promise<{ name: string; displayName: string; isDefault: boolean }[]>;
  render: (
    html: string,
    settings?: Partial<PrintDialogSettings>
  ) => Promise<{ success: boolean; data?: Uint8Array; error?: string }>;
  execute: (
    html: string,
    settings?: Partial<PrintDialogSettings>
  ) => Promise<{ success: boolean; error?: string }>;
  savePdf: (
    html: string,
    settings?: Partial<PrintDialogSettings>,
    title?: string
  ) => Promise<{ success: boolean; canceled?: boolean; path?: string; error?: string }>;
  /** Boîte d'impression native du système (secours) */
  systemDialog: (html: string) => Promise<{ success: boolean; error?: string }>;
  /** Enregistre la fenêtre qui traite les demandes `file.printHtml` (null = désenregistrer) */
  setHandler: (
    handler: ((html: string) => Promise<{ success: boolean; error?: string }>) | null
  ) => void;
}

/** Types d'événements du bus de données main → renderer (#1298) */
export type CompetitionEventType = 'fencers:changed' | 'matches:changed' | McpScreenEvent;

export interface ElectronAPI extends MenuAPI, UtilityAPI {
  /** Contrat d'API (#1981) */
  api: import('../api/client').ApiBridge;
  printDialog: PrintDialogAPI;
  db: DatabaseAPI;
  file: FileAPI;
  dialog: DialogAPI;
  updater: UpdaterAPI;
  proxy: ProxyAPI;
  backup: BackupAPI;
  privacy: PrivacyAPI;
  /** Serveur MCP intégré, agent IA en lecture (#1880) */
  diagnostic: DiagnosticAPI;
  greg: GregAPI;
  ftp: FtpAPI;
  crypto: CryptoAPI;
  settings: SettingsAPI;
  onUpdateAvailable: (callback: (info: UpdateInfo) => void) => () => void;
  onUpdateProgress: (callback: (data: UpdateProgressEvent) => void) => () => void;
  /** Bus d'événements de données main → renderer (#1298) */
  onCompetitionEvent: (
    callback: (event: { type: CompetitionEventType; competitionId?: string }) => void
  ) => () => void;
  notifyLanguageChanged: (lang: string) => void;
  /** Écran de démarrage affiché ou non (préférence persistée côté main) */
  splash?: {
    getEnabled: () => Promise<{ enabled: boolean }>;
    setEnabled: (enabled: boolean) => Promise<{ success: boolean; enabled?: boolean }>;
  };
  initialLanguage: string | null;
  getLogo: () => Promise<string | null>;
  getLogos: () => Promise<{ id: string; name: string; data: string }[]>;
  saveLogos: (
    logos: { id: string; name: string; data: string }[]
  ) => Promise<{ success: boolean; error?: string }>;
  getTtsConfig: () => Promise<TtsConfig | null>;
}
