// @vitest-environment jsdom
/**
 * Tests unitaires - useExport (exportFencersList)
 * BPM - Escrime
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useExport } from './useExport';
import { Fencer, Gender, FencerStatus, Competition } from '../../shared/types';
import { ApiError, type BpmClient } from '../../shared/api/client';
import { BpmClientProvider } from '../api/BpmClientContext';

const fencer = (id: string): Fencer => ({
  id,
  ref: Number(id),
  lastName: 'Nom' + id,
  firstName: 'P',
  gender: Gender.MALE,
  nationality: 'FRA',
  status: FencerStatus.CHECKED_IN,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const competition = { id: 'c1', title: 'Open Test' } as unknown as Competition;

let saveFile: ReturnType<typeof vi.fn>;
let writeContent: ReturnType<typeof vi.fn>;
let showToast: ReturnType<typeof vi.fn>;

beforeEach(() => {
  saveFile = vi.fn(async () => ({ canceled: false, filePath: '/tmp/out.fff' }));
  writeContent = vi.fn(async () => {});
  showToast = vi.fn();
  (window as any).electronAPI = { dialog: { saveFile }, file: { writeContent } };
});

afterEach(() => {
  delete (window as any).electronAPI;
});

const setup = () =>
  renderHook(() =>
    useExport({ competition, showToast: showToast as unknown as (m: string, t?: any) => void })
  ).result.current;

describe('exportFencersList', () => {
  it('écrit un contenu FFF et notifie le succès', async () => {
    await setup().exportFencersList([fencer('1')], 'fff');
    expect(writeContent).toHaveBeenCalledTimes(1);
    const [, content] = writeContent.mock.calls[0];
    expect(content.split('\n')[0]).toBe('FFF;WIN;COMPETITION;Open Test');
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('FFF'), 'success');
  });

  it('écrit un contenu TXT incluant le titre de la compétition', async () => {
    saveFile.mockResolvedValue({ canceled: false, filePath: '/tmp/out.txt' });
    await setup().exportFencersList([fencer('1')], 'txt');
    const [, content] = writeContent.mock.calls[0];
    expect(content).toContain('Open Test');
    expect(content).toContain('Nombre de tireurs : 1');
  });

  it('n’écrit rien si la boîte de dialogue est annulée', async () => {
    saveFile.mockResolvedValue({ canceled: true, filePath: undefined });
    await setup().exportFencersList([fencer('1')], 'fff');
    expect(writeContent).not.toHaveBeenCalled();
  });

  it('notifie une erreur si l’écriture échoue', async () => {
    writeContent.mockRejectedValue(new Error('disk full'));
    await setup().exportFencersList([fencer('1')], 'fff');
    expect(showToast).toHaveBeenCalledWith('Export des tireurs échoué', 'error');
  });
});

describe('exportResultsXML : publication par le contrat (#1981 lot 4)', () => {
  let call: ReturnType<typeof vi.fn>;
  const client = () =>
    ({ call, query: vi.fn(), subscribe: vi.fn(() => () => {}) }) as unknown as BpmClient;
  const setupWithClient = () =>
    renderHook(
      () =>
        useExport({ competition, showToast: showToast as unknown as (m: string, t?: any) => void }),
      {
        wrapper: ({ children }: { children: React.ReactNode }) => (
          <BpmClientProvider client={client()}>{children}</BpmClientProvider>
        ),
      }
    ).result.current;

  beforeEach(() => {
    call = vi.fn(async (_name: string, input: { target: unknown }) => ({
      target: typeof input.target === 'object' ? 'ftp' : 'greg',
      fileName: 'resultats_Open_Test.xml',
    }));
  });

  it('GREG : commande publishResults, sans XML ni window.electronAPI', async () => {
    await setupWithClient().exportResultsXML([], [], [], 'greg');
    expect(call).toHaveBeenCalledWith('publishResults', { competitionId: 'c1', target: 'greg' });
    expect((window as any).electronAPI.greg).toBeUndefined();
    expect(showToast).toHaveBeenCalledWith('Résultats envoyés à GREG', 'success');
  });

  it('GREG périodique : aucun toast de succès', async () => {
    await setupWithClient().exportResultsXML([], [], [], 'greg-auto');
    expect(call).toHaveBeenCalledWith('publishResults', { competitionId: 'c1', target: 'greg' });
    expect(showToast).not.toHaveBeenCalled();
  });

  it('FTP : coordonnées du dépôt transmises au moteur', async () => {
    const ftp = { url: 'ftp://ftp.club.fr/res', user: 'club', password: 'secret' };
    await setupWithClient().exportResultsXML([], [], [], { ftp });
    expect(call).toHaveBeenCalledWith('publishResults', {
      competitionId: 'c1',
      target: { ftp },
    });
    expect(showToast).toHaveBeenCalledWith('Résultats envoyés sur le serveur FTP', 'success');
  });

  it('refus du moteur : message pour l’opérateur', async () => {
    call.mockRejectedValue(new ApiError('publication_failed', 'Échec de l’envoi FTP : HTTP 503'));
    const ftp = { url: 'https://depot.club.fr/res', user: '', password: '' };
    await setupWithClient().exportResultsXML([], [], [], { ftp });
    expect(showToast).toHaveBeenCalledWith('Échec de l’envoi FTP : HTTP 503', 'error');
  });
});
