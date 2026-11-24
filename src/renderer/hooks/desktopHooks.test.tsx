// @vitest-environment jsdom
/**
 * Hooks migrés vers `usePlatform().desktop` (ADR-0030, #1981 lot 3b) : avec un bureau simulé
 * (fakeDesktop) et sans bureau (navigateur, vue DT), sans objet global window.electronAPI.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { PlatformProvider } from '../platform/PlatformContext';
import { fakeDesktop, fakePlatform, type FakeDesktop } from '../../shared/platform/testing';
import { useAppGlobalEffects } from './useAppGlobalEffects';
import { usePoolsWindowSize } from './usePoolsWindowSize';
import { useMenuEvents } from './useMenuEvents';
import type { Pool } from '../../shared/types';

const wrapper = (desktop?: FakeDesktop) => {
  const platform = fakePlatform({ desktop });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <PlatformProvider platform={platform}>{children}</PlatformProvider>;
  };
};

describe('useAppGlobalEffects : chargement après whenReady', () => {
  it('bureau : attend la base, puis charge une fois', async () => {
    let open: () => void = () => {};
    const desktop = fakeDesktop({
      whenReady: vi.fn(() => new Promise<void>(resolve => (open = resolve))),
    });
    const loadCompetitions = vi.fn();
    renderHook(() => useAppGlobalEffects({ loadCompetitions, toggleCommandPalette: vi.fn() }), {
      wrapper: wrapper(desktop),
    });
    await act(async () => {});
    expect(loadCompetitions).not.toHaveBeenCalled();
    await act(async () => open());
    expect(loadCompetitions).toHaveBeenCalledOnce();
  });

  it('bureau, base déjà ouverte : charge sans délai de secours', async () => {
    const loadCompetitions = vi.fn();
    renderHook(() => useAppGlobalEffects({ loadCompetitions, toggleCommandPalette: vi.fn() }), {
      wrapper: wrapper(fakeDesktop()),
    });
    await act(async () => {});
    expect(loadCompetitions).toHaveBeenCalledOnce();
  });

  it('sans bureau : charge tout de suite', () => {
    const loadCompetitions = vi.fn();
    renderHook(() => useAppGlobalEffects({ loadCompetitions, toggleCommandPalette: vi.fn() }), {
      wrapper: wrapper(),
    });
    expect(loadCompetitions).toHaveBeenCalledOnce();
  });
});

describe('usePoolsWindowSize', () => {
  const pool = { id: 'p1', fencers: [{}, {}, {}] } as unknown as Pool;
  const params = {
    poolsViewMode: 'single' as const,
    currentPhase: 'pools' as const,
    pools: [pool],
    singlePoolIndex: 0,
    getVisibleColumns: () => ['v', 'ts'] as never,
    isLaserSabre: false,
  };

  it('bureau : ajuste la fenêtre en vue « poule unique »', () => {
    const desktop = fakeDesktop();
    renderHook(() => usePoolsWindowSize(params), { wrapper: wrapper(desktop) });
    expect(desktop.setWindowSize).toHaveBeenCalledOnce();
  });

  it('sans bureau : rien, aucune erreur', () => {
    expect(() =>
      renderHook(() => usePoolsWindowSize(params), { wrapper: wrapper() })
    ).not.toThrow();
  });
});

describe('useMenuEvents', () => {
  const props = () => ({
    currentPhase: 'checkin' as const,
    onShowProperties: vi.fn(),
    onShowAddFencer: vi.fn(),
    onExportFencers: vi.fn(),
    onExportFencersBpf: vi.fn(),
    onExportPhotos: vi.fn(),
    onExportRanking: vi.fn(),
    onExportResults: vi.fn(),
    onImport: vi.fn(),
    onNextPhase: vi.fn(),
    loadFencers: vi.fn(),
    hasPools: false,
    overallRanking: [],
    finalResults: [],
    isLaserSabre: false,
  });

  it('bureau : import (nom + contenu), export et propriétés relayés ; désabonnement', () => {
    const desktop = fakeDesktop();
    const p = props();
    const { unmount } = renderHook(() => useMenuEvents(p), { wrapper: wrapper(desktop) });
    desktop.emitMenu('import', { format: 'fff', name: 'liste.fff', content: 'x' });
    desktop.emitMenu('export', { format: 'fencers-txt' });
    desktop.emitMenu('competitionProperties');
    expect(p.onImport).toHaveBeenCalledWith('fff', 'liste.fff', 'x');
    expect(p.onExportFencers).toHaveBeenCalledWith('txt');
    expect(p.onShowProperties).toHaveBeenCalledOnce();
    unmount();
    expect(desktop.listenerCount()).toBe(0);
  });

  it('sans bureau : aucun abonnement, aucune erreur', () => {
    const p = props();
    const { result } = renderHook(() => useMenuEvents(p), { wrapper: wrapper() });
    result.current.handleExport('fencers-fff');
    expect(p.onExportFencers).toHaveBeenCalledWith('fff');
  });
});
