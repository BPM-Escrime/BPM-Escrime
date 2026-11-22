/**
 * Appareils de piste (#2117, docs/adr/0023) : chaque appel de l'écran donne une entrée que le
 * schéma zod de l'opération du contrat accepte, et toutes les opérations du groupe sont
 * atteignables depuis l'écran.
 */
import { describe, expect, it } from 'vitest';
import { contract, type OperationName } from '../../shared/api/contract';
import { devicesOperations } from '../../shared/api/contractDevices';
import type { ApiBridge } from '../../shared/api/client';
import { IpcClient } from './IpcClient';
import { createDevicesApi } from './devicesApi';

const seen: Array<{ name: string; error?: string }> = [];
const bridge: ApiBridge = {
  invoke: async (name, input) => {
    const def = contract[name as OperationName];
    const parsed = def?.input.safeParse(input ?? {});
    seen.push({ name, error: parsed?.success ? undefined : (parsed?.error.message ?? name) });
    return { ok: true, data: name === 'runStripDeviceAction' ? { done: true } : null };
  },
  subscribe: async () => ({ ok: true, data: null }),
  unsubscribe: () => undefined,
  onEvent: () => () => undefined,
};
const api = createDevicesApi(new IpcClient(() => bridge));

const CALLS: Array<[string, () => Promise<unknown>]> = [
  ['listVenues', () => api.listVenues()],
  ['getCompetitionDevices', () => api.getCompetitionDevices('c1')],
  ['setCompetitionVenue', () => api.setCompetitionVenue('c1', 'v1')],
  ['setCompetitionVenue (journée)', () => api.setCompetitionVenue('c1', null)],
  ['setManualStrips', () => api.setManualStrips('c1', [2, 3])],
  [
    'setStripDevice',
    () =>
      api.setStripDevice('v1', 2, {
        protocol: 'cyrano',
        ip: '10.0.0.2',
        port: 50101,
        version: 'EFP1.1',
        mode: 'master',
      }),
  ],
  ['setStripDevice (OPP2)', () => api.setStripDevice('v1', 3, { protocol: 'opp2', opp2Id: 'b' })],
  ['listStripDevices', () => api.listStripDevices('v1')],
  ['setStripDevice (retrait)', () => api.setStripDevice('v1', 2, null)],
  ['cyrano.start', () => api.cyrano.start({ port: 50100, host: '', competitionId: 'c1' })],
  ['cyrano.stop', () => api.cyrano.stop()],
  ['cyrano.status', () => api.cyrano.status()],
  ['cyrano.log', () => api.cyrano.log()],
  ['opp2.start', () => api.opp2.start({ port: 1883 })],
  ['opp2.stop', () => api.opp2.stop()],
  ['opp2.status', () => api.opp2.status()],
  ['routes', () => api.routes()],
  ['setOptions', () => api.setOptions({ nameLength: 12, natSource: 'club', international: true })],
  ['action', () => api.action('1', 'ack')],
];

describe('devicesApi : entrées du contrat', () => {
  it.each(CALLS)('%s', async (_label, call) => {
    seen.length = 0;
    await call();
    expect(seen).toHaveLength(1);
    expect(seen[0].error).toBeUndefined();
  });

  it('chaque opération des appareils est atteignable par un appel de l’écran', async () => {
    const called = new Set<string>();
    for (const [, call] of CALLS) {
      seen.length = 0;
      await call();
      called.add(seen[0].name);
    }
    expect(Object.keys(devicesOperations).filter(n => !called.has(n))).toEqual([]);
  });
});
