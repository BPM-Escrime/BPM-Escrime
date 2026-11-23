/**
 * Événements simulés écrits par le contrat (replaceSimulatedMatchEvents, #1981) : match absent
 * réessayé, moteur absent sans erreur.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { BpmClient } from '../../shared/api/client';
import { ApiError } from '../../shared/api/client';
import { persistSimulatedEvents } from './simulatedEventsPersistence';

const clientWith = (call: (name: string, input: Record<string, unknown>) => Promise<unknown>) =>
  ({ call: vi.fn(call), query: vi.fn(), subscribe: vi.fn() }) as unknown as BpmClient;

afterEach(() => vi.useRealTimers());

describe('persistSimulatedEvents', () => {
  it('écrit chaque match par la commande, avec l’épreuve', async () => {
    const client = clientWith(async () => ({ found: true }));
    await persistSimulatedEvents(client, 'c1', [{ matchId: 'm1', events: null }]);
    expect(client.call).toHaveBeenCalledWith('replaceSimulatedMatchEvents', {
      competitionId: 'c1',
      matchId: 'm1',
      events: null,
    });
  });

  it('match pas encore en base : réessayé jusqu’à ce qu’il existe', async () => {
    vi.useFakeTimers();
    let n = 0;
    const client = clientWith(async () => ({ found: ++n >= 2 }));
    const done = persistSimulatedEvents(client, 'c1', [{ matchId: 'm1', events: null }]);
    await vi.runAllTimersAsync();
    await done;
    expect(client.call).toHaveBeenCalledTimes(2);
  });

  it('moteur absent (unavailable) ou sans épreuve : rien de plus', async () => {
    const client = clientWith(async () => {
      throw new ApiError('unavailable', 'hors Electron');
    });
    await persistSimulatedEvents(client, 'c1', [
      { matchId: 'm1', events: null },
      { matchId: 'm2', events: null },
    ]);
    expect(client.call).toHaveBeenCalledTimes(1);
    await persistSimulatedEvents(client, undefined, [{ matchId: 'm1', events: null }]);
    expect(client.call).toHaveBeenCalledTimes(1);
  });
});
