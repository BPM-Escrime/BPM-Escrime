// @vitest-environment jsdom
/**
 * PlatformServices (ADR-0021) : enregistrer un fichier par son contenu, dans Electron (dialogue
 * natif puis écriture, comportement d'avant) et dans un navigateur (téléchargement).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { BrowserPlatform, ElectronPlatform, detectPlatform } from './platforms';
import { defaultPlatform } from './platforms';
import type { PlatformServices } from './PlatformServices';

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

describe('ouvrir, imprimer, PDF, liens (ADR-0021)', () => {
  it('Electron : ouvrir rend le nom seul et le contenu ; annulé → null', async () => {
    const openFile = vi
      .fn()
      .mockResolvedValueOnce({ filePath: 'C:\\exports\\tireurs.fff', content: 'X' })
      .mockResolvedValueOnce(null);
    const p = new ElectronPlatform(() => ({ dialog: { openFile } }) as never);
    const filters = [{ name: 'FFF', extensions: ['fff'] }];
    await expect(p.openFile({ filters, title: 'Importer' })).resolves.toEqual({
      name: 'tireurs.fff',
      content: 'X',
    });
    expect(openFile).toHaveBeenCalledWith({ title: 'Importer', filters, properties: ['openFile'] });
    await expect(p.openFile({ filters })).resolves.toBeNull();
  });

  it('Electron : impression et PDF, cause du main gardée en détail', async () => {
    const printHtml = vi
      .fn()
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, error: 'imprimante' });
    const printHtmlToPDF = vi.fn().mockResolvedValue({ success: true });
    const saveFile = vi
      .fn()
      .mockResolvedValueOnce({ filePath: '/tmp/r.pdf', success: true })
      .mockResolvedValueOnce({ canceled: true, filePath: '', success: false });
    const openExternal = vi.fn();
    const p = new ElectronPlatform(
      () => ({ file: { printHtml, printHtmlToPDF }, dialog: { saveFile }, openExternal }) as never
    );
    await p.print('<html>a</html>');
    await expect(p.print('<html>b</html>')).rejects.toMatchObject({ detail: 'imprimante' });
    await expect(p.exportPdf('<html/>', { suggestedName: 'r.pdf' })).resolves.toBe(true);
    expect(printHtmlToPDF).toHaveBeenCalledWith('<html/>', '/tmp/r.pdf');
    await expect(p.exportPdf('<html/>', { suggestedName: 'r.pdf' })).resolves.toBe(false);
    expect(printHtmlToPDF).toHaveBeenCalledTimes(1);
    p.openExternal('https://example.org');
    expect(openExternal).toHaveBeenCalledWith('https://example.org');
  });

  it('navigateur : choix de fichier lu en texte, annulation, pas de PDF, lien dans un onglet', async () => {
    const p = new BrowserPlatform();
    const inputs: HTMLInputElement[] = [];
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
      this: HTMLInputElement
    ) {
      inputs.push(this);
    });
    const opened = p.openFile({ filters: [{ name: 'CSV', extensions: ['csv', '*'] }] });
    const input = inputs[0];
    expect(input.accept).toBe('.csv');
    const file = new File(['NOM;PRENOM'], 'liste.csv');
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    await expect(opened).resolves.toEqual({ name: 'liste.csv', content: 'NOM;PRENOM' });

    const canceled = p.openFile({ filters: [] });
    inputs[1].dispatchEvent(new Event('cancel'));
    await expect(canceled).resolves.toBeNull();

    expect((p as PlatformServices).exportPdf).toBeUndefined();
    await expect(defaultPlatform.exportPdf!('<html/>', { suggestedName: 'x.pdf' })).rejects.toThrow(
      'Export PDF indisponible'
    );
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    p.openExternal('https://example.org');
    expect(open).toHaveBeenCalledWith('https://example.org', '_blank', 'noopener');
  });

  it('navigateur : impression par une iframe retirée ensuite', async () => {
    const p = new BrowserPlatform();
    const printing = p.print('<html><body>Feuille</body></html>');
    const frame = document.querySelector('iframe')!;
    expect(frame.getAttribute('srcdoc')).toContain('Feuille');
    const print = vi.fn();
    Object.defineProperty(frame, 'contentWindow', { value: { focus: vi.fn(), print } });
    frame.dispatchEvent(new Event('load'));
    await printing;
    expect(print).toHaveBeenCalled();
    await new Promise(r => setTimeout(r, 0));
    expect(document.querySelector('iframe')).toBeNull();
  });
});

describe('fichiers binaires (fichiers de données du contrat, ADR-0021)', () => {
  it('Electron : octets écrits tels quels ; ouverture binaire par le dialogue natif', async () => {
    const api = fakeElectron({ filePath: '/tmp/a.bpm', success: true });
    const openFile = vi
      .fn()
      .mockResolvedValueOnce({ filePath: '/x/a.bpf', bytes: new Uint8Array([1, 2]) })
      .mockResolvedValueOnce(null);
    const p = new ElectronPlatform(
      () => ({ ...api, dialog: { ...api.dialog, openFile } }) as never
    );
    const bytes = new Uint8Array([0, 255]);
    await p.saveFile({ suggestedName: 'a.bpm', filters: [], content: bytes });
    expect(api.file.writeContent).toHaveBeenCalledWith('/tmp/a.bpm', bytes);
    const filters = [{ name: 'BPF', extensions: ['bpf'] }];
    await expect(p.openBinaryFile({ filters })).resolves.toEqual({
      name: 'a.bpf',
      bytes: new Uint8Array([1, 2]),
    });
    expect(openFile).toHaveBeenCalledWith({ filters, properties: ['openFile'], binary: true });
    await expect(p.openBinaryFile({ filters })).resolves.toBeNull();
  });

  it('navigateur : téléchargement en octets bruts, fichier lu en octets', async () => {
    const created = vi.fn((_b: Blob) => 'blob:x');
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const p = new BrowserPlatform();
    await p.saveFile({ suggestedName: 'a.zip', filters: [], content: new Uint8Array([80, 75]) });
    const blob = created.mock.calls[0][0];
    expect(blob.type).toBe('application/octet-stream');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([80, 75]));

    const inputs: HTMLInputElement[] = [];
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
      this: HTMLInputElement
    ) {
      inputs.push(this);
    });
    const opened = p.openBinaryFile({ filters: [{ name: 'ZIP', extensions: ['zip'] }] });
    Object.defineProperty(inputs[0], 'files', {
      value: [new File([new Uint8Array([9, 8])], 'p.zip')],
    });
    inputs[0].dispatchEvent(new Event('change'));
    await expect(opened).resolves.toEqual({ name: 'p.zip', bytes: new Uint8Array([9, 8]) });
  });
});
