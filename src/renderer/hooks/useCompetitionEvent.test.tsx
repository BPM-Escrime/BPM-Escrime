// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCompetitionEvent } from './useCompetitionEvent';
import { BpmClientProvider } from '../api/BpmClientContext';
import type { BpmClient } from '../../shared/api/client';

type Ev = { type: string; competitionId?: string };

function setup() {
  let handler: (e: Ev) => void = () => {};
  const unsubscribe = vi.fn();
  const subscribe = vi.fn((_name: string, _input: unknown, cb: (e: Ev) => void) => {
    handler = cb;
    return unsubscribe;
  });
  const client = { call: vi.fn(), query: vi.fn(), subscribe } as unknown as BpmClient;
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <BpmClientProvider client={client}>{children}</BpmClientProvider>
  );
  return { emit: (e: Ev) => handler(e), unsubscribe, subscribe, wrapper };
}

describe('useCompetitionEvent', () => {
  it('s’abonne par le contrat et appelle le callback pour la compétition concernée', () => {
    const { emit, subscribe, wrapper } = setup();
    const cb = vi.fn();
    renderHook(() => useCompetitionEvent('fencers:changed', 'c1', cb), { wrapper });
    expect(subscribe).toHaveBeenCalledWith(
      'onCompetitionEvents',
      { competitionId: 'c1' },
      expect.any(Function)
    );
    emit({ type: 'fencers:changed', competitionId: 'c2' });
    expect(cb).not.toHaveBeenCalled();
    emit({ type: 'fencers:changed', competitionId: 'c1' });
    emit({ type: 'fencers:changed' });
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("filtre par type : matches:changed n'active pas fencers:changed", () => {
    const { emit, wrapper } = setup();
    const fencersCb = vi.fn();
    renderHook(() => useCompetitionEvent('fencers:changed', 'c1', fencersCb), { wrapper });
    emit({ type: 'matches:changed', competitionId: 'c1' });
    expect(fencersCb).not.toHaveBeenCalled();
  });

  it('se désabonne au démontage', () => {
    const { unsubscribe, wrapper } = setup();
    const { unmount } = renderHook(() => useCompetitionEvent('fencers:changed', 'c1', () => {}), {
      wrapper,
    });
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('ne plante pas hors Electron (client sans transport)', () => {
    expect(() =>
      renderHook(() => useCompetitionEvent('fencers:changed', 'c1', () => {}))
    ).not.toThrow();
  });
});
