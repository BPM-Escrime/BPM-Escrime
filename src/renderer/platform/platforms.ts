/**
 * BellePoule Modern - Implémentations de PlatformServices (#1981 lot 4, ADR-0021)
 * ElectronPlatform : préload existant (dialogue natif puis écriture), comportement inchangé.
 * BrowserPlatform : téléchargement par un lien Blob.
 * Licensed under GPL-3.0
 */
import type { ElectronAPI } from '../../shared/types/preload';
import type { PlatformServices, SaveFileRequest } from './PlatformServices';

export class ElectronPlatform implements PlatformServices {
  readonly capabilities = { nativeDialogs: true, printToPdf: true, updater: true };

  constructor(private readonly api: () => ElectronAPI) {}

  async saveFile(request: SaveFileRequest): Promise<boolean> {
    const api = this.api();
    const result = await api.dialog.saveFile({
      ...(request.title ? { title: request.title } : {}),
      defaultPath: request.suggestedName,
      filters: request.filters,
    });
    if (!result || result.canceled || !result.filePath) return false;
    await api.file.writeContent(result.filePath, request.content);
    return true;
  }
}

export class BrowserPlatform implements PlatformServices {
  readonly capabilities = { nativeDialogs: false, printToPdf: false, updater: false };

  constructor(private readonly doc: Document = document) {}

  async saveFile(request: SaveFileRequest): Promise<boolean> {
    const blob = new Blob([request.content], {
      type: request.mimeType ?? 'text/plain;charset=utf-8',
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
}

/** Électron si le préload est là, navigateur sinon (vue DT, tests sans préload) */
export function detectPlatform(): PlatformServices {
  if (typeof window !== 'undefined' && window.electronAPI?.dialog && window.electronAPI.file) {
    return new ElectronPlatform(() => window.electronAPI);
  }
  return new BrowserPlatform();
}
