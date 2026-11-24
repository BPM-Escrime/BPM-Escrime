/**
 * BPM - Escrime - Implémentations de PlatformServices (#1981 lot 4, ADR-0021)
 * ElectronPlatform : préload existant (dialogues, impression et PDF par le main), comportement
 * inchangé, aucun nouveau canal IPC. BrowserPlatform : lien Blob, <input type="file">, iframe et
 * window.print, window.open ; pas de PDF.
 * Licensed under GPL-3.0
 */
import type { ElectronAPI, UpdateInfo, UpdateProgressEvent, VersionInfo } from '../types/preload';
import type {
  DesktopPrintDialog,
  DesktopServices,
  DesktopUpdater,
  MenuEvents,
  Unsubscribe,
} from './DesktopServices';
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

/** Fonctions de bureau par le préload existant (ADR-0030) : aucun nouveau canal IPC */
export class ElectronDesktop implements DesktopServices {
  constructor(private readonly api: () => ElectronAPI) {}

  /** Groupe updater.* du préload, lu à chaque accès : rien n'est lu au chargement du module */
  get updater(): DesktopUpdater {
    return this.api().updater;
  }

  getVersionInfo(): Promise<VersionInfo> {
    return this.api().getVersionInfo();
  }

  async getSplashEnabled(): Promise<boolean> {
    const res = await this.api().splash?.getEnabled();
    // Préload sans le groupe (ancien build) : écran de démarrage actif par défaut
    return res?.enabled ?? true;
  }

  async setSplashEnabled(enabled: boolean): Promise<boolean> {
    const res = await this.api().splash?.setEnabled(enabled);
    if (!res?.success) throw new PlatformError("Échec de l'enregistrement de l'écran de démarrage");
    return res.enabled ?? enabled;
  }

  onUpdateAvailable(callback: (info: UpdateInfo) => void): Unsubscribe {
    return this.api().onUpdateAvailable(callback);
  }

  onUpdateProgress(callback: (progress: UpdateProgressEvent) => void): Unsubscribe {
    return this.api().onUpdateProgress(callback);
  }

  whenReady(): Promise<void> {
    return this.api().whenDbReady();
  }

  onMenu<K extends keyof MenuEvents>(
    kind: K,
    callback: (payload: MenuEvents[K]) => void
  ): Unsubscribe {
    const api = this.api();
    const emit = callback as (payload: unknown) => void;
    if (kind === 'export') return api.onMenuExport(format => emit({ format }));
    if (kind === 'import') {
      return api.onMenuImport((format, name, content) => emit({ format, name, content }));
    }
    return MENU_SUBSCRIBERS[kind as SimpleMenuKind](api)(() => emit(undefined));
  }

  onCompetitionFileOpened(callback: (opened: { competitionIds: string[] }) => void): Unsubscribe {
    return this.api().onFileOpened(competitionIds =>
      callback({ competitionIds: competitionIds ?? [] })
    );
  }

  onEncryptedFileOpened(callback: (file: { name: string; content: string }) => void): Unsubscribe {
    return this.api().onEncryptedFileOpened((name, content) => callback({ name, content }));
  }

  onAutosave(callback: (result: { ok: boolean }) => void): Unsubscribe {
    const api = this.api();
    const offOk = api.onAutosaveCompleted(() => callback({ ok: true }));
    const offFailed = api.onAutosaveFailed(() => callback({ ok: false }));
    return () => {
      offOk();
      offFailed();
    };
  }

  setCurrentCompetition(competitionId: string | null): void {
    this.api().setCurrentCompetition(competitionId);
  }

  setWindowSize(width: number, height: number, options?: { force?: boolean }): Promise<void> {
    return this.api().setWindowSize(width, height, options);
  }

  get initialLanguage(): string | null {
    return this.api().initialLanguage ?? null;
  }

  notifyLanguageChanged(lang: string): void {
    this.api().notifyLanguageChanged(lang);
  }

  /** Groupe printDialog.* du préload, lu à chaque accès */
  get printDialog(): DesktopPrintDialog {
    return this.api().printDialog;
  }

  async pickDirectory(request?: { title?: string }): Promise<string | null> {
    return (await this.api().dialog.pickDirectory(request)) ?? null;
  }

  async countHtmlPages(html: string): Promise<number | null> {
    const count = this.api().file?.countHtmlPages;
    if (!count) return null;
    const res = await count(html);
    return res?.success && res.pages ? res.pages : null;
  }
}

