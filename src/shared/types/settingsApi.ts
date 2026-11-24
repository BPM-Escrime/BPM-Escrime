/**
 * BPM - Escrime - Dossiers de l'agent (#1880) ; ajout et retrait par le contrat (docs/adr/0030).
 * Licensed under GPL-3.0
 */
/** Dossiers où l'agent (MCP) lit et écrit ; `folders` vide = `defaults` */
export interface AgentFolders {
  folders: string[];
  /** Documents, Téléchargements, Bureau */
  defaults: string[];
}
