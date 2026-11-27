/**
 * BPM - Escrime - Aide intégrée : ouverture du wiki sur une section (#2013 F5)
 * L'application fournit `openWikiAt` (App.tsx) ; un écran de formule l'appelle avec l'article et
 * l'ancre voulus. Sans fournisseur (tests, composant isolé), `useWikiHelp` rend null et le lien
 * « ? » n'est pas affiché. Aucun canal du poste : un simple état de l'interface (ADR-0030).
 * Licensed under GPL-3.0
 */

import { createContext, useContext } from 'react';

/** Section du wiki à ouvrir : identifiant de l'article, ancre d'un titre h2 */
export interface WikiTarget {
  article: string;
  anchor?: string;
}

export type OpenWikiAt = (target: WikiTarget) => void;

const WikiHelpContext = createContext<OpenWikiAt | null>(null);

export const WikiHelpProvider = WikiHelpContext.Provider;

export const useWikiHelp = (): OpenWikiAt | null => useContext(WikiHelpContext);
