// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  autoStartCyrano,
  formatCyranoLog,
  readOptions,
  writeAutoStart,
  writeHelloMode,
  writeHost,
  writePort,
} from './cyranoSettings';
import type { DevicesApi } from '../../api/devicesApi';

/** Pilotes simulés : appareils effectifs de l'épreuve (salle, docs/adr/0023) */
function fakeApi(protocols: string[]) {
  const api = {
    getCompetitionDevices: vi.fn().mockResolvedValue({
      devices: protocols.map((protocol, i) => ({ strip: i + 1, device: { protocol } })),
    }),
    cyrano: { start: vi.fn().mockResolvedValue({ port: 50101 }) },
    opp2: { start: vi.fn().mockResolvedValue({ port: 1883 }) },
    setOptions: vi.fn().mockResolvedValue(undefined),
  };
  return api as typeof api & DevicesApi;
}

describe('réglages des pilotes (#1829, docs/adr/0023)', () => {
  beforeEach(() => localStorage.clear());

  it('démarrage automatique désactivé par défaut', async () => {
    const api = fakeApi(['cyrano']);
    expect(await autoStartCyrano('c1', api)).toBe(false);
    expect(api.cyrano.start).not.toHaveBeenCalled();
  });

  it('démarrage automatique : port, interface, HELLO, épreuve et options ; OPP2 si la salle en déclare', async () => {
    writeAutoStart(true);
    writePort(50101);
    writeHost('192.168.1.10');
    writeHelloMode('always');
    const api = fakeApi(['cyrano', 'opp2']);
    expect(await autoStartCyrano('c1', api)).toBe(true);
    expect(api.getCompetitionDevices).toHaveBeenCalledWith('c1');
    expect(api.cyrano.start).toHaveBeenCalledWith({
      port: 50101,
      host: '192.168.1.10',
      hello: 'always',
      competitionId: 'c1',
    });
    expect(api.opp2.start).toHaveBeenCalledWith({ port: 1883, competitionId: 'c1' });
    expect(api.setOptions).toHaveBeenCalledWith(readOptions());
  });

  it('démarrage automatique sans appareil dans la salle : rien', async () => {
    writeAutoStart(true);
    const api = fakeApi([]);
    expect(await autoStartCyrano('c1', api)).toBe(false);
    expect(api.cyrano.start).not.toHaveBeenCalled();
    expect(api.opp2.start).not.toHaveBeenCalled();
  });

  it('journal exportable : une trame par ligne', () => {
    const text = formatCyranoLog([
      { ts: 0, dir: 'in', ip: '10.0.0.1', port: 50100, piste: '1', raw: '|EFP1.1|INFO|1|\r\n' },
      {
        ts: 1000,
        dir: 'out',
        ip: '10.0.0.9',
        port: 50100,
        piste: null,
        raw: '|x|',
        rejected: 'unknown_ip',
      },
    ]);
    expect(text.split('\n')).toEqual([
      '1970-01-01T00:00:00.000Z\tIN\t10.0.0.1:50100\t1\t|EFP1.1|INFO|1|',
      '1970-01-01T00:00:01.000Z\tOUT\t10.0.0.9:50100\t-\t|x|\tunknown_ip',
    ]);
  });
});
