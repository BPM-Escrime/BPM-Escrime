// @vitest-environment jsdom
/**
 * Mode expert de l'éditeur de formule : préférence du poste par le contrat (#2013 F2, ADR-0041)
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { BpmClient } from '../../shared/api/client';
import { BpmClientProvider } from '../api/BpmClientContext';
import { useFormulaExpert } from './useFormulaExpert';

const fakeClient = (initial: boolean) => {
  let value = initial;
  const calls: Array<{ name: string; input: unknown }> = [];
  const client = {
    query: vi.fn(async (name: string) => {
      calls.push({ name, input: undefined });
      return { formulaExpert: value };
    }),
    call: vi.fn(async (name: string, input: { formulaExpert?: boolean }) => {
      calls.push({ name, input });
      if (input.formulaExpert !== undefined) value = input.formulaExpert;
      return { formulaExpert: value };
    }),
  } as unknown as BpmClient;
  return { client, calls };
};

const wrapper = (client: BpmClient) => {
  const W = ({ children }: { children: React.ReactNode }) => (
    <BpmClientProvider client={client}>{children}</BpmClientProvider>
  );
  return W;
};

afterEach(() => {
  delete (window as { electronAPI?: unknown }).electronAPI;
});

describe('useFormulaExpert', () => {
  it('hors poste : éteint, valable pour l’édition en cours seulement', () => {
    const { client } = fakeClient(true);
    const { result } = renderHook(() => useFormulaExpert(), { wrapper: wrapper(client) });
    expect(result.current.expert).toBe(false);
    act(() => result.current.setExpert(true));
    expect(result.current.expert).toBe(true);
    expect(client.query).not.toHaveBeenCalled();
    expect(client.call).not.toHaveBeenCalled();
  });

  it('au poste : lit la préférence puis l’écrit par updateStationSettings', async () => {
    (window as unknown as { electronAPI: unknown }).electronAPI = { api: {} };
    const { client, calls } = fakeClient(true);
    const { result } = renderHook(() => useFormulaExpert(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.expert).toBe(true));
    expect(calls[0].name).toBe('getStationSettings');
    act(() => result.current.setExpert(false));
    expect(result.current.expert).toBe(false);
    await waitFor(() => expect(calls.some(c => c.name === 'updateStationSettings')).toBe(true));
    expect(calls.find(c => c.name === 'updateStationSettings')?.input).toEqual({
      formulaExpert: false,
    });
  });

  it('écriture refusée : la valeur revient', async () => {
    (window as unknown as { electronAPI: unknown }).electronAPI = { api: {} };
    const { client } = fakeClient(false);
    (client.call as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('refus'));
    const { result } = renderHook(() => useFormulaExpert(), { wrapper: wrapper(client) });
    await waitFor(() => expect(client.query).toHaveBeenCalled());
    act(() => result.current.setExpert(true));
    await waitFor(() => expect(result.current.expert).toBe(false));
  });
});
