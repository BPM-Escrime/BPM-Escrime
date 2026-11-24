/**
 * BPM - Escrime - Fausse plateforme pour les tests d'écran (ADR-0030, sur le modèle de fakeApiBridge)
 * Les écrans se testent sans objet global : `<PlatformProvider platform={fakePlatform({ desktop: true })}>`.
 * Le bureau simulé enregistre les appels (vi.fn) et sait émettre un événement (menu, fichier ouvert,
 * sauvegarde automatique, mise à jour) ; `whenReady` est résolue sauf `ready: false`.
 * Importé par les tests seulement, jamais par le code de l'application.
 * Licensed under GPL-3.0
 */
import { vi, type Mock } from 'vitest';
import type { UpdateInfo, UpdateProgressEvent, VersionInfo } from '../types/preload';
import type {
  DesktopPrintDialog,
  DesktopServices,
  DesktopUpdater,
  MenuEvents,
} from './DesktopServices';
import type { PlatformServices } from './PlatformServices';

export const FAKE_VERSION: VersionInfo = { version: '1.0.0', build: 1, date: '2026-01-01' };

type Mocked<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? Mock<(...args: A) => R> : T[K];
};

export interface FakeDesktop extends Omit<DesktopServices, 'updater' | 'printDialog'> {
  updater: Mocked<DesktopUpdater>;
  printDialog: Mocked<DesktopPrintDialog>;
  getVersionInfo: Mock<DesktopServices['getVersionInfo']>;
  getSplashEnabled: Mock<DesktopServices['getSplashEnabled']>;
  setSplashEnabled: Mock<DesktopServices['setSplashEnabled']>;
  onUpdateAvailable: Mock<DesktopServices['onUpdateAvailable']>;
  onUpdateProgress: Mock<DesktopServices['onUpdateProgress']>;
  whenReady: Mock<DesktopServices['whenReady']>;
  onMenu: Mock<DesktopServices['onMenu']>;
  onCompetitionFileOpened: Mock<DesktopServices['onCompetitionFileOpened']>;
  onEncryptedFileOpened: Mock<DesktopServices['onEncryptedFileOpened']>;
  onAutosave: Mock<DesktopServices['onAutosave']>;
  setCurrentCompetition: Mock<DesktopServices['setCurrentCompetition']>;
  setWindowSize: Mock<DesktopServices['setWindowSize']>;
  notifyLanguageChanged: Mock<DesktopServices['notifyLanguageChanged']>;
  /** Choix d'un dossier : null (annulé) par défaut ; `pickDirectory.mockResolvedValue('/x')` */
  pickDirectory: Mock<DesktopServices['pickDirectory']>;
  /** Appelle les abonnés de onMenu(kind) encore inscrits */
  emitMenu<K extends keyof MenuEvents>(kind: K, ...payload: MenuPayload<K>): void;
  emitCompetitionFileOpened(competitionIds: string[]): void;
  emitEncryptedFileOpened(file: { name: string; content: string }): void;
  emitAutosave(result: { ok: boolean }): void;
  /** Nombre d'abonnés encore inscrits (tous événements) : 0 après démontage */
  listenerCount(): number;
  /** Appelle les abonnés de onUpdateAvailable encore inscrits */
  emitUpdateAvailable(info: UpdateInfo): void;
  /** Appelle les abonnés de onUpdateProgress encore inscrits */
  emitUpdateProgress(progress: UpdateProgressEvent): void;
}

type MenuPayload<K extends keyof MenuEvents> = MenuEvents[K] extends void ? [] : [MenuEvents[K]];

function fakePrintDialog(): Mocked<DesktopPrintDialog> {
  return {
    getPrinters: vi.fn(async () => []),
    render: vi.fn(async () => ({ success: true, data: new Uint8Array() })),
    execute: vi.fn(async () => ({ success: true })),
    savePdf: vi.fn(async () => ({ success: true })),
    systemDialog: vi.fn(async () => ({ success: true })),
    setHandler: vi.fn(),
  };
}

/** Abonnés d'un événement simulé : on(cb) rend le désabonnement, emit(x) les appelle */
function channel<T>() {
  const set = new Set<(payload: T) => void>();
  return {
    set,
    on: (cb: (payload: T) => void) => {
      set.add(cb);
      return () => void set.delete(cb);
    },
    emit: (payload: T) => [...set].forEach(cb => cb(payload)),
  };
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
  over: Partial<Omit<FakeDesktop, 'updater' | 'printDialog'>> & {
    updater?: Partial<Mocked<DesktopUpdater>>;
    printDialog?: Partial<Mocked<DesktopPrintDialog>>;
  } = {}
): FakeDesktop {
  const available = new Set<(info: UpdateInfo) => void>();
  const progress = new Set<(p: UpdateProgressEvent) => void>();
  const menus = new Map<keyof MenuEvents, ReturnType<typeof channel<unknown>>>();
  const menu = (kind: keyof MenuEvents) => {
    if (!menus.has(kind)) menus.set(kind, channel<unknown>());
    return menus.get(kind)!;
  };
  const opened = channel<{ competitionIds: string[] }>();
  const encrypted = channel<{ name: string; content: string }>();
  const autosave = channel<{ ok: boolean }>();
  const { updater: updaterOver, printDialog: printOver, ...rest } = over;
  return {
    whenReady: vi.fn(async () => undefined),
    onMenu: vi.fn((kind, cb) => menu(kind).on(cb as (p: unknown) => void)) as FakeDesktop['onMenu'],
    onCompetitionFileOpened: vi.fn(opened.on),
    onEncryptedFileOpened: vi.fn(encrypted.on),
    onAutosave: vi.fn(autosave.on),
    setCurrentCompetition: vi.fn(),
    setWindowSize: vi.fn(async () => undefined),
    initialLanguage: null,
    notifyLanguageChanged: vi.fn(),
    pickDirectory: vi.fn(async () => null),
    emitMenu: (kind, ...payload) => menu(kind).emit(payload[0]),
    emitCompetitionFileOpened: competitionIds => opened.emit({ competitionIds }),
    emitEncryptedFileOpened: opened_ => encrypted.emit(opened_),
    emitAutosave: autosave.emit,
    listenerCount: () =>
      [...menus.values()].reduce((n, c) => n + c.set.size, 0) +
      opened.set.size +
      encrypted.set.size +
      autosave.set.size +
      available.size +
      progress.size,
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
    printDialog: { ...fakePrintDialog(), ...printOver },
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
