// @vitest-environment jsdom
/**
 * Tests du plan des pistes (#1501) : carte, store lu et écrit par le contrat (docs/adr/0015),
 * reprise unique des clés locales des versions précédentes
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, renderHook, waitFor } from '@testing-library/react';
import { StripPlanCard } from './StripPlanCard';
import {
  migrateLocalStripPlan,
  useStripAvailability,
  useStripPlan,
} from '../../hooks/useStripAvailability';
import { BpmClientProvider } from '../../api/BpmClientContext';
import type { BpmClient } from '../../../shared/api/client';
import { availableStrips, stripAtIndex } from '../../../shared/utils/stripRange';
import { computePoolStrips } from '../../../shared/utils/poolStrips';
import { buildSessionMatches } from './sessionMatches';
import type { Pool } from '../../../shared/types';

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

type Plan = { start: number; unavailable: number[] };

/** Moteur simulé : plan par épreuve, commandes et signal strips:changed */
function fakeClient(initial: Record<string, Plan> = {}) {
  const plans = new Map(Object.entries(initial));
  const listeners: Array<(e: { type: string; competitionId?: string }) => void> = [];
  const planOf = (id: string) => ({
    competitionId: id,
    ...(plans.get(id) ?? { start: 1, unavailable: [] }),
    updatedAt: null,
  });
  const call = vi.fn(async (name: string, input: Record<string, unknown>) => {
    const id = input.competitionId as string;
    const cur = planOf(id);
    if (name === 'setStripAvailability') {
      const strip = input.strip as number;
      const unavailable = input.available
        ? cur.unavailable.filter(n => n !== strip)
        : [...new Set([...cur.unavailable, strip])].sort((a, b) => a - b);
      plans.set(id, { start: cur.start, unavailable });
    }
    if (name === 'setStripStart') {
      plans.set(id, { start: input.start as number, unavailable: cur.unavailable });
    }
    for (const l of listeners) l({ type: 'strips:changed', competitionId: id });
    return {};
  });
  const query = vi.fn(async (_name: string, input: { competitionId: string }) =>
    planOf(input.competitionId)
  );
  const client = {
    call,
    query,
    subscribe: vi.fn((_name: string, _input: unknown, cb: (e: never) => void) => {
      listeners.push(cb as never);
      return () => undefined;
    }),
  } as unknown as BpmClient;
  return { client, call, query, plans };
}

let engine: ReturnType<typeof fakeClient>;

beforeEach(() => {
  localStorage.clear();
  engine = fakeClient();
  useStripAvailability.setState({ competitionId: null, client: null, start: 1, unavailable: [] });
  useStripAvailability.getState().bind(engine.client, 'c1');
});

describe('StripPlanCard', () => {
  it('est replié par défaut puis affiche les pistes de l’intervalle', () => {
    render(<StripPlanCard start={5} end={7} />);
    expect(screen.queryByText('5')).toBeNull();
    fireEvent.click(screen.getByText(/rsm.strip_plan$/));
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.queryByText('4')).toBeNull();
  });

  it('passe une piste en indisponible par la commande du moteur, sans localStorage', async () => {
    render(<StripPlanCard start={1} end={3} />);
    fireEvent.click(screen.getByText(/rsm.strip_plan$/));
    fireEvent.click(screen.getByText('2'));
    expect(screen.getByText('2')).toHaveClass('is-unavailable');
    expect(engine.call).toHaveBeenCalledWith('setStripAvailability', {
      competitionId: 'c1',
      strip: 2,
      available: false,
    });
    await waitFor(() => expect(engine.plans.get('c1')?.unavailable).toEqual([2]));
    expect(localStorage.length).toBe(0);
    fireEvent.click(screen.getByText('2'));
    await waitFor(() => expect(screen.getByText('2')).not.toHaveClass('is-unavailable'));
    expect(engine.call).toHaveBeenLastCalledWith('setStripAvailability', {
      competitionId: 'c1',
      strip: 2,
      available: true,
    });
  });
});

