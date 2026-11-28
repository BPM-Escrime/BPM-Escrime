import { describe, it, expect } from 'vitest';
import { Weapon } from '../../types';
import type { TeamRow } from './team.types';
import {
  canRecordRelay,
  isTeamPoolsRefusal,
  planRelays,
  planSubstitution,
  planTeamPools,
  relayCap,
  relayCumulative,
  relayId,
  relayLeader,
  relayMaxScore,
  teamMatchOutcome,
  teamPoolMatchId,
  teamTableauMatchId,
  titulars,
  type RelayScore,
} from './relay';

const team = (id: string, size = 3, reserve = true): TeamRow => ({
  id,
  name: id,
  club: id,
  fencers: [
    // Ordre volontairement mélangé : teamOrder fait foi
    ...Array.from({ length: size }, (_, i) => ({
      fencerId: `${id}${size - i}`,
      fencerLastName: 'N',
      fencerFirstName: 'P',
      teamOrder: size - i,
      isReserve: false,
    })),
    ...(reserve
      ? [
          {
            fencerId: `${id}R`,
            fencerLastName: 'N',
            fencerFirstName: 'P',
            teamOrder: size + 1,
            isReserve: true,
          },
        ]
      : []),
  ],
});

describe('relay : identifiants déterministes (docs/adr/0024)', () => {
  it('rencontre de poule, de tableau, relais', () => {
    expect(teamPoolMatchId('c1', 2, 3)).toBe('c1-p2-3');
    expect(teamTableauMatchId('c1', 8, 2)).toBe('c1-t8-2');
    expect(relayId('c1-p1-1', 9)).toBe('c1-p1-1-r9');
  });
});

describe('relay : titulaires et ordre des relais', () => {
  it('titulaires triés par teamOrder, remplaçant exclu', () => {
    expect(titulars(team('A'), 3)).toEqual(['A1', 'A2', 'A3']);
  });

  it('ordre FIE à 3 titulaires en épée : 3-6, 1-5, 2-4, 1-6, 3-4, 2-5, 1-4, 2-6, 3-5', () => {
    const relays = planRelays('m', team('A'), team('B'), 3, Weapon.EPEE)!;
    expect(relays.map(r => `${r.fencerAId}-${r.fencerBId}`)).toEqual([
      'A3-B3',
      'A1-B2',
      'A2-B1',
      'A1-B3',
      'A3-B1',
      'A2-B2',
      'A1-B1',
      'A2-B3',
      'A3-B2',
    ]);
    expect(relays.map(r => r.relayId)).toEqual(Array.from({ length: 9 }, (_, k) => `m-r${k + 1}`));
  });

  it('Sabre Laser : ordre diagonal, N² relais', () => {
    const relays = planRelays('m', team('A', 2), team('B', 2), 2, Weapon.LASER)!;
    expect(relays.map(r => `${r.fencerAId}-${r.fencerBId}`)).toEqual([
      'A1-B1',
      'A2-B2',
      'A1-B2',
      'A2-B1',
    ]);
  });

  it('titulaires manquants : pas de relais', () => {
    expect(planRelays('m', team('A', 2), team('B'), 3, Weapon.EPEE)).toBeNull();
  });

  it('score maximal d’un relais : palier FIE, plafond de l’arène', () => {
    expect(relayMaxScore(Weapon.EPEE, { minTeamSize: 3 })).toBe(5);
    expect(relayMaxScore(Weapon.EPEE, { minTeamSize: 3, teamRelayStepSize: 4 })).toBe(4);
    expect(relayMaxScore(Weapon.LASER, { minTeamSize: 3, teamFormat: 'laser-arena' })).toBe(5);
  });
});

