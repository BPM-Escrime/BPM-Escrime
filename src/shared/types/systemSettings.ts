/**
 * BPM - Escrime - Types « réglages système » : proxy réseau (contrat : getProxySettings,
 * updateProxySettings), dossiers de sauvegarde
 * Licensed under GPL-3.0
 * Extraits de preload.ts (plafond de longueur, cf. scripts/check-quality-ratchet.js).
 */

/** Proxy réseau (Paramètres → Réseau) */
export interface ProxySettingsDTO {
  mode: 'system' | 'direct' | 'manual';
  server?: string;
  bypass?: string;
}

/** Dossier de sauvegarde par défaut (Paramètres → Sauvegarde) */
export interface BackupDirDTO {
  dir: string;
  /** true : pas de réglage, dossier `<Documents>/BPM - Escrime` */
  isDefault: boolean;
}
