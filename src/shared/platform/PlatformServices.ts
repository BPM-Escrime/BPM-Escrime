/**
 * BPM - Escrime - Fonctions propres au poste, hors données de l'épreuve (#1981 lot 4, ADR-0021)
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
  /** Texte (écrit en UTF-8) ou octets d'un fichier de données rendu par le contrat */
  content: string | Uint8Array;
  /** Titre du dialogue (Electron seulement) */
  title?: string;
  /** Type MIME du téléchargement (navigateur) ; texte brut, ou octets bruts, par défaut */
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

/** Fichier binaire choisi (archive, sauvegarde .bpm) : octets bruts, sans décodage */
export interface OpenedBinaryFile {
  /** Nom du fichier, sans dossier */
  name: string;
  bytes: Uint8Array;
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
  /** Choix d'un fichier binaire (octets bruts) ; null si annulé */
  openBinaryFile(request: OpenFileRequest): Promise<OpenedBinaryFile | null>;
  /** Choix de plusieurs fichiers binaires (extranet fédéral, #2134) ; null si annulé */
  openBinaryFiles(request: OpenFileRequest): Promise<OpenedBinaryFile[] | null>;
  /** Imprime un document HTML complet ; erreur si l'impression échoue (annulation : pas d'erreur) */
  print(html: string): Promise<void>;
  /**
   * Enregistre le HTML en PDF ; false si annulé. Absent quand capabilities.printToPdf est faux
   * (navigateur : l'écran masque le bouton, ou propose d'imprimer).
   */
  exportPdf?(html: string, request: ExportPdfRequest): Promise<boolean>;
  openExternal(url: string): void;
}
