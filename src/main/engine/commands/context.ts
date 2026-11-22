/**
 * BellePoule Modern - Couche domaine (#1880) : logique métier du process main partagée
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

/** Écriture faite hors de l'écran : l'écran ouvert recharge les données concernées */
export interface DomainChange {
  /** Nature : épreuves (liste, réglages), tireurs, arbitres, réglages du poste, état de session */
  scope: 'competitions' | 'fencers' | 'referees' | 'settings' | 'session';
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
  };
  /**
   * Services du poste du Mode Club (tablettes du serveur d'entraînement, synchronisation,
   * sauvegardes) : dépendent d'Electron, branchés par main.ts (docs/adr/0022). Absent : tests.
   */
  club?: ClubPort;
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
