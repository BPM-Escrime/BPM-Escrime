/**
 * BellePoule Modern - Fonctions propres au poste, hors données de l'épreuve (#1981 lot 4, ADR-0021)
 * Le code raisonne en contenu, jamais en chemin : la même demande marche dans Electron (dialogues
 * natifs, impression et PDF par le main) et dans un navigateur (téléchargement, window.print).
 * Partagé par l'écran (usePlatform) et les exports PDF de src/shared/utils (defaultPlatform).
 * Licensed under GPL-3.0
 */

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface SaveFileRequest {
  /** Nom proposé (le navigateur l'utilise tel quel) */
  suggestedName: string;
  filters: FileFilter[];
  content: string;
  /** Titre du dialogue (Electron seulement) */
  title?: string;
  /** Type MIME du téléchargement (navigateur) ; texte brut par défaut */
  mimeType?: string;
}

export interface OpenFileRequest {
  filters: FileFilter[];
  /** Titre du dialogue (Electron seulement) */
  title?: string;
}

export interface OpenedFile {
  /** Nom du fichier, sans dossier */
  name: string;
  content: string;
}

export interface ExportPdfRequest {
  suggestedName: string;
  title?: string;
}

export interface PlatformCapabilities {
  /** Dialogues natifs : l'utilisateur choisit le dossier et peut annuler */
  nativeDialogs: boolean;
  printToPdf: boolean;
  updater: boolean;
}

export interface PlatformServices {
  readonly capabilities: PlatformCapabilities;
  /** Propose d'enregistrer le fichier ; false si l'utilisateur annule */
  saveFile(request: SaveFileRequest): Promise<boolean>;
  /** Choix d'un fichier texte ; null si annulé */
  openFile(request: OpenFileRequest): Promise<OpenedFile | null>;
  /** Imprime un document HTML complet ; erreur si l'impression échoue (annulation : pas d'erreur) */
  print(html: string): Promise<void>;
  /**
   * Enregistre le HTML en PDF ; false si annulé. Absent quand capabilities.printToPdf est faux
   * (navigateur : l'écran masque le bouton, ou propose d'imprimer).
   */
  exportPdf?(html: string, request: ExportPdfRequest): Promise<boolean>;
  openExternal(url: string): void;
}
