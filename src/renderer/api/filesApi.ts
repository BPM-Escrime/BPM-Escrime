/**
 * BellePoule Modern - Fichiers de données : appels de l'écran au contrat d'API (#1981,
 * docs/adr/0021). Sauvegarde .bpm (en clair ou chiffrée), archive de tireurs .bpf, photos ZIP,
 * sauvegarde d'un club .bpclub. Le contrat rend ou reçoit le contenu en base64 ; l'écran
 * l'enregistre ou le choisit par PlatformServices (`saveDataFile`, `openDataFile`). Remplace
 * file.exportCompetition, exportFencersArchive, importFencersArchive, exportPhotos,
 * importPhotos, privacy.exportEncryptedBpm, openEncryptedBpm et le groupe club de
 * window.electronAPI. Un refus du contrat lève ApiError (code traduisible par `errors.<code>`).
 * Licensed under GPL-3.0
 */
import { useMemo } from 'react';
import type { BpmClient } from '../../shared/api/client';
import type { DataFile } from '../../shared/api/contractFiles';
import type { FileFilter, PlatformServices } from '../../shared/platform/PlatformServices';
import { base64ToBytes, bytesToBase64 } from '../../shared/platform/binary';
import { useBpmClient } from './BpmClientContext';
import { defaultBpmClient } from './IpcClient';

export function createFilesApi(client: BpmClient) {
  const q = client.query.bind(client);
  const c = client.call.bind(client);
  return {
    competitionFile: (competitionId: string) => q('getCompetitionFile', { competitionId }),
    /** Archive chiffrée d'une épreuve, ou de toute la base (null) ; mot de passe jamais gardé */
    encryptedCompetitionFile: (competitionId: string | null, password: string) =>
      q('getEncryptedCompetitionFile', { competitionId, password }),
    openCompetitionFile: (content: string, password?: string) =>
      c('openCompetitionFile', password ? { content, password } : { content }),
    fencersArchive: (competitionId: string) => q('getFencersArchive', { competitionId }),
    importFencersArchive: (competitionId: string, content: string) =>
      c('importFencersArchive', { competitionId, content }),
    photosArchive: (competitionId: string) => q('getFencerPhotosArchive', { competitionId }),
    importPhotos: (competitionId: string, content: string) =>
      c('importFencerPhotos', { competitionId, content }),
    club: {
      importPhotos: (clubId: string, content: string) => c('importClubPhotos', { clubId, content }),
      backupFile: (clubId: string) => q('getClubBackupFile', { clubId }),
      importBackup: (content: string, replace?: boolean) =>
        c('importClubBackup', replace ? { content, replace } : { content }),
    },
  };
}

export type FilesApi = ReturnType<typeof createFilesApi>;

/** API des fichiers de données de l'écran, sur le client du contrat */
export function useFilesApi(): FilesApi {
  const client = useBpmClient();
  return useMemo(() => createFilesApi(client), [client]);
}

/** API des fichiers hors React : client par défaut */
export const filesApi: FilesApi = createFilesApi(defaultBpmClient);

/** Enregistre un fichier rendu par le contrat (octets) ; false si l'utilisateur annule */
export function saveDataFile(
  platform: PlatformServices,
  file: DataFile,
  options: { filters: FileFilter[]; title?: string }
): Promise<boolean> {
  return platform.saveFile({
    suggestedName: file.fileName,
    filters: options.filters,
    content: base64ToBytes(file.content),
    ...(options.title ? { title: options.title } : {}),
  });
}

/** Choisit un fichier de données ; nom et contenu base64 pour le contrat, null si annulé */
export async function openDataFile(
  platform: PlatformServices,
  options: { filters: FileFilter[]; title?: string }
): Promise<{ name: string; content: string } | null> {
  const file = await platform.openBinaryFile(options);
  return file ? { name: file.name, content: bytesToBase64(file.bytes) } : null;
}

/** Filtres des dialogues des fichiers de données */
export const DATA_FILE_FILTERS = {
  bpm: [{ name: 'BellePoule', extensions: ['bpm'] }],
  bpf: [{ name: 'BellePoule Fencers', extensions: ['bpf'] }],
  zip: [{ name: 'Archive ZIP', extensions: ['zip'] }],
} satisfies Record<string, FileFilter[]>;

/** Sauvegarde .bpm d'une épreuve : contenu par le contrat, puis « Enregistrer sous » */
export async function saveCompetitionFile(
  api: FilesApi,
  platform: PlatformServices,
  competitionId: string,
  title?: string
): Promise<boolean> {
  const file = await api.competitionFile(competitionId);
  return saveDataFile(platform, file, { filters: DATA_FILE_FILTERS.bpm, title });
}