describe('relay : tirage des poules d’équipes', () => {
  it('relais FIE : poule unique tous contre tous, identifiants déterministes', () => {
    const plan = planTeamPools('c', [team('A'), team('B'), team('C')], Weapon.FOIL, {
      minTeamSize: 3,
    });
    if (isTeamPoolsRefusal(plan)) throw new Error('refus');
    expect(plan.pools).toEqual([{ number: 1, teamIds: ['A', 'B', 'C'] }]);
    expect(plan.matches.map(m => [m.matchId, m.teamAId, m.teamBId, m.round])).toEqual([
      ['c-p1-1', 'A', 'B', null],
      ['c-p1-2', 'A', 'C', null],
      ['c-p1-3', 'B', 'C', null],
    ]);
    expect(plan.matches[0].relays).toHaveLength(9);
    // Même entrée, même tirage
    expect(planTeamPools('c', [team('A'), team('B'), team('C')], Weapon.FOIL)).toEqual(plan);
  });

  it('arène Sabre Laser : calendrier figé de 8 équipes, deux poules', () => {
    const teams = 'ABCDEFGH'.split('').map(id => team(id));
    const plan = planTeamPools('c', teams, Weapon.LASER, { teamFormat: 'laser-arena' });
    if (isTeamPoolsRefusal(plan)) throw new Error('refus');
    expect(plan.pools).toEqual([
      { number: 1, teamIds: ['A', 'B', 'C', 'D'] },
      { number: 2, teamIds: ['E', 'F', 'G', 'H'] },
    ]);
    expect(plan.matches).toHaveLength(12);
    expect(plan.matches[0]).toMatchObject({ matchId: 'c-p1-1', pool: 1, round: 1 });
    expect(new Set(plan.matches.map(m => m.matchId)).size).toBe(12);
  });

  it('refus : moins de 2 équipes, arène hors 8 ou 12, titulaires manquants', () => {
    expect(planTeamPools('c', [team('A')], Weapon.EPEE)).toEqual({
      code: 'not_enough_teams',
      count: 1,
    });
    expect(
      planTeamPools('c', [team('A'), team('B'), team('C')], Weapon.LASER, {
        teamFormat: 'laser-arena',
      })
    ).toEqual({ code: 'arena_team_count', count: 3 });
    expect(planTeamPools('c', [team('A'), team('B', 2)], Weapon.EPEE)).toEqual({
      code: 'team_incomplete',
      teamIds: ['B'],
      teamSize: 3,
    });
  });
});

describe('relay : score du relais, cumul, ordre, issue', () => {
  const relays: RelayScore[] = [
    { order: 1, scoreA: 5, scoreB: 3, finished: true },
    { order: 2, scoreA: 2, scoreB: 7, finished: true },
    { order: 3, scoreA: 0, scoreB: 0, finished: false },
  ];

  it('cumul calculé à partir du score de chaque relais', () => {
    expect(relayCumulative(relays)).toEqual({ scoreA: 7, scoreB: 10 });
    expect(relayCumulative(relays, 1)).toEqual({ scoreA: 5, scoreB: 3 });
    expect(relayLeader(relays, 1)).toBe('A');
    expect(relayLeader(relays, 2)).toBe('B');
  });

  it('palier : min(ordre × pas, cible) en FIE, plafond de l’assaut en arène', () => {
    const rule = { stepSize: 5, target: 45 };
    expect(relayCap(2, 'fie-relay', rule)).toBe(10);
    expect(relayCap(10, 'fie-relay', rule)).toBe(45);
    expect(relayCap(2, 'laser-arena', rule)).toBe(5);
  });

  it('un relais ne s’enregistre que si les précédents sont terminés', () => {
    expect(canRecordRelay(relays, 3)).toBe(true);
    expect(canRecordRelay(relays, 4)).toBe(false);
  });

  it('fin de rencontre : tous les relais terminés ; égalité tranchée par l’appelant', () => {
    expect(teamMatchOutcome(relays)).toMatchObject({ finished: false, winner: null });
    const done = relays.map(r => ({ ...r, finished: true, scoreA: 1, scoreB: 1 }));
    expect(teamMatchOutcome(done)).toMatchObject({ finished: true, winner: null });
    expect(teamMatchOutcome(done, 'B')).toMatchObject({ scoreA: 3, scoreB: 3, winner: 'B' });
    expect(teamMatchOutcome(relays.map(r => ({ ...r, finished: true })))).toMatchObject({
      winner: 'B',
    });
  });
});

describe('relay : remplaçant (o.99.5, o.99.6)', () => {
  const slots = [
    { relayId: 'r1', order: 1, fencerAId: 'A1', fencerBId: 'B1', finished: true },
    { relayId: 'r2', order: 2, fencerAId: 'A2', fencerBId: 'B1', finished: false },
    { relayId: 'r3', order: 3, fencerAId: 'A1', fencerBId: 'B2', finished: false },
  ];

  it('prend la place du sortant dans les relais non tirés', () => {
    expect(planSubstitution(slots, 'A', 'A1', 'AR', false)).toEqual({
      ok: true,
      side: 'A',
      relayIds: ['r3'],
    });
  });

  it('refus : sans remplaçant, remplaçant déjà utilisé, plus de relais, absent', () => {
    expect(planSubstitution(slots, 'A', 'A1', null, false)).toMatchObject({
      reason: 'no_reserve',
    });
    expect(planSubstitution(slots, 'A', 'A1', 'AR', true)).toMatchObject({
      reason: 'reserve_used',
    });
    const allDone = slots.map(s => ({ ...s, finished: true }));
    expect(planSubstitution(allDone, 'B', 'B1', 'BR', false)).toMatchObject({
      reason: 'no_later_relay',
    });
    expect(planSubstitution(slots, 'A', 'B1', 'AR', false)).toMatchObject({
      reason: 'not_in_match',
    });
  });
});
