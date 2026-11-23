import { describe, it, expect } from 'vitest';
import { Weapon } from '../../types';
import type { TeamMatchRow, TeamRow } from './team.types';
import {
  nextTableauSlot,
  planTeamTableau,
  planTeamTableauMatches,
  rankTeamsForTableau,
} from './teamTableau';
import {
  relayRuleOf,
  relayScoreAboveMax,
  relayWinner,
  teamMatchOutcome,
  type RelayScore,
} from './relay';

const team = (id: string, titulars = 3): TeamRow => ({
  id,
  name: id,
  club: id,
  fencers: Array.from({ length: titulars }, (_, i) => ({
    fencerId: `${id}${i + 1}`,
    fencerLastName: 'N',
    fencerFirstName: 'P',
    teamOrder: i + 1,
    isReserve: false,
  })),
});

const ids = (...names: string[]) => names.map(n => team(n));

describe('teamTableau : placement (docs/adr/0024, lot E2)', () => {
  it('4 équipes : tableau de 4, têtes de série 1-4 et 2-3', () => {
    const plan = planTeamTableau(ids('A', 'B', 'C', 'D'));
    expect(plan.size).toBe(4);
    expect(plan.slots).toEqual([
      { round: 2, position: 0, teamAId: 'A', teamBId: 'D', isBye: false },
      { round: 2, position: 1, teamAId: 'C', teamBId: 'B', isBye: false },
    ]);
  });

  it('5 équipes : tableau de 8, trois exemptés ; deux exemptés voisins forment déjà une rencontre du 2e tour', () => {
    const teams = ids('A', 'B', 'C', 'D', 'E');
    const plan = planTeamTableau(teams);
    expect(plan.size).toBe(8);
    expect(plan.slots.filter(s => s.isBye)).toHaveLength(3);
    const created = planTeamTableauMatches('c', plan, [], teams, 3, Weapon.EPEE);
    // Premier tour : la seule rencontre 4-5 ; deuxième tour : les deux exemptés voisins
    expect(created.map(m => [m.round, m.position])).toEqual([
      [4, 1],
      [2, 1],
    ]);
    expect(created[0].matchId).toBe('c-t4-1');
    expect(created[0].relays).toHaveLength(9);
    expect(created[0].relays?.[0].relayId).toBe('c-t4-1-r1');
  });

  it('avancement : la finale n’est créée qu’une fois les deux demi-finales décidées', () => {
    const teams = ids('A', 'B', 'C', 'D');
    const plan = planTeamTableau(teams);
    const semis = planTeamTableauMatches('c', plan, [], teams, 3, Weapon.FOIL);
    expect(semis.map(m => m.matchId)).toEqual(['c-t2-0', 'c-t2-1']);
    const state = (status: string, winnerId: string | null, position: number) => ({
      round: 2,
      position,
      status,
      winnerId,
    });
    // Une demi-finale décidée : rien de neuf (déjà créées)
    expect(
      planTeamTableauMatches(
        'c',
        plan,
        [state('finished', 'A', 0), state('not_started', null, 1)],
        teams,
        3,
        Weapon.FOIL
      )
    ).toEqual([]);
    const final = planTeamTableauMatches(
      'c',
      plan,
      [state('finished', 'A', 0), state('finished', 'B', 1)],
      teams,
      3,
      Weapon.FOIL
    );
    expect(final.map(m => [m.matchId, m.teamAId, m.teamBId])).toEqual([['c-t1-0', 'A', 'B']]);
    // Titulaires manquants : relais nuls (refus du moteur)
    const short = [team('A'), team('B', 2)];
    expect(
      planTeamTableauMatches('c', planTeamTableau(short), [], short, 3, Weapon.EPEE)[0].relays
    ).toBeNull();
  });

  it('case suivante du vainqueur ; finale sans suite', () => {
    expect(nextTableauSlot(4, 3)).toEqual({ round: 2, position: 1 });
    expect(nextTableauSlot(2, 0)).toEqual({ round: 1, position: 0 });
    expect(nextTableauSlot(1, 0)).toBeNull();
  });

  it('classement : relais FIE par victoires ; arène par points avec évitement de revanche', () => {
    const teams = ids('A', 'B', 'C');
    const won = (a: string, b: string): TeamMatchRow => ({
      id: `${a}${b}`,
      teamAId: a,
      teamBId: b,
      scoreBoutsA: 45,
      scoreBoutsB: 30,
      status: 'finished',
      winnerId: a,
      currentBoutIndex: 9,
      bouts: [],
    });
    const pools = [won('C', 'A'), won('C', 'B'), won('B', 'A')];
    expect(rankTeamsForTableau(teams, pools, 'fie-relay').map(t => t.id)).toEqual(['C', 'B', 'A']);
    expect(rankTeamsForTableau(teams, [], 'laser-arena').map(t => t.id)).toHaveLength(3);
  });
});

describe('relay : score et vainqueur d’un relais (docs/adr/0024, lot E2)', () => {
  const relays = (...scores: Array<[number, number]>): RelayScore[] =>
    scores.map(([a, b], i) => ({ order: i + 1, scoreA: a, scoreB: b, finished: true }));

  it('palier du relais FIE : cumul plafonné à ordre × 5 ; arène : 5 par assaut', () => {
    const rule = relayRuleOf(Weapon.EPEE, { minTeamSize: 3 });
    expect(rule).toEqual({ stepSize: 5, target: 45 });
    const done = relays([5, 3]);
    expect(relayScoreAboveMax(done, 2, 5, 7, 'fie-relay', rule)).toBe(false);
    expect(relayScoreAboveMax(done, 2, 6, 0, 'fie-relay', rule)).toBe(true);
    expect(relayScoreAboveMax([], 1, 5, 5, 'laser-arena', rule)).toBe(false);
    expect(relayScoreAboveMax([], 1, 6, 0, 'laser-arena', rule)).toBe(true);
  });

  it('vainqueur : meneur au cumul en relais FIE, score de l’assaut en arène', () => {
    const r = relays([5, 1], [0, 3]);
    expect(relayWinner(r, 2, 'fie-relay')).toBe('A');
    expect(relayWinner(r, 2, 'laser-arena')).toBe('B');
    expect(relayWinner(relays([2, 2]), 1, 'laser-arena')).toBeNull();
  });

  it('issue : égalité tranchée par le vainqueur donné', () => {
    const r = relays([5, 5]);
    expect(teamMatchOutcome(r)).toMatchObject({ finished: true, winner: null });
    expect(teamMatchOutcome(r, 'B')).toMatchObject({ finished: true, winner: 'B' });
  });
});
