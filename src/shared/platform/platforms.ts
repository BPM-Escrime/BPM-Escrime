/**
 * BPM - Escrime - Implémentations de PlatformServices (#1981 lot 4, ADR-0021)
 * ElectronPlatform : préload existant (dialogues, impression et PDF par le main), comportement
 * inchangé, aucun nouveau canal IPC. BrowserPlatform : lien Blob, <input type="file">, iframe et
 * window.print, window.open ; pas de PDF.
 * Licensed under GPL-3.0
 */
import type { ElectronAPI } from '../types/preload';
import type {
  ExportPdfRequest,
  OpenedBinaryFile,
  OpenedFile,
  OpenFileRequest,
  PlatformServices,
  SaveFileRequest,
} from './PlatformServices';

/** Erreur des fonctions du poste (message en français, comme les codes du catalogue) */
export class PlatformError extends Error {
  constructor(
    message: string,
    /** Cause rendue par le main (imprimante, disque…), quand il y en a une */
    public readonly detail?: string
  ) {
    super(detail ?? message);
    this.name = 'PlatformError';
  }
}

const baseName = (path: string) => path.split(/[/\\]/).pop() || path;

export class ElectronPlatform implements PlatformServices {
  readonly capabilities = { nativeDialogs: true, printToPdf: true, updater: true };

  constructor(private readonly api: () => ElectronAPI) {}

  async saveFile(request: SaveFileRequest): Promise<boolean> {
    const api = this.api();
    const path = await this.choosePath(request.suggestedName, request.filters, request.title);
    if (!path) return false;
    await api.file.writeContent(path, request.content);
    return true;
  }

  async openFile(request: OpenFileRequest): Promise<OpenedFile | null> {
    const result = await this.api().dialog.openFile({
      ...(request.title ? { title: request.title } : {}),
      filters: request.filters,
      properties: ['openFile'],
    });
    if (!result?.filePath) return null;
    return { name: baseName(result.filePath), content: result.content ?? '' };
  }

  async openBinaryFile(request: OpenFileRequest): Promise<OpenedBinaryFile | null> {
    const result = await this.api().dialog.openFile({
      ...(request.title ? { title: request.title } : {}),
      filters: request.filters,
      properties: ['openFile'],
      binary: true,
    });
    if (!result?.filePath || !result.bytes) return null;
    return { name: baseName(result.filePath), bytes: result.bytes };
  }

  async print(html: string): Promise<void> {
    const res = await this.api().file.printHtml(html);
    if (!res?.success) throw new PlatformError("Échec de l'impression", res?.error);
  }

  async exportPdf(html: string, request: ExportPdfRequest): Promise<boolean> {
    const path = await this.choosePath(
      request.suggestedName,
      [{ name: 'PDF', extensions: ['pdf'] }],
      request.title
    );
    if (!path) return false;
    const res = await this.api().file.printHtmlToPDF(html, path);
    if (res && !res.success) {
      throw new PlatformError('Échec de la génération PDF', res.error);
    }
    return true;
  }

  openExternal(url: string): void {
    void this.api().openExternal(url);
  }

  private async choosePath(
    suggestedName: string,
    filters: SaveFileRequest['filters'],
    title?: string
  ): Promise<string | null> {
    const result = await this.api().dialog.saveFile({
      ...(title ? { title } : {}),
      defaultPath: suggestedName,
      filters,
    });
    return result && !result.canceled && result.filePath ? result.filePath : null;
  }
}

export class BrowserPlatform implements PlatformServices {
  readonly capabilities = { nativeDialogs: false, printToPdf: false, updater: false };

  constructor(private readonly doc: Document = document) {}

  async saveFile(request: SaveFileRequest): Promise<boolean> {
    const binary = typeof request.content !== 'string';
    const blob = new Blob([request.content as BlobPart], {
      type: request.mimeType ?? (binary ? 'application/octet-stream' : 'text/plain;charset=utf-8'),
    });
    const url = URL.createObjectURL(blob);
    try {
      const a = this.doc.createElement('a');
      a.href = url;
      a.download = request.suggestedName;
      a.rel = 'noopener';
      this.doc.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      // Le téléchargement a lu l'URL au clic : libération au tour suivant
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
    return true;
  }

  openFile(request: OpenFileRequest): Promise<OpenedFile | null> {
    return this.pick(request, async file => ({ name: file.name, content: await file.text() }));
  }

  openBinaryFile(request: OpenFileRequest): Promise<OpenedBinaryFile | null> {
    return this.pick(request, async file => ({
      name: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    }));
  }

  /** Choix d'un fichier par <input type="file"> ; null si annulé */
  private pick<T>(request: OpenFileRequest, read: (file: File) => Promise<T>): Promise<T | null> {
    return new Promise((resolve, reject) => {
      const input = this.doc.createElement('input');
      input.type = 'file';
      input.accept = request.filters
        .flatMap(f => f.extensions)
        .filter(e => e !== '*')
        .map(e => `.${e}`)
        .join(',');
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        read(file).then(resolve, reject);
      });
      // Fenêtre fermée sans choix (navigateurs récents)
      input.addEventListener('cancel', () => resolve(null));
      input.click();
    });
  }

  print(html: string): Promise<void> {
    return new Promise(resolve => {
      const frame = this.doc.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.style.position = 'fixed';
      frame.style.width = '0';
      frame.style.height = '0';
      frame.style.border = '0';
      frame.addEventListener('load', () => {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
        // print() rend la main quand la boîte se ferme
        setTimeout(() => frame.remove(), 0);
        resolve();
      });
      frame.srcdoc = html;
      this.doc.body.appendChild(frame);
    });
  }

  openExternal(url: string): void {
    this.doc.defaultView?.open(url, '_blank', 'noopener');
  }
}

/** Electron si le préload est là, navigateur sinon (vue DT, page sans préload) */
export function detectPlatform(): PlatformServices {
  if (typeof window !== 'undefined' && (window.electronAPI?.file || window.electronAPI?.dialog)) {
    return new ElectronPlatform(() => window.electronAPI);
  }
  return new BrowserPlatform();
}

/**
 * Plateforme par défaut, résolue à chaque appel : le préload (ou son absence) est lu au moment
 * de l'action, pas au chargement du module (tests, vue DT).
 */
export const defaultPlatform: PlatformServices = {
  get capabilities() {
    return detectPlatform().capabilities;
  },
  saveFile: request => detectPlatform().saveFile(request),
  openFile: request => detectPlatform().openFile(request),
  openBinaryFile: request => detectPlatform().openBinaryFile(request),
  print: html => detectPlatform().print(html),
  exportPdf: async (html, request) => {
    const p = detectPlatform();
    if (!p.exportPdf) throw new PlatformError('Export PDF indisponible dans ce mode');
    return p.exportPdf(html, request);
  },
  openExternal: url => detectPlatform().openExternal(url),
};
