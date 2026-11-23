/**
 * BPM - Escrime - API preload du paramétrage du poste (#1880).
 * Licensed under GPL-3.0
 */
/** Dossiers où l'agent (MCP) lit et écrit ; `folders` vide = `defaults` */
export interface AgentFolders {
  folders: string[];
  /** Documents, Téléchargements, Bureau */
  defaults: string[];
}

/**
 * Canal IPC resté hors contrat (dialogue natif, ADR-0021) : les réglages du poste et les salles
 * passent par le contrat d'API (docs/adr/0022).
 */
export interface SettingsAPI {
  /** Ajoute un dossier choisi dans une boîte de dialogue native du main */
  addAgentFolder: () => Promise<AgentFolders>;
}
