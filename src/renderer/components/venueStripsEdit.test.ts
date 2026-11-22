/**
 * Édition des pistes d'une salle (#1880, docs/adr/0023) : validation IPv4 / port et
 * application des saisies (appareil Cyrano ou OPP2 déclaré sur la piste).
 */
import { describe, it, expect } from 'vitest';
import {
  applyStripEdits,
  isIpv4,
  isValidPort,
  stripEditError,
  stripToEdit,
  type StripEdit,
} from './venueStripsEdit';

const edit = (patch: Partial<StripEdit> = {}): StripEdit => ({
  label: '',
  protocol: 'cyrano',
  ip: '',
  port: '',
  mode: 'master',
  version: 'auto',
  opp2Id: '',
  ...patch,
});

describe('validation', () => {
  it('IPv4', () => {
    expect(isIpv4('192.168.1.5')).toBe(true);
    expect(isIpv4(' 10.0.0.1 ')).toBe(true);
    for (const bad of ['', '256.1.1.1', '1.2.3', '1.2.3.4.5', 'abc', '1.2.3.-4'])
      expect(isIpv4(bad)).toBe(false);
  });

  it('port facultatif entre 1 et 65535', () => {
    for (const ok of ['', ' ', '1', '50100', '65535']) expect(isValidPort(ok)).toBe(true);
    for (const bad of ['0', '65536', '-1', '12.5', 'abc']) expect(isValidPort(bad)).toBe(false);
  });

  it('erreur : IP saisie invalide ou port invalide ; IP vide acceptée', () => {
    expect(stripEditError(edit())).toBe(false);
    expect(stripEditError(edit({ ip: '1.2.3.4', port: '50100' }))).toBe(false);
    expect(stripEditError(edit({ ip: '1.2.3' }))).toBe(true);
    expect(stripEditError(edit({ ip: '1.2.3.4', port: '99999' }))).toBe(true);
    // OPP2 : l'adresse Cyrano saisie avant n'est pas jugée
    expect(stripEditError(edit({ protocol: 'opp2', ip: '1.2.3' }))).toBe(false);
  });
});

describe('stripToEdit', () => {
  it('relit libellé et appareil, Cyrano maître par défaut', () => {
    expect(stripToEdit({ number: 1 })).toEqual(edit());
    expect(
      stripToEdit({
        number: 2,
        label: 'Bleue',
        deviceConfig: {
          protocol: 'cyrano',
          ip: '10.0.0.2',
          port: 50100,
          mode: 'display',
          version: 'EFP1',
        },
      })
    ).toEqual(
      edit({ label: 'Bleue', ip: '10.0.0.2', port: '50100', mode: 'display', version: 'EFP1' })
    );
    expect(stripToEdit({ number: 3, deviceConfig: { protocol: 'opp2', opp2Id: 'rouge' } })).toEqual(
      edit({ protocol: 'opp2', opp2Id: 'rouge' })
    );
  });
});

describe('applyStripEdits', () => {
  it('ne touche pas aux pistes non modifiées', () => {
    const strips = [{ number: 1, label: 'A' }, { number: 2 }];
    expect(applyStripEdits(strips, {})).toEqual(strips);
  });

  it('pose libellé et appareil, garde l’arène', () => {
    const strips = [
      {
        number: 1,
        deviceConfig: { protocol: 'cyrano' as const, ip: '1.1.1.1', port: 1, arena: 3 },
      },
    ];
    expect(
      applyStripEdits(strips, {
        1: edit({ label: ' Rouge ', ip: '10.0.0.9', mode: 'manual', version: 'EFP1' }),
      })
    ).toEqual([
      {
        number: 1,
        label: 'Rouge',
        deviceConfig: {
          protocol: 'cyrano',
          ip: '10.0.0.9',
          version: 'EFP1',
          mode: 'manual',
          arena: 3,
        },
      },
    ]);
  });

  it('retire l’appareil sans adresse IP ou sans protocole (null), garde le libellé', () => {
    const strips = [
      { number: 1, label: 'A', deviceConfig: { protocol: 'cyrano' as const, ip: '1.1.1.1' } },
    ];
    expect(applyStripEdits(strips, { 1: edit({ label: 'A', ip: ' ', port: '9' }) })).toEqual([
      { number: 1, label: 'A', deviceConfig: null },
    ]);
    expect(
      applyStripEdits(strips, { 1: edit({ label: 'A', protocol: 'none', ip: '1.1.1.1' }) })
    ).toEqual([{ number: 1, label: 'A', deviceConfig: null }]);
  });

  it('écrit le port numérique ; OPP2 avec ou sans identifiant', () => {
    expect(applyStripEdits([{ number: 1 }], { 1: edit({ ip: '1.2.3.4', port: '50100' }) })).toEqual(
      [
        {
          number: 1,
          deviceConfig: {
            protocol: 'cyrano',
            ip: '1.2.3.4',
            port: 50100,
            version: 'auto',
            mode: 'master',
          },
        },
      ]
    );
    expect(applyStripEdits([{ number: 2 }], { 2: edit({ protocol: 'opp2' }) })).toEqual([
      { number: 2, deviceConfig: { protocol: 'opp2', mode: 'master' } },
    ]);
  });
});
