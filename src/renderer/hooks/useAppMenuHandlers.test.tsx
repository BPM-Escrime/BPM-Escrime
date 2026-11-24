// @vitest-environment jsdom
/**
 * useAppMenuHandlers (#1897, ADR-0030) : abonnement unique, handlers à jour, désabonnement
 * ciblé ; sans bureau (navigateur, vue DT) : aucun abonnement, aucune erreur.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAppMenuHandlers, type AppMenuHandlers } from './useAppMenuHandlers';
import { PlatformProvider } from '../platform/PlatformContext';
import { fakeDesktop, fakePlatform, type FakeDesktop } from '../../shared/platform/testing';

const handlers = (over: Partial<AppMenuHandlers> = {}): AppMenuHandlers => ({
  onNewCompetition: vi.fn(),
  onReportIssue: vi.fn(),
  onAbout: vi.fn(),
  onOpenSettings: vi.fn(),
  reloadCompetitions: vi.fn(),
  openImportedCompetition: vi.fn(),
  showToast: vi.fn(),
  ...over,
});

const wrapper = (desktop?: FakeDesktop) => {
  const platform = fakePlatform({ desktop });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <PlatformProvider platform={platform}>{children}</PlatformProvider>;
  };
};

describe('useAppMenuHandlers', () => {
  it('relaie les événements vers les derniers handlers, sans réabonnement', () => {
    const desktop = fakeDesktop();
    const first = handlers();
    const { rerender } = renderHook(h => useAppMenuHandlers(h), {
      initialProps: first,
      wrapper: wrapper(desktop),
    });
    const second = handlers();
    rerender(second);
    desktop.emitMenu('newCompetition');
    desktop.emitMenu('openSettings');
    desktop.emitMenu('save');
    desktop.emitMenu('about');
    expect(first.onNewCompetition).not.toHaveBeenCalled();
    expect(second.onNewCompetition).toHaveBeenCalledOnce();
    expect(second.onOpenSettings).toHaveBeenCalledOnce();
    expect(second.onAbout).toHaveBeenCalledOnce();
    expect(second.showToast).toHaveBeenCalledWith('Sauvegarde effectuée', 'success');
    expect(desktop.onMenu.mock.calls.filter(([k]) => k === 'newCompetition')).toHaveLength(1);
  });

  it('.bpm ouvert : recharge, toast, ouvre la compétition unique', async () => {
    const desktop = fakeDesktop();
    const h = handlers();
    renderHook(() => useAppMenuHandlers(h), { wrapper: wrapper(desktop) });
    await act(async () => {
      desktop.emitCompetitionFileOpened(['c1']);
    });
    expect(h.reloadCompetitions).toHaveBeenCalled();
    expect(h.showToast).toHaveBeenCalledWith('Compétition importée', 'success');
    expect(h.openImportedCompetition).toHaveBeenCalledWith('c1');
  });

  it('archive chiffrée choisie par le menu : nom et contenu relayés à l’invite', () => {
    const desktop = fakeDesktop();
    const onEncryptedFile = vi.fn();
    renderHook(() => useAppMenuHandlers(handlers({ onEncryptedFile })), {
      wrapper: wrapper(desktop),
    });
    desktop.emitEncryptedFileOpened({ name: 'secret.bpm', content: 'QlBN' });
    expect(onEncryptedFile).toHaveBeenCalledWith('secret.bpm', 'QlBN');
  });

  it('sauvegarde automatique : avis seulement en cas d’échec', () => {
    const desktop = fakeDesktop();
    const h = handlers();
    renderHook(() => useAppMenuHandlers(h), { wrapper: wrapper(desktop) });
    desktop.emitAutosave({ ok: true });
    expect(h.showToast).not.toHaveBeenCalled();
    desktop.emitAutosave({ ok: false });
    expect(h.showToast).toHaveBeenCalledWith('Échec de la sauvegarde automatique', 'error');
  });

  it('démontage : tous les écouteurs retirés', () => {
    const desktop = fakeDesktop();
    const { unmount } = renderHook(() => useAppMenuHandlers(handlers()), {
      wrapper: wrapper(desktop),
    });
    expect(desktop.listenerCount()).toBe(8);
    unmount();
    expect(desktop.listenerCount()).toBe(0);
  });

  it('sans bureau : aucun abonnement, aucune erreur', () => {
    const { unmount } = renderHook(() => useAppMenuHandlers(handlers()), { wrapper: wrapper() });
    unmount();
  });
});
