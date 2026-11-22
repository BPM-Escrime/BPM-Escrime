// @vitest-environment jsdom
/**
 * PlatformServices (ADR-0021) : enregistrer un fichier par son contenu, dans Electron (dialogue
 * natif puis écriture, comportement d'avant) et dans un navigateur (téléchargement).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { BrowserPlatform, ElectronPlatform, detectPlatform } from './platforms';
import { defaultPlatform } from './PlatformContext';

const request = {
  suggestedName: 'tireurs.csv',
  filters: [{ name: 'CSV', extensions: ['csv'] }],
  content: 'NOM;PRENOM',
  title: 'Exporter',
};

function fakeElectron(result: unknown) {
  return {
    dialog: { saveFile: vi.fn(async () => result) },
    file: { writeContent: vi.fn(async () => undefined) },
  };
}

afterEach(() => {
  delete (window as { electronAPI?: unknown }).electronAPI;
  vi.restoreAllMocks();
});

describe('ElectronPlatform', () => {
  it('dialogue natif puis écriture du contenu au chemin choisi', async () => {
    const api = fakeElectron({ filePath: '/tmp/tireurs.csv', success: true });
    const p = new ElectronPlatform(() => api as never);
    await expect(p.saveFile(request)).resolves.toBe(true);
    expect(api.dialog.saveFile).toHaveBeenCalledWith({
      title: 'Exporter',
      defaultPath: 'tireurs.csv',
      filters: request.filters,
    });
    expect(api.file.writeContent).toHaveBeenCalledWith('/tmp/tireurs.csv', 'NOM;PRENOM');
  });

  it('annulation : false, rien n’est écrit', async () => {
    for (const result of [null, { canceled: true, filePath: '', success: false }]) {
      const api = fakeElectron(result);
      const p = new ElectronPlatform(() => api as never);
      await expect(p.saveFile(request)).resolves.toBe(false);
      expect(api.file.writeContent).not.toHaveBeenCalled();
    }
  });
});

describe('BrowserPlatform', () => {
  it('téléchargement : lien Blob au nom proposé, URL libérée', async () => {
    const created = vi.fn(() => 'blob:fichier');
    const revoked = vi.fn();
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: revoked });
    const clicks: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      clicks.push(this);
    });
    vi.useFakeTimers();
    await expect(new BrowserPlatform().saveFile(request)).resolves.toBe(true);
    expect(clicks).toHaveLength(1);
    expect(clicks[0].download).toBe('tireurs.csv');
    expect(clicks[0].getAttribute('href')).toBe('blob:fichier');
    expect(document.querySelector('a[download]')).toBeNull();
    const blob = (created.mock.calls[0] as unknown as [Blob])[0];
    expect(await blob.text()).toBe('NOM;PRENOM');
    vi.runAllTimers();
    expect(revoked).toHaveBeenCalledWith('blob:fichier');
    vi.useRealTimers();
    expect(new BrowserPlatform().capabilities).toEqual({
      nativeDialogs: false,
      printToPdf: false,
      updater: false,
    });
  });
});

describe('détection', () => {
  it('Electron si le préload est là, navigateur sinon ; défaut résolu à chaque appel', async () => {
    expect(detectPlatform()).toBeInstanceOf(BrowserPlatform);
    expect(defaultPlatform.capabilities.nativeDialogs).toBe(false);
    const api = fakeElectron({ filePath: '/tmp/a.csv', success: true });
    (window as { electronAPI?: unknown }).electronAPI = api;
    expect(detectPlatform()).toBeInstanceOf(ElectronPlatform);
    expect(defaultPlatform.capabilities.nativeDialogs).toBe(true);
    await defaultPlatform.saveFile(request);
    expect(api.file.writeContent).toHaveBeenCalledWith('/tmp/a.csv', 'NOM;PRENOM');
  });
});
