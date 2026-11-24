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

  it('countHtmlPages : nombre de pages, null si absent, en échec ou à zéro (#2252)', async () => {
    const { api } = fakePreload();
    const count = vi.fn(async (_html: string) => ({ success: true, pages: 4 }));
    const d = new ElectronDesktop(() => ({ ...api, file: { countHtmlPages: count } }) as never);
    await expect(d.countHtmlPages('<p>x</p>')).resolves.toBe(4);
    expect(count).toHaveBeenCalledWith('<p>x</p>');
    count.mockResolvedValueOnce({ success: false, pages: 2 });
    await expect(d.countHtmlPages('x')).resolves.toBeNull();
    count.mockResolvedValueOnce({ success: true, pages: 0 });
    await expect(d.countHtmlPages('x')).resolves.toBeNull();
    const sans = new ElectronDesktop(() => ({ ...api, file: {} }) as never);
    await expect(sans.countHtmlPages('x')).resolves.toBeNull();
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

/** Préload simulé du lot 3b : écouteurs par canal, désabonnement ciblé comme subscribe (#1894) */
function eventPreload() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const sub =
    (channel: string) =>
    (cb: (...args: unknown[]) => void): (() => void) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      const wrapper = (...args: unknown[]) => cb(...args);
      listeners.get(channel)!.add(wrapper);
      return () => void listeners.get(channel)?.delete(wrapper);
    };
  const emit = (channel: string, ...args: unknown[]) =>
    [...(listeners.get(channel) ?? [])].forEach(fn => fn(...args));
  const count = (channel: string) => listeners.get(channel)?.size ?? 0;
  let ready = false;
  const waiting: Array<() => void> = [];
  const api = {
    onMenuNewCompetition: sub('menu:new-competition'),
    onMenuSave: sub('menu:save'),
    onMenuCompetitionProperties: sub('menu:competition-properties'),
    onMenuAddFencer: sub('menu:add-fencer'),
    onMenuAddReferee: sub('menu:add-referee'),
    onMenuNextPhase: sub('menu:next-phase'),
    onMenuExport: sub('menu:export'),
    onMenuImport: sub('menu:import'),
    onMenuOpenSettings: sub('menu:open-settings'),
    onMenuReportIssue: sub('menu:report-issue'),
    onShowAbout: sub('menu:show-about'),
    onFileOpened: sub('file:opened'),
    onEncryptedFileOpened: sub('privacy:encrypted-bpm'),
    onAutosaveCompleted: sub('autosave:completed'),
    onAutosaveFailed: sub('autosave:failed'),
    whenDbReady: () =>
      ready ? Promise.resolve() : new Promise<void>(resolve => waiting.push(resolve)),
    setCurrentCompetition: vi.fn(),
    setWindowSize: vi.fn(async () => undefined),
    notifyLanguageChanged: vi.fn(),
    initialLanguage: 'de' as string | null,
    printDialog: { setHandler: vi.fn(), savePdf: vi.fn() },
  };
  const dbReady = () => {
    ready = true;
    waiting.splice(0).forEach(r => r());
  };
  return { api, emit, count, dbReady };
}

