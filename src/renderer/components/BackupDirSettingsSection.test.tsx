// @vitest-environment jsdom
/**
 * Paramètres → Sauvegarde → Dossier (#2134, docs/adr/0030) : choix par desktop.pickDirectory,
 * enregistrement par la commande setBackupDir ; bouton absent sans bureau.
 */
import '@testing-library/jest-dom';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
vi.mock('../hooks/useTranslation', () => import('../testUtils/i18nMock'));
import BackupDirSettingsSection from './BackupDirSettingsSection';
import { stationElectron } from '../testUtils/stationBridge';
import { PlatformProvider } from '../platform/PlatformContext';
import { fakeDesktop, fakePlatform, type FakeDesktop } from '../../shared/platform/testing';
import { ApiError } from '../../shared/api/client';
import { ToastProvider } from './Toast';

const DEFAULT = { dir: '/home/dt/Documents/BPM - Escrime', isDefault: true };
let backup: Record<string, ReturnType<typeof vi.fn>>;
let desktop: FakeDesktop;

beforeEach(() => {
  backup = {
    getDir: vi.fn(async () => DEFAULT),
    setDir: vi.fn(async (dir: string) => ({ dir, isDefault: false })),
    resetDir: vi.fn(async () => DEFAULT),
  };
  (window as unknown as { electronAPI: unknown }).electronAPI = stationElectron({ backup });
  desktop = fakeDesktop({ pickDirectory: vi.fn(async () => '/media/usb/Sauvegardes') });
});
afterEach(() => {
  cleanup();
  delete (window as { electronAPI?: unknown }).electronAPI;
});

const renderSection = (bureau = true) =>
  render(
    <ToastProvider>
      <PlatformProvider platform={fakePlatform({ desktop: bureau ? desktop : false })}>
        <BackupDirSettingsSection />
      </PlatformProvider>
    </ToastProvider>
  );

describe('BackupDirSettingsSection', () => {
  it('choix du dossier puis setBackupDir : chemin affiché, retour au défaut', async () => {
    renderSection();
    expect(await screen.findByTestId('backup-dir-path')).toHaveTextContent(DEFAULT.dir);
    fireEvent.click(screen.getByText('Choisir le dossier…'));
    await waitFor(() =>
      expect(screen.getByTestId('backup-dir-path')).toHaveTextContent('/media/usb/Sauvegardes')
    );
    expect(desktop.pickDirectory).toHaveBeenCalledTimes(1);
    expect(backup.setDir).toHaveBeenCalledWith('/media/usb/Sauvegardes');
    fireEvent.click(screen.getByText('Rétablir le dossier par défaut'));
    await waitFor(() =>
      expect(screen.getByTestId('backup-dir-path')).toHaveTextContent(DEFAULT.dir)
    );
  });

  it('choix annulé : rien n’est enregistré', async () => {
    desktop.pickDirectory.mockResolvedValueOnce(null);
    renderSection();
    fireEvent.click(await screen.findByText('Choisir le dossier…'));
    await waitFor(() => expect(desktop.pickDirectory).toHaveBeenCalled());
    expect(backup.setDir).not.toHaveBeenCalled();
  });

  it.each([
    ['dir_not_found', 'Dossier introuvable : /media/usb/Sauvegardes'],
    ['station_refused', "Impossible d'écrire dans ce dossier : /media/usb/Sauvegardes"],
    ['internal', "Le dossier n'a pas pu être enregistré"],
  ] as const)('refus %s (#2260) : toast d’erreur, dossier affiché inchangé', async (code, text) => {
    backup.setDir.mockRejectedValueOnce(new ApiError(code, 'refusé'));
    renderSection();
    fireEvent.click(await screen.findByText('Choisir le dossier…'));
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(screen.getByTestId('backup-dir-path')).toHaveTextContent(DEFAULT.dir);
    expect(screen.getByTestId('backup-dir-path')).not.toHaveTextContent('/media/usb');
  });

  it('succès : pas de toast d’erreur', async () => {
    renderSection();
    fireEvent.click(await screen.findByText('Choisir le dossier…'));
    await waitFor(() =>
      expect(screen.getByTestId('backup-dir-path')).toHaveTextContent('/media/usb/Sauvegardes')
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('sans bureau : dossier affiché, bouton de choix absent', async () => {
    renderSection(false);
    expect(await screen.findByTestId('backup-dir-path')).toHaveTextContent(DEFAULT.dir);
    expect(screen.queryByText('Choisir le dossier…')).not.toBeInTheDocument();
  });
});
