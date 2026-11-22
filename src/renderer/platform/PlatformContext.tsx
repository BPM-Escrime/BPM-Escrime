/**
 * BellePoule Modern - Fournisseur des services du poste (#1981 lot 4, ADR-0021)
 * Les composants appellent usePlatform() au lieu de window.electronAPI.dialog / file.
 * Licensed under GPL-3.0
 */
import React, { createContext, useContext } from 'react';
import type { PlatformServices } from './PlatformServices';
import { detectPlatform } from './platforms';

/**
 * Plateforme par défaut, résolue à chaque appel : le préload (ou son absence) est lu au moment
 * de l'action, pas au chargement du module (tests, vue DT).
 */
export const defaultPlatform: PlatformServices = {
  get capabilities() {
    return detectPlatform().capabilities;
  },
  saveFile: request => detectPlatform().saveFile(request),
};

const PlatformContext = createContext<PlatformServices>(defaultPlatform);

export function PlatformProvider({
  platform = defaultPlatform,
  children,
}: {
  platform?: PlatformServices;
  children: React.ReactNode;
}) {
  return <PlatformContext.Provider value={platform}>{children}</PlatformContext.Provider>;
}

export const usePlatform = (): PlatformServices => useContext(PlatformContext);
