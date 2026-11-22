/**
 * Appareils de piste de la salle (docs/adr/0023) : lecture des déclarations, salle d'une
 * épreuve, appareils effectifs et pistes manuelles, tables des pilotes.
 */
import { describe, expect, it } from 'vitest';
import {
  driverTables,
  effectiveStripDevices,
  normalizeManualStrips,
  resolveVenue,
  toStripDevice,
} from './stripDevices';

describe('toStripDevice', () => {
  it('ancienne configuration Cyrano : protocol devient version', () => {
    expect(
      toStripDevice({ ip: '10.0.0.2', port: 50100, protocol: 'EFP1.1', mode: 'display', piste: 2 })
    ).toEqual({
      protocol: 'cyrano',
      ip: '10.0.0.2',
      port: 50100,
      version: 'EFP1.1',
      mode: 'display',
    });
    expect(toStripDevice({ ip: '10.0.0.3' })).toEqual({ protocol: 'cyrano', ip: '10.0.0.3' });
  });

  it('déclaration Cyrano et OPP2 ; champs invalides écartés', () => {
    expect(
      toStripDevice({ protocol: 'cyrano', ip: ' 1.2.3.4 ', port: 0, version: 'EFP9', arena: 3 })
    ).toEqual({ protocol: 'cyrano', ip: '1.2.3.4', arena: 3 });
    expect(toStripDevice({ protocol: 'opp2', opp2Id: 'rouge', mode: 'master' })).toEqual({
      protocol: 'opp2',
      opp2Id: 'rouge',
      mode: 'master',
    });
    expect(toStripDevice({ protocol: 'opp2' })).toEqual({ protocol: 'opp2' });
  });

  it('Cyrano sans adresse, valeur non objet : null', () => {
    expect(toStripDevice({ protocol: 'cyrano', port: 50100 })).toBeNull();
    expect(toStripDevice(null)).toBeNull();
    expect(toStripDevice('x')).toBeNull();
    expect(toStripDevice([1])).toBeNull();
  });
});

describe('normalizeManualStrips', () => {
  it('entiers 1…100, sans doublon, triés', () => {
    expect(normalizeManualStrips([3, 1, 3, 0, 101, 2.5, '4'])).toEqual([1, 3]);
    expect(normalizeManualStrips(undefined)).toEqual([]);
  });
});

describe('resolveVenue', () => {
  const venues = new Set(['own', 'day', 'def']);
  const exists = (id: string) => venues.has(id);

  it('salle de l’épreuve, puis de la journée, puis par défaut', () => {
    expect(
      resolveVenue({ competitionVenueId: 'own', dayVenueId: 'day', defaultVenueId: 'def' }, exists)
    ).toEqual({ venueId: 'own', source: 'competition' });
    expect(resolveVenue({ dayVenueId: 'day', defaultVenueId: 'def' }, exists)).toEqual({
      venueId: 'day',
      source: 'day',
    });
    expect(resolveVenue({ defaultVenueId: 'def' }, exists)).toEqual({
      venueId: 'def',
      source: 'default',
    });
  });

  it('salle disparue sautée ; aucune salle : null', () => {
    expect(resolveVenue({ competitionVenueId: 'gone', defaultVenueId: 'def' }, exists)).toEqual({
      venueId: 'def',
      source: 'default',
    });
    expect(resolveVenue({}, exists)).toBeNull();
  });
});

describe('effectiveStripDevices', () => {
  const strips = [
    { number: 2, label: 'Bleue', deviceConfig: { protocol: 'opp2', opp2Id: 'bleue' } },
    { number: 1, deviceConfig: { protocol: 'cyrano', ip: '10.0.0.1', arena: 5 } },
    { number: 3 },
    { number: 4, deviceConfig: { protocol: 'cyrano' } },
  ];

  it('pistes déclarant un appareil valide, arène par défaut = numéro de piste', () => {
    expect(effectiveStripDevices(strips)).toEqual([
      {
        strip: 1,
        device: { protocol: 'cyrano', ip: '10.0.0.1', arena: 5 },
        arena: 5,
        piste: '1',
        manual: false,
      },
      {
        strip: 2,
        label: 'Bleue',
        device: { protocol: 'opp2', opp2Id: 'bleue' },
        arena: 2,
        piste: 'bleue',
        manual: false,
      },
    ]);
  });

  it('pistes manuelles de l’épreuve marquées', () => {
    expect(effectiveStripDevices(strips, [2]).map(d => [d.strip, d.manual])).toEqual([
      [1, false],
      [2, true],
    ]);
  });
});

describe('driverTables', () => {
  it('sépare Cyrano et OPP2, première déclaration d’une piste gardée', () => {
    const a = effectiveStripDevices([
      { number: 1, deviceConfig: { ip: '10.0.0.1', protocol: 'EFP1', mode: 'master' } },
      { number: 2, deviceConfig: { protocol: 'opp2' } },
    ]);
    const b = effectiveStripDevices([{ number: 1, deviceConfig: { ip: '10.9.9.9' } }]);
    expect(driverTables([...a, ...b])).toEqual({
      cyrano: [{ piste: '1', ip: '10.0.0.1', arena: 1, protocol: 'EFP1', mode: 'master' }],
      opp2: [{ piste: '2', arena: 2 }],
      strips: { '1': 1, '2': 2 },
    });
  });
});
