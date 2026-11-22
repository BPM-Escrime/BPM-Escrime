/**
 * BellePoule Modern - Fonctions propres au poste, hors données de l'épreuve (#1981 lot 4, ADR-0021)
 * L'écran enregistre un fichier par son contenu, jamais par un chemin : la même demande marche dans
 * Electron (dialogue natif) et dans un navigateur (téléchargement).
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
}