describe('ElectronDesktop : menu, fichiers, fenêtre, langue (lot 3b)', () => {
  it('onMenu : chaque action reçoit sa charge utile typée', () => {
    const { api, emit } = eventPreload();
    const d = new ElectronDesktop(() => api as never);
    const save = vi.fn();
    const exp = vi.fn();
    const imp = vi.fn();
    const about = vi.fn();
    d.onMenu('save', save);
    d.onMenu('export', exp);
    d.onMenu('import', imp);
    d.onMenu('about', about);
    emit('menu:save');
    emit('menu:export', 'csv');
    emit('menu:import', 'fff', 'liste.fff', 'contenu');
    emit('menu:show-about');
    expect(save).toHaveBeenCalledOnce();
    expect(exp).toHaveBeenCalledWith({ format: 'csv' });
    expect(imp).toHaveBeenCalledWith({ format: 'fff', name: 'liste.fff', content: 'contenu' });
    expect(about).toHaveBeenCalledOnce();
  });

  it('désabonnement : retire son écouteur seulement', () => {
    const { api, emit, count } = eventPreload();
    const d = new ElectronDesktop(() => api as never);
    const a = vi.fn();
    const b = vi.fn();
    const offA = d.onMenu('addReferee', a);
    d.onMenu('addReferee', b);
    offA();
    emit('menu:add-referee');
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledOnce();
    expect(count('menu:add-referee')).toBe(1);
  });

  it('fichiers ouverts : épreuves fusionnées, archive chiffrée (nom + contenu)', () => {
    const { api, emit } = eventPreload();
    const d = new ElectronDesktop(() => api as never);
    const opened = vi.fn();
    const encrypted = vi.fn();
    d.onCompetitionFileOpened(opened);
    d.onEncryptedFileOpened(encrypted);
    emit('file:opened', ['c1', 'c2']);
    emit('privacy:encrypted-bpm', 'secret.bpm', 'QlBN');
    expect(opened).toHaveBeenCalledWith({ competitionIds: ['c1', 'c2'] });
    expect(encrypted).toHaveBeenCalledWith({ name: 'secret.bpm', content: 'QlBN' });
  });

  it('onAutosave : réussite et échec, un seul désabonnement pour les deux', () => {
    const { api, emit, count } = eventPreload();
    const d = new ElectronDesktop(() => api as never);
    const cb = vi.fn();
    const off = d.onAutosave(cb);
    emit('autosave:completed');
    emit('autosave:failed');
    expect(cb.mock.calls).toEqual([[{ ok: true }], [{ ok: false }]]);
    off();
    expect(count('autosave:completed') + count('autosave:failed')).toBe(0);
  });

  it('whenReady : attend db:ready, puis se résout tout de suite', async () => {
    const { api, dbReady } = eventPreload();
    const d = new ElectronDesktop(() => api as never);
    let done = false;
    const pending = d.whenReady().then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    dbReady();
    await pending;
    expect(done).toBe(true);
    await expect(d.whenReady()).resolves.toBeUndefined();
  });

  it('fenêtre, épreuve courante, langue, impression : relais vers le préload', async () => {
    const { api } = eventPreload();
    const d = new ElectronDesktop(() => api as never);
    d.setCurrentCompetition('c1');
    await d.setWindowSize(800, 600, { force: true });
    d.notifyLanguageChanged('en');
    expect(api.setCurrentCompetition).toHaveBeenCalledWith('c1');
    expect(api.setWindowSize).toHaveBeenCalledWith(800, 600, { force: true });
    expect(api.notifyLanguageChanged).toHaveBeenCalledWith('en');
    expect(d.initialLanguage).toBe('de');
    expect(d.printDialog).toBe(api.printDialog);
  });
});

describe('fakeDesktop (lot 3b)', () => {
  it('émet menu, fichiers et sauvegarde aux abonnés encore inscrits', () => {
    const d = fakeDesktop();
    const imp = vi.fn();
    const off = d.onMenu('import', imp);
    d.emitMenu('import', { format: 'xml', name: 'a.cotcot', content: '<x/>' });
    expect(imp).toHaveBeenCalledWith({ format: 'xml', name: 'a.cotcot', content: '<x/>' });
    off();
    expect(d.listenerCount()).toBe(0);
  });
});

describe('pickDirectory (lot 3c, docs/adr/0030)', () => {
  it('ElectronDesktop : relais vers dialog.pickDirectory du préload, null si annulé', async () => {
    const pickDirectory = vi.fn(async () => '/home/dt/Sauvegardes' as string | null);
    const d = new ElectronDesktop(() => ({ dialog: { pickDirectory } }) as never);
    await expect(d.pickDirectory({ title: 'Dossier' })).resolves.toBe('/home/dt/Sauvegardes');
    expect(pickDirectory).toHaveBeenCalledWith({ title: 'Dossier' });
    pickDirectory.mockResolvedValueOnce(null);
    await expect(d.pickDirectory()).resolves.toBeNull();
  });

  it('fakeDesktop : annulé par défaut, remplaçable', async () => {
    await expect(fakeDesktop().pickDirectory()).resolves.toBeNull();
    const d = fakeDesktop({ pickDirectory: vi.fn(async () => '/x') });
    await expect(d.pickDirectory()).resolves.toBe('/x');
  });
});
