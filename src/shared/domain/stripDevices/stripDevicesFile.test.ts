/**
 * Déclaration en masse des appareils d'une salle (#2117) : profils, ajout en lot (IP
 * incrémentée), fichier d'export / d'import, ancien export du panneau Cyrano.
 */
import { describe, expect, it } from 'vitest';
import {
  buildStripDeviceBatch,
  duplicateStripLines,
  exportStripDevicesFile,
  incrementIpv4,
  readStripDevicesFile,
  venueDeclarations,
} from './stripDevicesFile';
import { toStripDevice } from './stripDevices';

describe('incrementIpv4', () => {
  it('dernier octet puis retenue ; adresse invalide ou hors plage : null', () => {
    expect(incrementIpv4('192.168.1.101', 3)).toBe('192.168.1.104');
    expect(incrementIpv4('10.0.0.254', 3)).toBe('10.0.1.1');
    expect(incrementIpv4('255.255.255.255', 1)).toBeNull();
    expect(incrementIpv4('10.0.0', 1)).toBeNull();
  });
});

describe('buildStripDeviceBatch', () => {
  it('Cyrano : IP de départ incrémentée, port, version, mode', () => {
    expect(
      buildStripDeviceBatch({
        from: 3,
        count: 2,
        protocol: 'cyrano',
        startIp: '10.0.0.10',
        port: 50101,
        version: 'EFP1.1',
        mode: 'display',
      })
    ).toEqual([
      {
        strip: 3,
        device: {
          protocol: 'cyrano',
          ip: '10.0.0.10',
          port: 50101,
          version: 'EFP1.1',
          mode: 'display',
        },
      },
      {
        strip: 4,
        device: {
          protocol: 'cyrano',
          ip: '10.0.0.11',
          port: 50101,
          version: 'EFP1.1',
          mode: 'display',
        },
      },
    ]);
  });

  it('profil Saint-George : IP déduite du numéro de piste ; sans IP : piste écartée', () => {
    expect(
      buildStripDeviceBatch({ from: 1, count: 2, protocol: 'cyrano', profile: 'saintgeorge' })
    ).toEqual([
      {
        strip: 1,
        device: { protocol: 'cyrano', ip: '192.168.1.101', port: 50101, version: 'auto' },
      },
      {
        strip: 2,
        device: { protocol: 'cyrano', ip: '192.168.1.102', port: 50101, version: 'auto' },
      },
    ]);
    expect(buildStripDeviceBatch({ from: 1, count: 2, protocol: 'cyrano' })).toEqual([]);
  });

  it('OPP2 ; plage bornée à la piste 100', () => {
    expect(buildStripDeviceBatch({ from: 99, count: 5, protocol: 'opp2' })).toEqual([
      { strip: 99, device: { protocol: 'opp2' } },
      { strip: 100, device: { protocol: 'opp2' } },
    ]);
  });
});

describe('fichier d’appareils', () => {
  it('export puis lecture : lignes numérotées', () => {
    const text = exportStripDevicesFile('Halle', [
      { strip: 1, label: 'Podium', device: { protocol: 'cyrano', ip: '10.0.0.1' } },
      { strip: 2, device: { protocol: 'opp2' } },
    ]);
    const read = readStripDevicesFile(text);
    expect(read).toEqual({
      ok: true,
      rows: [
        {
          line: 1,
          raw: { strip: 1, label: 'Podium', device: { protocol: 'cyrano', ip: '10.0.0.1' } },
        },
        { line: 2, raw: { strip: 2, device: { protocol: 'opp2' } } },
      ],
    });
  });

  it('ancien export Cyrano repris ; tableau nu accepté ; erreurs de format', () => {
    const legacy = readStripDevicesFile(
      JSON.stringify({ pistes: [{ piste: '2', ip: '1.2.3.4', arena: 5, mode: 'manual' }] })
    );
    expect(legacy).toEqual({
      ok: true,
      rows: [
        {
          line: 1,
          raw: {
            strip: 2,
            device: { protocol: 'cyrano', ip: '1.2.3.4', mode: 'manual', arena: 5 },
          },
        },
      ],
    });
    expect(readStripDevicesFile('[{"strip":1,"device":null}]')).toMatchObject({ ok: true });
    expect(readStripDevicesFile('{')).toEqual({ ok: false, error: 'invalid_json' });
    expect(readStripDevicesFile('{"a":1}')).toEqual({ ok: false, error: 'invalid_format' });
    expect(readStripDevicesFile('{"strips":[]}')).toEqual({ ok: false, error: 'empty' });
  });

  it('doublons ; déclarations d’une salle triées', () => {
    expect(
      duplicateStripLines([
        { line: 1, strip: 1 },
        { line: 2, strip: 2 },
        { line: 3, strip: 1 },
      ])
    ).toEqual([{ line: 3, strip: 1 }]);
    expect(
      venueDeclarations(
        [
          { number: 2, deviceConfig: { protocol: 'opp2' } },
          { number: 1, label: 'A', deviceConfig: null },
        ],
        toStripDevice
      )
    ).toEqual([
      { strip: 1, label: 'A', device: null },
      { strip: 2, device: { protocol: 'opp2' } },
    ]);
  });
});
