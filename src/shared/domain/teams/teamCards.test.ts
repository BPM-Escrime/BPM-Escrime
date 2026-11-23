/**
 * Tests unitaires - cartons des épreuves par équipes (docs/adr/0028, lot D)
 * BPM - Escrime
 */

import { describe, it, expect } from 'vitest';
import {
  countTeamYellowCards,
  deviceCardCounts,
  determineTeamCardEscalation,
  newDeviceCards,
  recordedCardCounts,
  relayAcceptsCard,
  relayCardFor,
  teamCardFor,
  type MeetingCard,
  type RelayCardInput,
  type RelayCardSlot,
} from './teamCards';
import { determineTeamCardEscalation as reexported } from './teamCardEscalation';
import { TeamMatchCardRow } from './team.types';
import { CardGroup, CardReason, Weapon } from '../../types';
import { CardType } from '../penalties/penalty.types';

const AT = new Date('2026-11-23T10:00:00Z');

// ─── Carton E ───────────────────────────────────────────────────────────────

const card = (overrides: Partial<TeamMatchCardRow> = {}): TeamMatchCardRow => ({
  id: overrides.id ?? 'c',
  matchId: overrides.matchId ?? 'm',
  teamId: overrides.teamId ?? 'A',
  type: overrides.type ?? 'white',
  reason: overrides.reason ?? 'late_designation',
  createdAt: overrides.createdAt ?? AT.toISOString(),
});

describe('determineTeamCardEscalation', () => {
  it('attribue un carton blanc à la première désignation tardive de la rencontre', () => {
    expect(determineTeamCardEscalation([])).toBe('white');
  });

  it('attribue un carton jaune dès qu’un blanc a déjà été donné, même dans un autre assaut', () => {
    expect(determineTeamCardEscalation([card({ type: 'white' })])).toBe('yellow');
    expect(determineTeamCardEscalation([card({ type: 'white' }), card({ type: 'yellow' })])).toBe(
      'yellow'
    );
  });

  it('même fonction que teamCardEscalation.ts', () => {
    expect(reexported).toBe(determineTeamCardEscalation);
  });
});

describe('countTeamYellowCards', () => {
  it('compte uniquement les jaunes de l’équipe concernée', () => {
    const cards = [
      card({ teamId: 'A', type: 'white' }),
      card({ teamId: 'A', type: 'yellow' }),
      card({ teamId: 'A', type: 'yellow' }),
      card({ teamId: 'B', type: 'yellow' }),
    ];
    expect(countTeamYellowCards(cards, 'A')).toBe(2);
    expect(countTeamYellowCards(cards, 'B')).toBe(1);
  });
});

describe('teamCardFor', () => {
  const match = { matchId: 'm', teamAId: 'A', teamBId: 'B' };

  it('escalade E par équipe et par rencontre : blanc, puis jaune', () => {
    const first = teamCardFor({ id: 'e1', at: AT, match, teamId: 'A', matchCards: [] });
    expect(first).toEqual({
      ok: true,
      card: {
        id: 'e1',
        matchId: 'm',
        teamId: 'A',
        type: 'white',
        reason: 'late_designation',
        createdAt: AT.toISOString(),
      },
    });
    const cards = [card({ teamId: 'A', type: 'white' })];
    const second = teamCardFor({ id: 'e2', at: AT, match, teamId: 'A', matchCards: cards });
    expect(second.ok && second.card.type).toBe('yellow');
    // Le blanc de A ne compte ni pour B, ni pour une autre rencontre
    const other = teamCardFor({ id: 'e3', at: AT, match, teamId: 'B', matchCards: cards });
    expect(other.ok && other.card.type).toBe('white');
    const elsewhere = [card({ matchId: 'm2', teamId: 'A', type: 'white' })];
    const fresh = teamCardFor({ id: 'e4', at: AT, match, teamId: 'A', matchCards: elsewhere });
    expect(fresh.ok && fresh.card.type).toBe('white');
  });

  it('type donné par l’arbitre : retenu tel quel, noir toujours accepté (question 4)', () => {
    for (const type of ['red', 'black'] as const) {
      const r = teamCardFor({ id: 'e', at: AT, match, teamId: 'B', type, matchCards: [] });
      expect(r.ok && r.card.type).toBe(type);
    }
  });

  it('équipe hors rencontre refusée', () => {
    expect(teamCardFor({ id: 'e', at: AT, match, teamId: 'Z', matchCards: [] })).toEqual({
      ok: false,
      code: 'team_not_in_match',
    });
  });
});

// ─── Carton individuel dans un relais ───────────────────────────────────────

/** Relais FIE de 3 contre 3 : A1-B1, A2-B2, A3-B3 ; `done` relais terminés */
const relays = (done: number, started = false): RelayCardSlot[] =>
  [1, 2, 3].map(order => ({
    relayId: `r${order}`,
    order,
    fencerAId: `a${order}`,
    fencerBId: `b${order}`,
    finished: order <= done,
    started: order <= done || (order === done + 1 && started),
  }));

