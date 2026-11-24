/**
 * BPM - Escrime - Fonctions de l'application de bureau, hors contrat d'API (ADR-0030, #1981 lot 3a)
 * Présentes seulement quand PlatformServices.desktop existe (Electron) : absentes du navigateur de
 * développement et de la vue DT. Aucune règle métier : traduction entre le préload et l'interface.
 * Licensed under GPL-3.0
 */
import type { UpdateInfo, UpdateProgressEvent, UpdaterAPI, VersionInfo } from '../types/preload';

/** Rend la fonction qui retire l'écouteur (le sien seulement, jamais removeAllListeners, #1894) */
export type Unsubscribe = () => void;

/**
 * Mise à jour de l'application : tout le groupe `updater.*` du préload, mêmes noms.
 * Préférences (vérification automatique, canal, dossier de téléchargement) hors contrat :
 * elles ne concernent que l'application installée sur ce poste (ADR-0030).
 */
export type DesktopUpdater = UpdaterAPI;

export interface DesktopServices {
  // Version et démarrage
  getVersionInfo(): Promise<VersionInfo>;
  getSplashEnabled(): Promise<boolean>;
  /** Rend la valeur enregistrée ; erreur si le poste ne l'a pas enregistrée */
  setSplashEnabled(enabled: boolean): Promise<boolean>;

  // Mise à jour
  updater: DesktopUpdater;
  onUpdateAvailable(callback: (info: UpdateInfo) => void): Unsubscribe;
  onUpdateProgress(callback: (progress: UpdateProgressEvent) => void): Unsubscribe;
}
