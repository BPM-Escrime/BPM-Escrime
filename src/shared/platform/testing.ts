/**
 * BPM - Escrime - Fausse plateforme pour les tests d'écran (ADR-0030, sur le modèle de fakeApiBridge)
 * Les écrans se testent sans objet global : `<PlatformProvider platform={fakePlatform({ desktop: true })}>`.
 * Le bureau simulé enregistre les appels (vi.fn) et sait émettre un événement de mise à jour.
 * Importé par les tests seulement, jamais par le code de l'application.
 * Licensed under GPL-3.0
 */
import { vi, type Mock } from 'vitest';
import type { UpdateInfo, UpdateProgressEvent, VersionInfo } from '../types/preload';
import type { DesktopServices, DesktopUpdater } from './DesktopServices';
import type { PlatformServices } from './PlatformServices';

export const FAKE_VERSION: VersionInfo = { version: '1.0.0', build: 1, date: '2026-01-01' };

type Mocked<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? Mock<(...args: A) => R> : T[K];
};

export interface FakeDesktop extends Omit<DesktopServices, 'updater'> {
  updater: Mocked<DesktopUpdater>;
  getVersionInfo: Mock<DesktopServices['getVersionInfo']>;
  getSplashEnabled: Mock<DesktopServices['getSplashEnabled']>;
  setSplashEnabled: Mock<DesktopServices['setSplashEnabled']>;
  onUpdateAvailable: Mock<DesktopServices['onUpdateAvailable']>;
  onUpdateProgress: Mock<DesktopServices['onUpdateProgress']>;
  /** Appelle les abonnés de onUpdateAvailable encore inscrits */
  emitUpdateAvailable(info: UpdateInfo): void;
  /** Appelle les abonnés de onUpdateProgress encore inscrits */
  emitUpdateProgress(progress: UpdateProgressEvent): void;
}

function fakeUpdater(): Mocked<DesktopUpdater> {
  return {
    check: vi.fn(async () => null),
    setSilentMode: vi.fn(async (silent: boolean) => ({ success: true, silent })),
    getSilentMode: vi.fn(async () => ({ silent: false })),
    hasPendingUpdate: vi.fn(async () => ({ hasPending: false })),
    getPendingUpdateInfo: vi.fn(async () => null),
    installPendingUpdate: vi.fn(async () => ({ success: true })),
    downloadAndInstall: vi.fn(async () => ({ success: true })),
    getAutoCheck: vi.fn(async () => ({ enabled: true })),
    setAutoCheck: vi.fn(async (enabled: boolean) => ({ success: true, enabled })),
    getDownloadDir: vi.fn(async () => ({
      dir: '/tmp/maj',
      defaultDir: '/tmp/maj',
      isDefault: true,
    })),
    chooseDownloadDir: vi.fn(async () => ({ success: false, canceled: true })),
    resetDownloadDir: vi.fn(async () => ({ success: true, dir: '/tmp/maj' })),
    getChannel: vi.fn(async () => ({ channel: 'stable' as const })),
    setChannel: vi.fn(async (channel: 'stable' | 'dev') => ({ success: true, channel })),
  };
}

/** Bureau simulé ; `over` remplace une méthode (ex. `{ updater: { check } }` en entier) */
export function fakeDesktop(
  over: Partial<Omit<FakeDesktop, 'updater'>> & { updater?: Partial<Mocked<DesktopUpdater>> } = {}
): FakeDesktop {
  const available = new Set<(info: UpdateInfo) => void>();
  const progress = new Set<(p: UpdateProgressEvent) => void>();
  const { updater: updaterOver, ...rest } = over;
  return {
    getVersionInfo: vi.fn(async () => FAKE_VERSION),
    getSplashEnabled: vi.fn(async () => true),
    setSplashEnabled: vi.fn(async (enabled: boolean) => enabled),
    onUpdateAvailable: vi.fn((cb: (info: UpdateInfo) => void) => {
      available.add(cb);
      return () => void available.delete(cb);
    }),
    onUpdateProgress: vi.fn((cb: (p: UpdateProgressEvent) => void) => {
      progress.add(cb);
      return () => void progress.delete(cb);
    }),
    emitUpdateAvailable: info => [...available].forEach(cb => cb(info)),
    emitUpdateProgress: p => [...progress].forEach(cb => cb(p)),
    ...rest,
    updater: { ...fakeUpdater(), ...updaterOver },
  };
}

export interface FakePlatformOptions {
  /** `true` : bureau simulé par défaut ; un FakeDesktop : celui-ci ; absent ou `false` : navigateur */
  desktop?: boolean | FakeDesktop;
  /** Remplace une méthode de la plateforme (saveFile, openExternal…) */
  over?: Partial<Omit<PlatformServices, 'desktop' | 'capabilities'>>;
}

export type FakePlatform = PlatformServices & { desktop?: FakeDesktop };

/** `capabilities.updater` vaut `desktop !== undefined`, comme sur les vraies plateformes */
export function fakePlatform({ desktop, over = {} }: FakePlatformOptions = {}): FakePlatform {
  const bureau = desktop === true ? fakeDesktop() : desktop || undefined;
  return {
    capabilities: {
      nativeDialogs: bureau !== undefined,
      printToPdf: false,
      updater: bureau !== undefined,
    },
    saveFile: vi.fn(async () => true),
    openFile: vi.fn(async () => null),
    openBinaryFile: vi.fn(async () => null),
    openBinaryFiles: vi.fn(async () => null),
    print: vi.fn(async () => undefined),
    openExternal: vi.fn(),
    ...over,
    ...(bureau ? { desktop: bureau } : {}),
  };
}