const input = (over: Partial<RelayCardInput> = {}): RelayCardInput => ({
  id: 'k1',
  at: AT,
  meeting: { matchId: 'm', finished: false, relays: relays(0) },
  relayId: 'r1',
  side: 'A',
  given: { reason: CardReason.FIE_BODY_CONTACT },
  meetingCards: [],
  weapon: Weapon.EPEE,
  ...over,
});

const prior = (fencerId: string, type: CardType, group: CardGroup | null): MeetingCard => ({
  fencerId,
  type,
  group,
});

describe('relayCardFor : motif, escalade sur la rencontre', () => {
  it('tireur du côté dans le relais, carton rattaché au relais, id et heure injectés', () => {
    const r = relayCardFor(input({ side: 'B' }));
    expect(r).toEqual({
      ok: true,
      card: {
        id: 'k1',
        matchId: 'm',
        relayId: 'r1',
        fencerId: 'b1',
        type: CardType.YELLOW,
        reason: CardReason.FIE_BODY_CONTACT,
        group: CardGroup.GROUP_1,
        timestamp: AT,
        pointsAwarded: 0,
        resultingExclusion: false,
      },
    });
  });

  it('cumul sur toute la rencontre, tous relais confondus (t.159), tireur par tireur', () => {
    // a1 a reçu un jaune du 1er groupe au relais 1 et revient en piste au relais 3
    const meeting = {
      matchId: 'm',
      finished: false,
      relays: [
        { relayId: 'r1', order: 1, fencerAId: 'a1', fencerBId: 'b1', finished: true },
        { relayId: 'r2', order: 2, fencerAId: 'a2', fencerBId: 'b2', finished: true },
        { relayId: 'r3', order: 3, fencerAId: 'a1', fencerBId: 'b3', finished: false },
      ],
    };
    const meetingCards = [
      prior('a1', CardType.YELLOW, CardGroup.GROUP_1),
      prior('b1', CardType.YELLOW, CardGroup.GROUP_1),
    ];
    const a = relayCardFor(input({ meeting, relayId: 'r3', meetingCards }));
    expect(a.ok && a.card.type).toBe(CardType.RED);
    expect(a.ok && a.card.pointsAwarded).toBe(1);
    // b3 n'a rien reçu : son jaune de b1 ne compte pas pour lui
    const b = relayCardFor(input({ meeting, relayId: 'r3', side: 'B', meetingCards }));
    expect(b.ok && b.card.type).toBe(CardType.YELLOW);
  });

  it('remplaçant : le tireur est celui porté par le relais', () => {
    const rs = relays(1);
    rs[1] = { ...rs[1], fencerAId: 'reserve-a' };
    const r = relayCardFor(
      input({ meeting: { matchId: 'm', finished: false, relays: rs }, relayId: 'r2' })
    );
    expect(r.ok && r.card.fencerId).toBe('reserve-a');
  });

  it('Sabre Laser : escalade et barème inchangés', () => {
    const meetingCards = [prior('a1', CardType.WHITE, CardGroup.GROUP_1)];
    const r = relayCardFor(
      input({ weapon: Weapon.LASER, given: { reason: CardReason.EARLY_START }, meetingCards })
    );
    expect(r.ok && r.card.type).toBe(CardType.YELLOW);
    expect(r.ok && r.card.pointsAwarded).toBe(1);
  });

  it('noir de l’escalade : exclusion portée par le carton', () => {
    const r = relayCardFor(input({ given: { reason: CardReason.FIE_VIOLENCE } }));
    expect(r.ok && r.card.type).toBe(CardType.BLACK);
    expect(r.ok && r.card.resultingExclusion).toBe(true);
  });

  it('motif hors du règlement de l’arme refusé', () => {
    expect(relayCardFor(input({ given: { reason: CardReason.ESTOC } }))).toEqual({
      ok: false,
      code: 'invalid_input',
    });
    expect(
      relayCardFor(input({ weapon: Weapon.LASER, given: { reason: CardReason.FIE_VIOLENCE } }))
    ).toEqual({ ok: false, code: 'invalid_input' });
  });
});

describe('relayCardFor : type imposé par l’appareil', () => {
  it('ni motif ni groupe ; points du barème de l’arme', () => {
    const r = relayCardFor(input({ given: { type: CardType.RED } }));
    expect(r).toEqual({
      ok: true,
      card: {
        id: 'k1',
        matchId: 'm',
        relayId: 'r1',
        fencerId: 'a1',
        type: CardType.RED,
        reason: null,
        group: null,
        timestamp: AT,
        pointsAwarded: 1,
        resultingExclusion: false,
      },
    });
    const y = relayCardFor(input({ given: { type: CardType.YELLOW } }));
    expect(y.ok && y.card.pointsAwarded).toBe(0);
    const laser = relayCardFor(input({ weapon: Weapon.LASER, given: { type: CardType.YELLOW } }));
    expect(laser.ok && laser.card.pointsAwarded).toBe(1);
  });

  it('pas de blanc en escrime olympique ; type inconnu refusé', () => {
    expect(relayCardFor(input({ given: { type: CardType.WHITE } }))).toEqual({
      ok: false,
      code: 'invalid_input',
    });
    expect(relayCardFor(input({ weapon: Weapon.LASER, given: { type: CardType.WHITE } })).ok).toBe(
      true
    );
    expect(relayCardFor(input({ given: { type: 'GREEN' as CardType } })).ok).toBe(false);
  });
});

