/**
 * BPM - Escrime - Fonctions de l'application de bureau, hors contrat d'API (ADR-0030, #1981 lots 3a-3b)
 * Présentes seulement quand PlatformServices.desktop existe (Electron) : absentes du navigateur de
 * développement et de la vue DT. Aucune règle métier : traduction entre le préload et l'interface.
 * Contenu, jamais chemin : aucun chemin du poste ne traverse ce groupe.
 * Licensed under GPL-3.0
 */
import type {
  PrintDialogAPI,
  UpdateInfo,
  UpdateProgressEvent,
  UpdaterAPI,
  VersionInfo,
} from '../types/preload';

/** Rend la fonction qui retire l'écouteur (le sien seulement, jamais removeAllListeners, #1894) */
export type Unsubscribe = () => void;

/**
 * Mise à jour de l'application : tout le groupe `updater.*` du préload, mêmes noms.
 * Préférences (vérification automatique, canal, dossier de téléchargement) hors contrat :
 * elles ne concernent que l'application installée sur ce poste (ADR-0030).
 */
export type DesktopUpdater = UpdaterAPI;

/**
 * Boîte d'impression intégrée (#1214) : imprimantes, aperçu, impression, PDF, boîte du système,
 * enregistrement de la fenêtre qui traite `print`. `savePdf` ne rend pas le chemin du PDF.
 */
export type DesktopPrintDialog = PrintDialogAPI;

/** Actions du menu natif et leur charge utile */
export interface MenuEvents {
  newCompetition: void;
  save: void;
  competitionProperties: void;
  addFencer: void;
  addReferee: void;
  nextPhase: void;
  openSettings: void;
  reportIssue: void;
  about: void;
  export: { format: string };
  /** Nom du fichier choisi et son contenu texte (vides pour l'archive .bpf, choisie par l'écran) */
  import: { format: string; name: string; content: string };
}

export interface DesktopServices {
  // Version et démarrage
  getVersionInfo(): Promise<VersionInfo>;
  getSplashEnabled(): Promise<boolean>;
  /** Rend la valeur enregistrée ; erreur si le poste ne l'a pas enregistrée */
  setSplashEnabled(enabled: boolean): Promise<boolean>;
  /** Résolue quand la base est ouverte ; tout de suite si c'est déjà fait */
  whenReady(): Promise<void>;

  // Mise à jour
  updater: DesktopUpdater;
  onUpdateAvailable(callback: (info: UpdateInfo) => void): Unsubscribe;
  onUpdateProgress(callback: (progress: UpdateProgressEvent) => void): Unsubscribe;

  // Menu natif et fichiers ouverts par le système
  onMenu<K extends keyof MenuEvents>(
    kind: K,
    callback: (payload: MenuEvents[K]) => void
  ): Unsubscribe;
  /** Fichier → Ouvrir a fusionné un .bpm : épreuves reprises (#1117) */
  onCompetitionFileOpened(callback: (opened: { competitionIds: string[] }) => void): Unsubscribe;
  /** Fichier → Ouvrir a choisi une archive chiffrée : nom et contenu base64 (RGPD, ADR-0021) */
  onEncryptedFileOpened(callback: (file: { name: string; content: string }) => void): Unsubscribe;
  /** Sauvegarde automatique terminée (toutes les deux minutes) */
  onAutosave(callback: (result: { ok: boolean }) => void): Unsubscribe;
  /** Épreuve affichée : « Enregistrer sous » l'exporte seule */
  setCurrentCompetition(competitionId: string | null): void;

  // Fenêtre et langue
  /** `force` : préréglage explicite → sort du maximisé / plein écran ; sinon ignoré si maximisée */
  setWindowSize(width: number, height: number, options?: { force?: boolean }): Promise<void>;
  /** Langue choisie sur l'écran de démarrage, injectée avant le chargement de l'écran */
  readonly initialLanguage: string | null;
  /** Reconstruit le menu natif dans la langue de l'écran */
  notifyLanguageChanged(lang: string): void;

  // Impression native (boîte de dialogue de l'application)
  printDialog: DesktopPrintDialog;

  /**
   * Choix d'un dossier du poste : chemin absolu, ou null si annulé. Seule méthode qui rend un
   * chemin ; n'écrit rien : l'écran l'envoie ensuite à une commande du contrat (setBackupDir,
   * setCompetitionBackupDir, addAgentFolder).
   */
  pickDirectory(request?: { title?: string }): Promise<string | null>;
}
