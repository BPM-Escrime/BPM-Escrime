// @vitest-environment jsdom
import '@testing-library/jest-dom';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import fs from 'fs';
import path from 'path';
import { act, fireEvent, render as renderRaw, screen } from '@testing-library/react';
import UpdateNotification from '../UpdateNotification';
import { frT } from '../../testUtils/i18nMock';
import type { UpdateProgressEvent } from '../../../shared/types/preload';
import { PlatformProvider } from '../../platform/PlatformContext';
import { fakeDesktop, fakePlatform } from '../../../shared/platform/testing';

const showToast = vi.hoisted(() => vi.fn());
vi.mock('../Toast', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../../hooks/useTranslation', () => import('../../testUtils/i18nMock'));

const INFO = {
  hasUpdate: true,
  currentBuild: 10,
  latestBuild: 12,
  latestVersion: '1.3.0',
  downloadUrl: '',
  releaseNotes: '',
};

describe('UpdateNotification — mise à jour intégrée', () => {
  let emitAvailable: (info: typeof INFO) => void;
  let emitProgress: (d: UpdateProgressEvent) => void;
  let downloadAndInstall: ReturnType<typeof vi.fn>;
  let openSpy: ReturnType<typeof vi.spyOn>;
  let desktop: ReturnType<typeof fakeDesktop>;
  const render = (ui: React.ReactElement) =>
    renderRaw(<PlatformProvider platform={fakePlatform({ desktop })}>{ui}</PlatformProvider>);

  beforeEach(() => {
    showToast.mockReset();
    downloadAndInstall = vi.fn().mockResolvedValue({ success: true });
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    desktop = fakeDesktop({ updater: { downloadAndInstall } as never });
    emitAvailable = info => desktop.emitUpdateAvailable(info);
    emitProgress = p => desktop.emitUpdateProgress(p);
  });

  it('sans bureau : aucun abonnement, rien ne s’affiche', () => {
    renderRaw(
      <PlatformProvider platform={fakePlatform()}>
        <UpdateNotification />
      </PlatformProvider>
    );
    expect(screen.queryByText(/1\.3\.0/)).not.toBeInTheDocument();
  });

  it('se désabonne au démontage (ses écouteurs seulement)', () => {
    const offAvailable = vi.fn();
    const offProgress = vi.fn();
    desktop.onUpdateAvailable.mockReturnValue(offAvailable);
    desktop.onUpdateProgress.mockReturnValue(offProgress);
    const { unmount } = render(<UpdateNotification />);
    expect(offAvailable).not.toHaveBeenCalled();
    unmount();
    expect(offAvailable).toHaveBeenCalledTimes(1);
    expect(offProgress).toHaveBeenCalledTimes(1);
  });

  it('s’affiche sur update:available et installe sans ouvrir le navigateur', async () => {
    render(<UpdateNotification />);
    expect(screen.queryByText(/1\.3\.0/)).not.toBeInTheDocument();

    act(() => emitAvailable(INFO));
    expect(screen.getByText(/v1\.3\.0/)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Installer/ }));
    });
    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('affiche la progression du téléchargement', () => {
    render(<UpdateNotification />);
    act(() => emitAvailable(INFO));
    act(() => emitProgress({ progress: 40 }));
    expect(screen.getByText(/40,0 %/)).toBeInTheDocument();
  });

  it('téléchargement lancé depuis le menu : bannière + barre de progression sans update:available', () => {
    render(<UpdateNotification />);
    act(() =>
      emitProgress({
        progress: 0,
        latestVersion: '1.3.0',
        latestBuild: 12,
        currentBuild: 10,
      })
    );
    act(() => emitProgress({ progress: 55 }));
    expect(screen.getByText(/v1\.3\.0/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '55');
  });

  it('bouton désactivé + lame affichée pendant le téléchargement', async () => {
    let finish: (v: unknown) => void = () => {};
    downloadAndInstall.mockReturnValue(new Promise(r => (finish = r)));
    render(<UpdateNotification />);
    act(() => emitAvailable(INFO));
    const btn = screen.getByRole('button', { name: /Installer/ });
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(btn).toBeDisabled();
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '0');
    fireEvent.click(btn);
    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    await act(async () => finish({ success: true }));
    expect(btn).not.toBeDisabled();
  });

  it.each([
    ['no_asset', 'updateNotif.noAsset', 'warning'],
    ['busy', 'updateNotif.busy', 'info'],
    ['updater_unavailable', 'updateNotif.failed', 'error'],
  ])('erreur %s : message explicite (plus de clic muet)', async (error, key, type) => {
    downloadAndInstall.mockResolvedValue({ success: false, error });
    render(<UpdateNotification />);
    act(() => emitAvailable(INFO));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Installer/ }));
    });
    const calls = showToast.mock.calls.map(c => [c[0], c[1]]);
    expect(calls).toContainEqual([frT(key), type]);
  });

  it('ses styles sont dans une feuille chargée (components.css)', () => {
    const css = fs.readFileSync(path.join(__dirname, '../../styles/components.css'), 'utf8');
    expect(css).toMatch(/\.update-notification \{[^}]*position: fixed/);
  });
});