type SimpleMenuKind = Exclude<keyof MenuEvents, 'export' | 'import'>;

/** Action du menu sans charge utile → abonnement du préload */
const MENU_SUBSCRIBERS: Record<
  SimpleMenuKind,
  (api: ElectronAPI) => (callback: () => void) => Unsubscribe
> = {
  newCompetition: api => api.onMenuNewCompetition,
  save: api => api.onMenuSave,
  competitionProperties: api => api.onMenuCompetitionProperties,
  addFencer: api => api.onMenuAddFencer,
  addReferee: api => api.onMenuAddReferee,
  nextPhase: api => api.onMenuNextPhase,
  openSettings: api => api.onMenuOpenSettings,
  reportIssue: api => api.onMenuReportIssue,
  about: api => api.onShowAbout,
};

export class ElectronPlatform implements PlatformServices {
  readonly capabilities = { nativeDialogs: true, printToPdf: true, updater: true };
  readonly desktop: DesktopServices;

  constructor(private readonly api: () => ElectronAPI) {
    this.desktop = new ElectronDesktop(api);
  }

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

  async openBinaryFiles(request: OpenFileRequest): Promise<OpenedBinaryFile[] | null> {
    const result = await this.api().dialog.openFile({
      ...(request.title ? { title: request.title } : {}),
      filters: request.filters,
      properties: ['openFile', 'multiSelections'],
      binary: true,
    });
    const files =
      result?.files ?? (result?.bytes ? [{ filePath: result.filePath, bytes: result.bytes }] : []);
    if (files.length === 0) return null;
    return files.map(f => ({ name: baseName(f.filePath), bytes: f.bytes }));
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
  /** Pas de fonctions de bureau dans le navigateur ni dans la vue DT (ADR-0030) */
  readonly desktop = undefined;

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

  async openBinaryFiles(request: OpenFileRequest): Promise<OpenedBinaryFile[] | null> {
    const files = await this.pick(request, file => Promise.resolve(file), true);
    if (!files) return null;
    return Promise.all(
      files.map(async file => ({
        name: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      }))
    );
  }

  /** Choix d'un fichier par <input type="file"> ; null si annulé */
  private pick<T>(request: OpenFileRequest, read: (file: File) => Promise<T>): Promise<T | null>;
  private pick<T>(
    request: OpenFileRequest,
    read: (file: File) => Promise<T>,
    multiple: true
  ): Promise<T[] | null>;
  private pick<T>(
    request: OpenFileRequest,
    read: (file: File) => Promise<T>,
    multiple = false
  ): Promise<T | T[] | null> {
    return new Promise((resolve, reject) => {
      const input = this.doc.createElement('input');
      input.type = 'file';
      input.multiple = multiple;
      input.accept = request.filters
        .flatMap(f => f.extensions)
        .filter(e => e !== '*')
        .map(e => `.${e}`)
        .join(',');
      input.addEventListener('change', () => {
        const chosen = Array.from(input.files ?? []);
        if (chosen.length === 0) return resolve(null);
        if (multiple) return void Promise.all(chosen.map(read)).then(resolve, reject);
        read(chosen[0]).then(resolve, reject);
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

/** Plateforme Electron du dernier préload vu : `desktop` garde la même identité (effets React) */
let electronCache: { api: ElectronAPI; platform: ElectronPlatform } | null = null;

/** Electron si le préload est là, navigateur sinon (vue DT, page sans préload) */
export function detectPlatform(): PlatformServices {
  if (typeof window !== 'undefined' && (window.electronAPI?.file || window.electronAPI?.dialog)) {
    if (electronCache?.api !== window.electronAPI) {
      electronCache = {
        api: window.electronAPI,
        platform: new ElectronPlatform(() => window.electronAPI),
      };
    }
    return electronCache.platform;
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
  openBinaryFiles: request => detectPlatform().openBinaryFiles(request),
  print: html => detectPlatform().print(html),
  exportPdf: async (html, request) => {
    const p = detectPlatform();
    if (!p.exportPdf) throw new PlatformError('Export PDF indisponible dans ce mode');
    return p.exportPdf(html, request);
  },
  openExternal: url => detectPlatform().openExternal(url),
  get desktop() {
    return detectPlatform().desktop;
  },
};
