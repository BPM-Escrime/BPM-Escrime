/**
 * Pilotage de la salle hors compétition (#2117) : règles pures de sélection, d'occupation,
 * de verdict d'envoi, de fusion de l'affichage et d'accusé de réception.
 */
import { describe, expect, it } from 'vitest';
import {
  ackExpired,
  isBlankPanel,
  isEmptyRequest,
  mergeStripPanel,
  selectStrips,
  STRIP_ACK_TIMEOUT_MS,
  stripAckVerdict,
  stripOccupancy,
  stripSendOutcome,
  type CompetitionStripUse,
} from './stripControl';

const cyrano = { protocol: 'cyrano' as const, ip: '10.0.0.1' };
const devices = [
  { strip: 1, arena: 1, device: cyrano },
  { strip: 2, arena: 2, device: cyrano },
  { strip: 3, arena: 7, device: cyrano },
];

describe('selectStrips', () => {
  it('toutes : pistes déclarées ; liste : sans doublon, triée, gardée telle quelle', () => {
    expect(selectStrips(devices, 'all')).toEqual([1, 2, 3]);
    expect(selectStrips(devices, [9, 2, 2, 1])).toEqual([1, 2, 9]);
  });
});

describe('stripOccupancy', () => {
  const use = (o: Partial<CompetitionStripUse>): CompetitionStripUse => ({
    competitionId: 'c1',
    title: 'Open',
    venueId: 'v1',
    arenas: [1, 2, 3],
    manualStrips: [],
    ...o,
  });

  it('épreuve de la salle dont la séance a l’arène de la piste (arène déclarée sur l’appareil)', () => {
    const busy = stripOccupancy('v1', devices, [use({})]);
    expect([...busy.keys()]).toEqual([1, 2]);
    expect(busy.get(1)).toEqual({ competitionId: 'c1', title: 'Open' });
  });

  it('piste passée en manuel par l’épreuve : libre ; autre salle : ignorée', () => {
    expect([...stripOccupancy('v1', devices, [use({ manualStrips: [1] })]).keys()]).toEqual([2]);
    expect(stripOccupancy('v1', devices, [use({ venueId: 'v2' })]).size).toBe(0);
    expect(stripOccupancy('v1', devices, [use({ venueId: null })]).size).toBe(0);
  });

  it('deux épreuves : la piste manuelle de l’une reste occupée par l’autre', () => {
    const busy = stripOccupancy('v1', devices, [
      use({ manualStrips: [1] }),
      use({ competitionId: 'c2', title: 'B', arenas: [1] }),
    ]);
    expect(busy.get(1)?.competitionId).toBe('c2');
  });
});

describe('stripSendOutcome', () => {
  const device = { device: cyrano };
  it('ordre : non déclarée, occupée, indisponible, hors ligne, envoyée', () => {
    expect(stripSendOutcome({ link: 'online' })).toBe('not_declared');
    expect(stripSendOutcome({ device, link: null, busy: { competitionId: 'c', title: 't' } })).toBe(
      'busy'
    );
    expect(stripSendOutcome({ device, link: null })).toBe('unavailable');
    expect(stripSendOutcome({ device, link: 'offline' })).toBe('offline');
    for (const link of ['online', 'stale', 'never'] as const)
      expect(stripSendOutcome({ device, link })).toBe('sent');
  });
});

describe('mergeStripPanel', () => {
  const prev = {
    weapon: 'E' as const,
    left: { name: 'Dupont', nat: 'FRA' },
    right: { name: 'Rossi' },
  };

  it('champ absent : inchangé ; chaîne vide : effacé ; espaces réduits', () => {
    expect(mergeStripPanel(prev, { weapon: 'S' })).toEqual({ ...prev, weapon: 'S' });
    expect(mergeStripPanel(prev, { left: { nat: '' }, right: { name: '  Sato   Ken ' } })).toEqual({
      weapon: 'E',
      left: { name: 'Dupont' },
      right: { name: 'Sato Ken' },
    });
    expect(mergeStripPanel(prev, { right: { name: '' } })).toEqual({
      weapon: 'E',
      left: prev.left,
    });
  });

  it('remise à blanc : repart de rien, puis applique la même demande', () => {
    expect(mergeStripPanel(prev, { clear: true })).toEqual({});
    expect(mergeStripPanel(prev, { clear: true, weapon: 'F' })).toEqual({ weapon: 'F' });
    expect(mergeStripPanel(undefined, { left: { name: 'A' } })).toEqual({ left: { name: 'A' } });
  });

  it('affichage vide, demande vide', () => {
    expect(isBlankPanel({})).toBe(true);
    expect(isBlankPanel({ weapon: 'E' })).toBe(false);
    expect(isEmptyRequest({})).toBe(true);
    expect(isEmptyRequest({ left: {} })).toBe(true);
    expect(isEmptyRequest({ left: { nat: '' } })).toBe(false);
    expect(isEmptyRequest({ clear: true })).toBe(false);
  });
});

describe('stripAckVerdict', () => {
  const expected = { weapon: 'S', left: 'DUPONT L', right: 'ROSSI G', clear: false };

  it('noms et arme renvoyés : reçu (casse et espaces ignorés)', () => {
    expect(
      stripAckVerdict(expected, { active: false, weapon: 'S', left: 'dupont  l', right: 'ROSSI G' })
    ).toBe('acked');
    // Arme non renvoyée par le protocole (OPP2) : les noms suffisent
    expect(stripAckVerdict(expected, { left: 'DUPONT L', right: 'ROSSI G' })).toBe('acked');
  });

  it('appareil en plein combat sans l’affichage : refusé ; au repos : on attend', () => {
    const old = { weapon: 'E', left: 'X', right: 'Y' };
    expect(stripAckVerdict(expected, { ...old, active: true })).toBe('refused');
    expect(stripAckVerdict(expected, { ...old, active: false })).toBeNull();
    expect(
      stripAckVerdict(expected, { weapon: 'E', left: 'DUPONT L', right: 'ROSSI G' })
    ).toBeNull();
  });

  it('morceau sans nom ni arme : rien de conclusif ; remise à blanc : noms vides', () => {
    expect(stripAckVerdict(expected, { active: false })).toBeNull();
    expect(stripAckVerdict(expected, { active: true })).toBe('refused');
    const blank = { left: '', right: '', clear: true };
    expect(stripAckVerdict(blank, { weapon: '', left: '', right: '' })).toBe('acked');
  });

  it('délai d’attente', () => {
    expect(ackExpired(0, STRIP_ACK_TIMEOUT_MS - 1)).toBe(false);
    expect(ackExpired(0, STRIP_ACK_TIMEOUT_MS)).toBe(true);
    expect(ackExpired(100, 200, 50)).toBe(true);
  });
});
