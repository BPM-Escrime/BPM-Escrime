/**
 * BPM - Escrime - Préload : Boîtes de dialogue fichiers et dossiers (dialog:*) (#1774, ADR-0030)
 * Licensed under GPL-3.0
 */
import { ipcRenderer } from 'electron';
import type {
  DialogAPI,
  DialogOpenOptions,
  DialogSaveOptions,
  PickDirectoryRequest,
} from '../../shared/types/preload';

export const dialogApi = {
  openFile: (options: DialogOpenOptions) => {
    if (!options || typeof options !== 'object') {
      throw new Error('Dialog options are required');
    }
    return ipcRenderer.invoke('dialog:openFile', options);
  },
  saveFile: (options: DialogSaveOptions) => {
    if (!options || typeof options !== 'object') {
      throw new Error('Dialog options are required');
    }
    return ipcRenderer.invoke('dialog:saveFile', options);
  },
  // Choix d'un dossier du poste, sans écriture (docs/adr/0030)
  pickDirectory: (request?: PickDirectoryRequest) =>
    ipcRenderer.invoke(
      'dialog:pickDirectory',
      typeof request?.title === 'string' ? { title: request.title } : {}
    ),
} satisfies DialogAPI;