describe('useStripPlan (docs/adr/0015)', () => {
  const wrapper = (client: BpmClient) =>
    function Wrapper({ children }: { children: React.ReactNode }) {
      return <BpmClientProvider client={client}>{children}</BpmClientProvider>;
    };

  it('lit le plan du moteur, puis le relit sur strips:changed (autre poste, MCP)', async () => {
    const e = fakeClient({ c2: { start: 4, unavailable: [3] } });
    const { result } = renderHook(() => useStripPlan('c2'), { wrapper: wrapper(e.client) });
    await waitFor(() => expect(result.current.start).toBe(4));
    expect(useStripAvailability.getState().unavailable).toEqual([3]);
    // Écriture faite ailleurs : le moteur change, le signal arrive
    await e.client.call('setStripAvailability', {
      competitionId: 'c2',
      strip: 6,
      available: false,
    });
    await waitFor(() => expect(useStripAvailability.getState().unavailable).toEqual([3, 6]));
  });

  it('setStart passe par setStripStart', async () => {
    const e = fakeClient();
    const { result } = renderHook(() => useStripPlan('c3'), { wrapper: wrapper(e.client) });
    await waitFor(() => expect(e.query).toHaveBeenCalled());
    result.current.setStart(5);
    await waitFor(() => expect(result.current.start).toBe(5));
    expect(e.call).toHaveBeenCalledWith('setStripStart', { competitionId: 'c3', start: 5 });
  });

  it('reprise unique : pistes et piste de départ du poste envoyées, clés effacées', async () => {
    localStorage.setItem('bellepoule-strips-unavailable-c4', '[3,4,4,"x"]');
    localStorage.setItem('bellepoule-ui-c4', JSON.stringify({ tab: 'pools', remoteStripStart: 7 }));
    const e = fakeClient({ c4: { start: 1, unavailable: [4] } });
    renderHook(() => useStripPlan('c4'), { wrapper: wrapper(e.client) });
    await waitFor(() => expect(useStripAvailability.getState().start).toBe(7));
    expect(useStripAvailability.getState().unavailable).toEqual([3, 4]);
    expect(e.call).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem('bellepoule-strips-unavailable-c4')).toBeNull();
    expect(JSON.parse(localStorage.getItem('bellepoule-ui-c4')!)).toEqual({ tab: 'pools' });
  });

  it('reprise : piste de départ déjà écrite en base gardée, ancienne clé effacée', async () => {
    localStorage.setItem('bellepoule-remote-strip-start-c5', '9');
    const e = fakeClient({ c5: { start: 2, unavailable: [] } });
    expect(await migrateLocalStripPlan(e.client, 'c5', { start: 2, unavailable: [] })).toBe(false);
    expect(e.call).not.toHaveBeenCalled();
    expect(localStorage.getItem('bellepoule-remote-strip-start-c5')).toBeNull();
  });
});

describe('répartition automatique avec pistes indisponibles', () => {
  it('availableStrips exclut les indisponibles, sans jamais renvoyer une liste vide', () => {
    expect(availableStrips(5, 8, [6, 7])).toEqual([5, 8]);
    expect(availableStrips(1, 2, [1, 2])).toEqual([1, 2]);
  });

  it('stripAtIndex tourne sur les pistes disponibles', () => {
    expect([0, 1, 2].map(i => stripAtIndex(5, 8, i, [6, 7]))).toEqual([5, 8, 5]);
  });

  it('computePoolStrips saute les pistes indisponibles', () => {
    const res = computePoolStrips(
      [
        { id: 'a', number: 1 },
        { id: 'b', number: 2 },
      ],
      6,
      5,
      [5]
    );
    expect(res.get('a')).toBe(6);
    expect(res.has('b')).toBe(false);
  });

  it('buildSessionMatches applique les pistes calculées', () => {
    const pool = { id: 'p1', number: 1, fencers: [], matches: [] } as unknown as Pool;
    const out = buildSessionMatches([pool], [], new Map([['p1', 6]]));
    expect(out.poolMatches[0]).toMatchObject({ __poolFencers: true, strip: 6 });
    expect(out.allMatches).toHaveLength(1);
  });
});
