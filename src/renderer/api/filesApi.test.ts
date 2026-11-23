/**
 * Fichiers de données (#1981, ADR-0021) : chaque appel de l'écran donne une entrée que le
 * schéma zod du contrat accepte, toutes les opérations du groupe sont atteignables, et le
 * contenu base64 du contrat est enregistré ou lu en octets par la plateforme.
 */
import { describe, expect, it, vi } from 'vitest';
import { contract, type OperationName } from '../../shared/api/contract';
import { fileOperations } from '../../shared/api/contractFiles';
import type { ApiBridge } from '../../shared/api/client';
import type { PlatformServices } from '../../shared/platform/PlatformServices';
import { IpcClient } from './IpcClient';
import {
  DATA_FILE_FILTERS,
  createFilesApi,
  openDataFile,
  saveCompetitionFile,
  saveDataFile,
} from './filesApi';

const seen: Array<{ name: string; input: unknown; error?: string }> = [];
const bridge: ApiBridge = {
  invoke: async (name, input) => {
    const parsed = contract[name as OperationName]?.input.safeParse(input ?? {});
    seen.push({ name, input, error: parsed?.success ? undefined : parsed?.error.message });
    return { ok: true, data: { fileName: 'a.bpm', content: 'AAEC' } };
  },
  subscribe: async () => ({ ok: true, data: null }),
  unsubscribe: () => undefined,
  onEvent: () => () => undefined,
};
const api = createFilesApi(new IpcClient(() => bridge));
const B64 = 'UEsDBA==';

const CALLS: Array<[string, () => Promise<unknown>]> = [
  ['competitionFile', () => api.competitionFile('c1')],
  ['encryptedCompetitionFile', () => api.encryptedCompetitionFile('c1', 'motdepasse')],
  ['encryptedCompetitionFile (base)', () => api.encryptedCompetitionFile(null, 'motdepasse')],
  ['openCompetitionFile', () => api.openCompetitionFile(B64)],
  ['openCompetitionFile (mot de passe)', () => api.openCompetitionFile(B64, 'motdepasse')],
  ['fencersArchive', () => api.fencersArchive('c1')],
  ['importFencersArchive', () => api.importFencersArchive('c1', B64)],
  ['photosArchive', () => api.photosArchive('c1')],
  ['importPhotos', () => api.importPhotos('c1', B64)],
  ['club.importPhotos', () => api.club.importPhotos('k1', B64)],
  ['club.backupFile', () => api.club.backupFile('k1')],
  ['club.importBackup', () => api.club.importBackup(B64)],
  ['club.importBackup (remplacer)', () => api.club.importBackup(B64, true)],
];

describe('filesApi : entrées du contrat', () => {
  it.each(CALLS)('%s', async (_label, call) => {
    seen.length = 0;
    await call();
    expect(seen).toHaveLength(1);
    expect(seen[0].error).toBeUndefined();
  });

  it('toutes les opérations des fichiers de données sont appelées par l’écran', async () => {
    const used = new Set<string>();
    for (const [, call] of CALLS) {
      seen.length = 0;
      await call();
      used.add(seen[0].name);
    }
    expect(Object.keys(fileOperations).filter(n => !used.has(n))).toEqual([]);
  });

  it('pas de mot de passe vide envoyé à l’ouverture', async () => {
    seen.length = 0;
    await api.openCompetitionFile(B64, '');
    expect(seen[0].input).toEqual({ content: B64 });
  });
});

const fakePlatform = (over: Partial<PlatformServices> = {}): PlatformServices => ({
  capabilities: { nativeDialogs: true, printToPdf: false, updater: false },
  saveFile: vi.fn(async () => true),
  openFile: vi.fn(async () => null),
  openBinaryFile: vi.fn(async () => ({ name: 'a.zip', bytes: new Uint8Array([80, 75, 3, 4]) })),
  print: vi.fn(async () => undefined),
  openExternal: vi.fn(),
  ...over,
});

describe('enregistrer et ouvrir par la plateforme', () => {
  it('saveDataFile : octets décodés du base64, nom proposé par le contrat', async () => {
    const platform = fakePlatform();
    await saveDataFile(
      platform,
      { fileName: 'tireurs.bpf', content: 'AAEC' },
      { filters: DATA_FILE_FILTERS.bpf, title: 'Exporter' }
    );
    expect(platform.saveFile).toHaveBeenCalledWith({
      suggestedName: 'tireurs.bpf',
      filters: DATA_FILE_FILTERS.bpf,
      content: new Uint8Array([0, 1, 2]),
      title: 'Exporter',
    });
  });

  it('openDataFile : octets encodés en base64 ; annulé → null', async () => {
    const platform = fakePlatform();
    await expect(openDataFile(platform, { filters: DATA_FILE_FILTERS.zip })).resolves.toEqual({
      name: 'a.zip',
      content: B64,
    });
    const canceled = fakePlatform({ openBinaryFile: vi.fn(async () => null) });
    await expect(openDataFile(canceled, { filters: [] })).resolves.toBeNull();
  });

  it('saveCompetitionFile : contenu par le contrat puis « Enregistrer sous » .bpm', async () => {
    const platform = fakePlatform({ saveFile: vi.fn(async () => false) });
    seen.length = 0;
    await expect(saveCompetitionFile(api, platform, 'c1')).resolves.toBe(false);
    expect(seen[0]).toMatchObject({ name: 'getCompetitionFile', input: { competitionId: 'c1' } });
    expect(platform.saveFile).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: 'a.bpm', filters: DATA_FILE_FILTERS.bpm })
    );
  });
});