describe('relayCardFor : refus', () => {
  it('relais inconnu', () => {
    expect(relayCardFor(input({ relayId: 'r9' }))).toEqual({
      ok: false,
      code: 'relay_not_found',
    });
  });

  it('rencontre terminée : dernier relais tant que la rencontre suivante n’a pas commencé (#2213)', () => {
    const done = { matchId: 'm', finished: true, relays: relays(3) };
    const after = relayCardFor(input({ meeting: done, relayId: 'r3' }));
    expect(after.ok && after.card.relayId).toBe('r3');
    expect(relayCardFor(input({ meeting: done, relayId: 'r2' }))).toEqual({
      ok: false,
      code: 'match_finished',
    });
    const next = { ...done, nextMatchStarted: true };
    expect(relayCardFor(input({ meeting: next, relayId: 'r3' }))).toEqual({
      ok: false,
      code: 'match_finished',
    });
  });

  it('rencontre décidée avant son dernier relais (exclusion, abandon)', () => {
    const decided = { matchId: 'm', finished: true, relays: relays(1) };
    expect(relayCardFor(input({ meeting: decided, relayId: 'r2' }))).toEqual({
      ok: false,
      code: 'match_finished',
    });
  });

  it('relais hors ordre (§ 5)', () => {
    // Relais futur
    expect(relayCardFor(input({ relayId: 'r3' }))).toEqual({
      ok: false,
      code: 'relay_out_of_order',
    });
  });
});

describe('relayAcceptsCard (§ 5)', () => {
  it('relais en cours', () => {
    expect(relayAcceptsCard(relays(1), 'r2')).toBe('ok');
  });

  it('dernier relais terminé tant que le suivant n’a pas commencé', () => {
    expect(relayAcceptsCard(relays(1), 'r1')).toBe('ok');
    expect(relayAcceptsCard(relays(1, true), 'r1')).toBe('relay_out_of_order');
    expect(relayAcceptsCard(relays(2), 'r1')).toBe('relay_out_of_order');
  });

  it('relais futur, inconnu, rencontre terminée', () => {
    expect(relayAcceptsCard(relays(0), 'r2')).toBe('relay_out_of_order');
    expect(relayAcceptsCard(relays(0), 'x')).toBe('relay_not_found');
    expect(relayAcceptsCard(relays(3), 'r2')).toBe('match_finished');
  });

  it('rencontre terminée : dernier relais accepté jusqu’au début de la rencontre suivante', () => {
    expect(relayAcceptsCard(relays(3), 'r3')).toBe('ok');
    expect(relayAcceptsCard(relays(3), 'r3', true)).toBe('match_finished');
  });
});

// ─── Cartons de l'appareil ──────────────────────────────────────────────────

describe('newDeviceCards', () => {
  it('compteurs de l’appareil sans rien d’enregistré : tout est nouveau, dans l’ordre', () => {
    expect(newDeviceCards({}, { red: 2, yellow: 1, 'p-red': 1 })).toEqual([
      'yellow',
      'red',
      'red',
      'p-red',
    ]);
  });

  it('pas de doublon : seul l’excédent de l’appareil est nouveau', () => {
    expect(newDeviceCards({ yellow: 1, red: 1 }, { yellow: 1, red: 2 })).toEqual(['red']);
    expect(newDeviceCards({ yellow: 1, red: 2 }, { yellow: 1, red: 2 })).toEqual([]);
    // Plus enregistré que montré (tablette, ou carton retiré sur l'appareil) : rien
    expect(newDeviceCards({ red: 3 }, { red: 1 })).toEqual([]);
  });

  it('états successifs : rejouer le même état ne crée rien', () => {
    const shown = deviceCardCounts(['yellow', 'red']);
    const first = newDeviceCards({}, shown);
    expect(first).toEqual(['yellow', 'red']);
    const recorded = recordedCardCounts([{ type: CardType.YELLOW }, { type: CardType.RED }]);
    expect(newDeviceCards(recorded, shown)).toEqual([]);
  });

  it('compteurs : format des arènes et cartons enregistrés (blanc et noir ignorés)', () => {
    expect(deviceCardCounts(['red', 'yellow', 'red', 'p-black', 'other'])).toEqual({
      yellow: 1,
      red: 2,
      'p-black': 1,
    });
    expect(
      recordedCardCounts([
        { type: CardType.WHITE },
        { type: CardType.YELLOW },
        { type: CardType.BLACK },
      ])
    ).toEqual({ yellow: 1 });
  });
});
