/**
 * BellePoule Modern - Fournisseur des services du poste (#1981 lot 4, ADR-0021)
 * Les composants appellent usePlatform() au lieu de window.electronAPI.dialog / file / openExternal.
 * Interface et implémentations : src/shared/platform (partagées avec les exports PDF).
 * Licensed under GPL-3.0
 */
import React, { createContext, useContext } from 'react';
import type { PlatformServices } from '../../shared/platform/PlatformServices';
import { defaultPlatform } from '../../shared/platform/platforms';

export { defaultPlatform };

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
