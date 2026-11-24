/**
 * Cartons P (t.124, docs/adr/0028 § 5 bis) : escalade, vainqueur du noir P (score, puis
 * classement), rencontre terminée, armes sans carton P, niveau de l'appareil.
 */
import { describe, expect, it } from 'vitest';
import { Weapon } from '../../types';
import {
  devicePassivityStep,
  newDevicePassivityCards,
  passivityCardFor,
  passivityTypeOf,
  type PassivityMeeting,
} from './passivityCards';

const at = new Date('2026-12-06T10:00:00.000Z');
const meeting = (over: Partial<PassivityMeeting> = {}): PassivityMeeting => ({
  matchId: 'm',
  relays: [
    { order: 1, scoreA: 3, scoreB: 1, finished: true },
    { order: 2, scoreA: 0, scoreB: 0, finished: false },
  ],
  finished: false,
  winner: null,
  rankA: 2,
  rankB: 1,
  ...over,
});
const give = (prior: number, over: Partial<PassivityMeeting> = {}, weapon = Weapon.EPEE) =>
  passivityCardFor({
    id: 'c',
    at,
    meeting: meeting(over),
    prior: (['yellow', 'red', 'black'] as const).slice(0, prior).map(type => ({ type })),
    weapon,
  });

describe('passivityCardFor', () => {
  it('escalade jaune P, rouge P, noir P ; heure et identifiant injectés', () => {
    expect(give(0)).toEqual({
      ok: true,
      card: { id: 'c', matchId: 'm', type: 'yellow', createdAt: at.toISOString() },
      winner: null,
    });
    expect(give(1)).toMatchObject({ ok: true, card: { type: 'red' }, winner: null });
    expect(give(2)).toMatchObject({
      ok: true,
      card: { type: 'black' },
      winner: { side: 'A', decide: true },
    });
    expect(give(3)).toEqual({ ok: false, code: 'match_finished' });
  });

  it('noir P à égalité : meilleur classement ; classement inconnu ou égal : draw_needs_winner', () => {
    const tie = [{ order: 1, scoreA: 2, scoreB: 2, finished: true }];
    expect(give(2, { relays: tie })).toMatchObject({ winner: { side: 'B', decide: true } });
    expect(give(2, { relays: tie, rankA: null, rankB: null })).toEqual({
      ok: false,
      code: 'draw_needs_winner',
    });
  });

  it('rencontre terminée : noir P conforme au résultat, ou décide l’égalité ; sinon refus', () => {
    const done = [{ order: 1, scoreA: 3, scoreB: 1, finished: true }];
    expect(give(2, { relays: done, finished: true, winner: 'A' })).toMatchObject({
      winner: { side: 'A', decide: false },
    });
    expect(give(2, { relays: done, finished: true, winner: 'B' })).toEqual({
      ok: false,
      code: 'match_finished',
    });
    const tie = [{ order: 1, scoreA: 1, scoreB: 1, finished: true }];
    expect(give(2, { relays: tie, finished: true, winner: null })).toMatchObject({
      winner: { side: 'B', decide: true },
    });
    expect(give(0, { relays: done, finished: true, nextMatchStarted: true })).toEqual({
      ok: false,
      code: 'match_finished',
    });
    // Décidée avant son dernier relais (exclusion, abandon)
    expect(give(0, { finished: true, winner: 'A' })).toEqual({ ok: false, code: 'match_finished' });
  });

  it('aucun carton P à cible finale − 1 des deux côtés, 44:44 (t.124.3, #2214)', () => {
    const at4444 = { target: 45, liveScore: { scoreA: 44, scoreB: 44 } };
    expect(give(0, at4444)).toEqual({ ok: false, code: 'passivity_at_last_touch' });
    expect(give(2, at4444)).toEqual({ ok: false, code: 'passivity_at_last_touch' });
    expect(give(0, { target: 45, liveScore: { scoreA: 44, scoreB: 43 } })).toMatchObject({
      ok: true,
    });
    // Sans score affiché : relais terminés + relais en cours enregistré
    const relays = [
      { order: 8, scoreA: 40, scoreB: 40, finished: true },
      { order: 9, scoreA: 4, scoreB: 4, finished: false },
    ];
    expect(give(0, { target: 45, relays })).toEqual({ ok: false, code: 'passivity_at_last_touch' });
    // Cible inconnue : permis
    expect(give(0, { liveScore: { scoreA: 44, scoreB: 44 } })).toMatchObject({ ok: true });
  });

  it('Sabre Laser et arme à la carte : pas de carton P', () => {
    expect(give(0, {}, Weapon.LASER)).toEqual({ ok: false, code: 'unsupported_format' });
    expect(give(0, {}, Weapon.CUSTOM)).toEqual({ ok: false, code: 'unsupported_format' });
    expect(give(0, {}, Weapon.SABRE)).toMatchObject({ ok: true });
  });
});

describe('cartons P de l’appareil', () => {
  it('niveau Cyrano → rang dans l’escalade, rattrapage borné', () => {
    expect(devicePassivityStep({})).toBe(0);
    expect(devicePassivityStep({ pYellow: 1 })).toBe(1);
    expect(devicePassivityStep({ pRed: 2 })).toBe(2);
    expect(devicePassivityStep({ pBlack: 1, pRed: 1 })).toBe(3);
    expect(newDevicePassivityCards(0, 2)).toBe(2);
    expect(newDevicePassivityCards(1, 3, 2)).toBe(1);
    expect(newDevicePassivityCards(2, 1)).toBe(0);
  });

  it('type rangé en table', () => {
    expect(passivityTypeOf('p_red')).toBe('red');
    expect(passivityTypeOf('red')).toBeNull();
    expect(passivityTypeOf('p_white')).toBeNull();
  });
});
