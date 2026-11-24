/**
 * Appareil OPP2 simulé (scripts/lib/opp2Device.js, #1960) contre le broker intégré (TCP réel)
 * et le pilote OPP2 : match reçu, touches, fin, ACK, NEXT, débranchement. Testé ici car Vitest
 * ne couvre que src/.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MqttBroker } from './mqttBroker';
import { Opp2PisteDriver } from './driver';
import type { PisteDisplay, PisteInput, PisteState } from '../piste/types';
const { Opp2Device } = require('../../../scripts/lib/opp2Device.js');

type Device = {
  start(): Promise<void>;
  stop(): void;
  unplug(): void;
  command(c: string): boolean;
  client: unknown;
  snapshot(): {
    protocol: string;
    state: string;
    general: { match: string; weapon: string; type: string };
    right: { id: string; name: string; nat: string; score: number; p: number };
    left: { id: string; name: string; nat: string; score: number };
    slot: { label: string; bouts: number; done: number } | null;
  };
};

const DISPLAY: PisteDisplay = {
  type: 'individual',
  phase: 1,
  poulTab: '2',
  match: 5,
  weapon: 'F',
  right: { id: 'uuid-right', lastName: 'Martin', firstName: 'Paul', nat: 'FRA', pRed: 1 },
  left: { id: 'uuid-left', lastName: 'Koch', firstName: 'Anna', nat: 'GER' },
};

async function until(cond: () => boolean, ms = 5000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('délai dépassé');
    await new Promise(r => setTimeout(r, 10));
  }
}

describe('appareil OPP2 simulé (scripts/lib/opp2Device.js)', () => {
  let broker: MqttBroker;
  let driver: Opp2PisteDriver;
  let device: Device;
  let inputs: PisteInput[];
  const lastState = (): PisteState | undefined => {
    const s = [...inputs].reverse().find(i => i.kind === 'state');
    return s ? (s as Extract<PisteInput, { kind: 'state' }>).state : undefined;
  };

  beforeEach(async () => {
    broker = new MqttBroker({ host: '127.0.0.1' });
    const port = await broker.start(0);
    driver = new Opp2PisteDriver(broker);
    driver.setPistes([{ piste: '3', arena: 3 }]);
    inputs = [];
    driver.on('input', i => inputs.push(i));
    driver.start();
    device = new Opp2Device({ piste: '3', broker: '127.0.0.1', brokerPort: port }) as Device;
    await device.start();
    await until(() => driver.findPiste('3')?.status === 'online');
  });

  afterEach(async () => {
    device.stop();
    driver.stop();
    await broker.stop();
  });

  it('match reçu (fencers + match + uw2f), touches, END → ACK, NEXT', async () => {
    expect(device.snapshot().protocol).toBe('OPP2');
    driver.send('3', { kind: 'display', display: DISPLAY });
    await until(() => device.snapshot().right.id === 'uuid-right');
    expect(device.snapshot()).toMatchObject({
      state: 'W',
      general: { match: '5', weapon: 'F', type: 'I' },
      right: { name: 'MARTIN Paul', nat: 'FRA', p: 2 },
      left: { id: 'uuid-left', nat: 'GER' },
    });
    // Écho `apparatus/fencers` : Id dans l'état du pilote
    await until(() => lastState()?.right?.id === 'uuid-right');

    device.command('begin');
    device.command('r+');
    device.command('r+');
    device.command('l+');
    await until(() => lastState()?.right?.score === 2 && lastState()?.left?.score === 1);
    expect(lastState()).toMatchObject({ state: 'halt', right: { pRed: 1 } });

    device.command('end');
    await until(() => lastState()?.state === 'ending');
    const ends = inputs.filter(i => i.kind === 'state' && i.state.state === 'ending').length;
    expect(ends).toBe(1);
    driver.send('3', { kind: 'ack' });
    await until(() => device.snapshot().state === 'W');

    device.command('next');
    await until(() => inputs.some(i => i.kind === 'next'));
  });

  it('créneau software/record noté ; débranchement → hors ligne', async () => {
    const f = { id: 'a', lastName: 'Martin', firstName: 'Paul' };
    driver.send('3', {
      kind: 'record',
      record: {
        slotId: 's1',
        phaseType: 'pool',
        label: 'Poule 2',
        participants: [],
        bouts: [{ id: 1, right: f, left: f, result: null }],
      },
    });
    await until(() => device.snapshot().slot !== null);
    expect(device.snapshot().slot).toMatchObject({ label: 'Poule 2', bouts: 1, done: 0 });
    device.unplug();
    await until(() => driver.findPiste('3')?.status === 'offline');
  });
});
