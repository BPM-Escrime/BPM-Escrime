// @vitest-environment jsdom
/**
 * DesktopServices (ADR-0030, #1981 lot 3a) : ElectronDesktop sur un préload simulé, absence de
 * `desktop` hors application de bureau, capabilities.updater, fausse plateforme de test.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { BrowserPlatform, ElectronDesktop, ElectronPlatform, defaultPlatform } from './platforms';
import { fakeDesktop, fakePlatform } from './testing';

function fakePreload() {
  const off = vi.fn();
  return {
    off,
    api: {
      getVersionInfo: vi.fn(async () => ({ version: '3.0.0', build: 7, date: 'd' })),
      splash: {
        getEnabled: vi.fn(async () => ({ enabled: false })),
        setEnabled: vi.fn(async (enabled: boolean) => ({ success: true, enabled })),
      },
      updater: { check: vi.fn(async () => null), setChannel: vi.fn() },
      onUpdateAvailable: vi.fn(() => off),
      onUpdateProgress: vi.fn(() => off),
    },
  };
}

afterEach(() => {
  delete (window as { electronAPI?: unknown }).electronAPI;
});

describe('ElectronDesktop', () => {
  it('chaque méthode appelle la bonne fonction du préload', async () => {
    const { api } = fakePreload();
    const d = new ElectronDesktop(() => api as never);
    await expect(d.getVersionInfo()).resolves.toMatchObject({ build: 7 });
    await expect(d.getSplashEnabled()).resolves.toBe(false);
    await expect(d.setSplashEnabled(true)).resolves.toBe(true);
    expect(api.splash.setEnabled).toHaveBeenCalledWith(true);
    expect(d.updater).toBe(api.updater);
    await d.updater.check();
    expect(api.updater.check).toHaveBeenCalledTimes(1);
  });

  it('écran de démarrage : actif par défaut sans groupe splash, erreur si non enregistré', async () => {
    const { api } = fakePreload();
    const sans = new ElectronDesktop(() => ({ ...api, splash: undefined }) as never);
    await expect(sans.getSplashEnabled()).resolves.toBe(true);
    await expect(sans.setSplashEnabled(false)).rejects.toThrow();
    api.splash.setEnabled.mockResolvedValueOnce({ success: false } as never);
    const d = new ElectronDesktop(() => api as never);
    await expect(d.setSplashEnabled(false)).rejects.toThrow();
  });

  it('abonnements : rend le désabonnement du préload, sans removeAllListeners', () => {
    const { api, off } = fakePreload();
    const d = new ElectronDesktop(() => api as never);
    const cb = vi.fn();
    const unsubAvailable = d.onUpdateAvailable(cb);
    const unsubProgress = d.onUpdateProgress(cb);
    expect(api.onUpdateAvailable).toHaveBeenCalledWith(cb);
    expect(api.onUpdateProgress).toHaveBeenCalledWith(cb);
    unsubAvailable();
    unsubProgress();
    expect(off).toHaveBeenCalledTimes(2);
  });

  it('rien n’est lu au chargement : le préload est lu à l’appel', () => {
    const accessor = vi.fn(() => fakePreload().api as never);
    const d = new ElectronDesktop(accessor);
    expect(accessor).not.toHaveBeenCalled();
    void d.updater;
    expect(accessor).toHaveBeenCalledTimes(1);
  });
});

describe('PlatformServices.desktop', () => {
  it('Electron : desktop présent et capabilities.updater vrai', () => {
    const p = new ElectronPlatform(() => fakePreload().api as never);
    expect(p.desktop).toBeInstanceOf(ElectronDesktop);
    expect(p.capabilities.updater).toBe(p.desktop !== undefined);
  });

  it('navigateur : desktop absent et capabilities.updater faux', () => {
    const p = new BrowserPlatform();
    expect(p.desktop).toBeUndefined();
    expect(p.capabilities.updater).toBe(p.desktop !== undefined);
  });

  it('plateforme par défaut : suit le préload, même objet d’un accès à l’autre', () => {
    expect(defaultPlatform.desktop).toBeUndefined();
    expect(defaultPlatform.capabilities.updater).toBe(false);
    const { api } = fakePreload();
    (window as { electronAPI?: unknown }).electronAPI = { ...api, file: {}, dialog: {} };
    const first = defaultPlatform.desktop;
    expect(first).toBeDefined();
    expect(defaultPlatform.desktop).toBe(first);
    expect(defaultPlatform.capabilities.updater).toBe(true);
  });
});

describe('fakePlatform', () => {
  it('sans desktop : navigateur', () => {
    const p = fakePlatform();
    expect(p.desktop).toBeUndefined();
    expect(p.capabilities.updater).toBe(false);
  });

  it('avec desktop : appels enregistrés, événements émis aux abonnés encore inscrits', async () => {
    const p = fakePlatform({ desktop: true });
    const desktop = p.desktop;
    expect(desktop).toBeDefined();
    expect(p.capabilities.updater).toBe(true);
    if (!desktop) return;
    const cb = vi.fn();
    const off = desktop.onUpdateAvailable(cb);
    const info = { hasUpdate: true } as never;
    desktop.emitUpdateAvailable(info);
    expect(cb).toHaveBeenCalledWith(info);
    off();
    desktop.emitUpdateAvailable(info);
    expect(cb).toHaveBeenCalledTimes(1);
    await desktop.updater.setChannel('dev');
    expect(desktop.updater.setChannel).toHaveBeenCalledWith('dev');
  });

  it('fakeDesktop : une méthode se remplace, le reste garde sa valeur par défaut', async () => {
    const d = fakeDesktop({ getSplashEnabled: vi.fn(async () => false) });
    await expect(d.getSplashEnabled()).resolves.toBe(false);
    await expect(d.updater.getAutoCheck()).resolves.toEqual({ enabled: true });
  });
});
