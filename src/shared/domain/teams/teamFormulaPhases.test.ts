/**
 * Phases d'une épreuve par équipes dans la formule (ADR-0044, G0c), domaine : poules d'équipes
 * tirées comme en individuel (serpentin au rang d'entrée, clubs séparés, ordre officiel des
 * rencontres, relais de la règle du tour), poule unique en cas particulier, classement d'entrée
 * du tableau (coupe à la barre, rang d'entrée sans poule), petite finale.
 */
import { describe, expect, it } from 'vitest';
import { Weapon } from '../../types';
import type { TeamMatchRow, TeamRow } from './team.types';
import { isTeamPoolsRefusal, planTeamPools, type TeamPoolsPlan } from './relay';
import { relayPairsOf } from './teamMatchRule';
import {
  isThirdPlaceSlot,
  planTeamTableau,
  planTeamTableauMatches,
  rankTeamsForTableau,
  tableauSeedIds,
  type TeamTableauMatchState,
} from './teamTableau';
import { rankedTeamPool, teamTableauEntry } from './teamTableauEntry';
import { calculateTeamOverallRanking, calculateTeamPoolRanking } from './teamCalculations';
import { generatePoolMatchOrder } from '../pools/poolMatchOrder';

const team = (id: string, club = id, titulars = 3): TeamRow => ({
  id,
  name: id,
  club,
  fencers: Array.from({ length: titulars }, (_, i) => ({
    fencerId: `${id}${i + 1}`,
    fencerLastName: 'N',
    fencerFirstName: 'P',
    teamOrder: i + 1,
    isReserve: false,
  })),
});
const RULE = { starters: 3, relayOrder: 'fie' as const };
const noShuffle = () => 0.999999; // Fisher-Yates : j = i, positions gardées
const draw = (poolCount: number, extra: Record<string, unknown> = {}) => ({
  poolCount,
  boutOrder: 'fie' as const,
  starters: 3,
  pairs: relayPairsOf(RULE),
  random: noShuffle,
  ...extra,
});
const plan = (teams: TeamRow[], poolCount: number, extra: Record<string, unknown> = {}) => {
  const out = planTeamPools('c', teams, Weapon.EPEE, { minTeamSize: 3 }, draw(poolCount, extra));
  if (isTeamPoolsRefusal(out)) throw new Error(out.code);
  return out as TeamPoolsPlan;
};
const sorted = (ids: string[]) => [...ids].sort();

describe('planTeamPools avec la formule (docs/adr/0044)', () => {
  it('serpentin au rang d’entrée (ordre fourni) : 7 équipes en 2 poules', () => {
    const teams = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'].map(id => team(id));
    const out = plan(teams, 2);
    expect(out.pools.map(p => sorted(p.teamIds))).toEqual([
      ['T1', 'T4', 'T5'],
      ['T2', 'T3', 'T6', 'T7'],
    ]);
    // Poule de 3 : 3 rencontres ; poule de 4 : 6, identifiants par poule
    expect(out.matches.filter(m => m.pool === 1)).toHaveLength(3);
    expect(out.matches.filter(m => m.pool === 2).map(m => m.matchId)).toEqual(
      [1, 2, 3, 4, 5, 6].map(k => `c-p2-${k}`)
    );
  });

  it('ordre officiel des rencontres pour la taille de poule ; relais de la règle du tour', () => {
    const teams = ['A', 'B', 'C', 'D'].map(id => team(id));
    const out = plan(teams, 1);
    const ids = out.pools[0].teamIds;
    const expected = generatePoolMatchOrder(4).map(([a, b]) => [ids[a - 1], ids[b - 1]]);
    expect(out.matches.map(m => [m.teamAId, m.teamBId])).toEqual(expected);
    // Ordre FIE o.99.3 : 3-6 d'abord
    expect(out.matches[0].relays[0]).toMatchObject({
      fencerAId: `${expected[0][0]}3`,
      fencerBId: `${expected[0][1]}3`,
    });
    const rotation = plan(teams, 1, {
      pairs: relayPairsOf({ starters: 3, relayOrder: 'rotation' }),
    });
    expect(rotation.matches[0].relays[0]).toMatchObject({
      fencerAId: `${expected[0][0]}1`,
      fencerBId: `${expected[0][1]}1`,
    });
  });

  it('poule unique : cas particulier, une poule de la taille de l’effectif', () => {
    const teams = ['A', 'B', 'C', 'D', 'E'].map(id => team(id));
    const out = plan(teams, 1);
    expect(out.pools).toHaveLength(1);
    expect(sorted(out.pools[0].teamIds)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(out.matches).toHaveLength(10);
  });

  it('séparation par club : deux équipes du même club dans deux poules', () => {
    const teams = [team('T1', 'X'), team('T2'), team('T3'), team('T4', 'X')];
    const out = plan(teams, 2);
    const poolOf = (id: string) => out.pools.find(p => p.teamIds.includes(id))!.number;
    expect(poolOf('T1')).not.toBe(poolOf('T4'));
  });

  it('titulaires de la règle du tour : équipe de 2 incomplète pour une règle à 3', () => {
    const out = planTeamPools('c', [team('A'), team('B', 'B', 2)], Weapon.EPEE, {}, draw(1));
    expect(out).toEqual({ code: 'team_incomplete', teamIds: ['B'], teamSize: 3 });
  });

  it('arène Sabre Laser : calendrier figé, tirage de la formule ignoré', () => {
    const teams = 'ABCDEFGH'.split('').map(id => team(id));
    const out = planTeamPools('c', teams, Weapon.LASER, { teamFormat: 'laser-arena' }, draw(4));
    expect(isTeamPoolsRefusal(out)).toBe(false);
    expect((out as TeamPoolsPlan).pools.map(p => p.teamIds.length)).toEqual([4, 4]);
  });
});

const finished = (
  id: string,
  a: string,
  b: string,
  winner: string | null,
  scoreA: number,
  scoreB: number,
  pool = 1
): TeamMatchRow => ({
  id,
  poolNumber: pool,
  teamAId: a,
  teamBId: b,
  scoreBoutsA: scoreA,
  scoreBoutsB: scoreB,
  status: 'finished',
  winnerId: winner,
  currentBoutIndex: 9,
  bouts: [],
});

describe('Classement d’entrée du tableau (docs/adr/0044)', () => {
  const [A, B, C, D] = ['A', 'B', 'C', 'D'].map(id => team(id));
  // A bat tout le monde ; B et C : une victoire, indices égaux ; D : aucune
  const matches = [
    finished('1', 'A', 'B', 'A', 10, 5),
    finished('2', 'A', 'C', 'A', 10, 5),
    finished('3', 'A', 'D', 'A', 10, 5),
    finished('4', 'B', 'C', 'B', 10, 5),
    finished('5', 'C', 'D', 'C', 15, 5),
    finished('6', 'B', 'D', 'D', 5, 10),
  ];

  it('rangs du classement de poule : égalité de victoires et d’indices → même rang', () => {
    const rows = rankedTeamPool([A, B, C, D], matches);
    expect(rows.map(r => [r.team.id, r.rank])).toEqual([
      ['A', 1],
      ['C', 2],
      ['B', 3],
      ['D', 4],
    ]);
    const tied = rankedTeamPool(
      [A, B, C, D],
      [finished('1', 'A', 'B', 'A', 10, 5), finished('2', 'C', 'D', 'C', 10, 5)]
    );
    expect(tied.map(r => r.rank)).toEqual([1, 1, 3, 3]);
  });

  it('coupe à la barre : nombre, pourcentage ; ex aequo gardés ou départagés au rang d’entrée', () => {
    const base = {
      teams: [A, B, C, D],
      poolMatches: matches,
      entryOrder: [D, C, B, A],
      hasPools: true,
    };
    expect(
      teamTableauEntry({ ...base, qualification: { mode: 'fixed_count', count: 2 } }).qualified.map(
        t => t.id
      )
    ).toEqual(['A', 'C']);
    expect(
      teamTableauEntry({
        ...base,
        qualification: { mode: 'percentage', percentage: 75 },
      }).qualified.map(t => t.id)
    ).toEqual(['A', 'C', 'B']);
    const tiedMatches = [finished('1', 'A', 'B', 'A', 10, 5), finished('2', 'C', 'D', 'C', 10, 5)];
    const all = teamTableauEntry({
      ...base,
      poolMatches: tiedMatches,
      qualification: { mode: 'fixed_count', count: 1 },
    });
    expect(all.qualified.map(t => t.id)).toEqual(['A', 'C']);
    expect(all.tiedAtBar).toMatchObject({ rank: 1, places: 1 });
    const byEntry = teamTableauEntry({
      ...base,
      poolMatches: tiedMatches,
      qualification: { mode: 'fixed_count', count: 1, ties: 'initial_ranking' },
    });
    // Rang d'entrée : D, C, B, A → C devant A
    expect(byEntry.qualified.map(t => t.id)).toEqual(['C']);
    expect(byEntry.eliminated.map(t => t.id)).toEqual(['A', 'B', 'D']);
  });

  it('sans tour de poules : rang d’entrée', () => {
    expect(
      teamTableauEntry({
        teams: [A, B, C],
        poolMatches: [],
        entryOrder: [C, A, B, D],
        hasPools: false,
      }).qualified.map(t => t.id)
    ).toEqual(['C', 'A', 'B']);
  });
});

describe('Classement toutes poules confondues : ratio V/M (docs/adr/0044 amendée)', () => {
  const T = ['A', 'B', 'C', 'D', 'E'].map(id => team(id));

  it('poule unique : exactement le classement actuel (victoires), même poule en cours', () => {
    const single = [
      finished('1', 'A', 'B', 'A', 10, 5),
      finished('2', 'C', 'D', 'C', 10, 9),
      finished('3', 'A', 'C', 'C', 4, 10),
      // E : une seule rencontre, gagnée (ratio 1, mais 1 victoire)
      finished('4', 'E', 'D', 'E', 6, 5),
      { ...finished('5', 'B', 'E', null, 0, 0), status: 'in_progress' },
    ];
    expect(calculateTeamOverallRanking(T, single).map(r => r.team.id)).toEqual(
      calculateTeamPoolRanking(T, single).map(r => r.team.id)
    );
    expect(rankTeamsForTableau(T, single, 'fie-relay').map(t => t.id)).toEqual(
      calculateTeamPoolRanking(T, single).map(r => r.team.id)
    );
  });

  it('plusieurs poules : ratio victoires / rencontres avant les victoires brutes', () => {
    // Poule 1 (4 équipes) : A gagne 2 sur 3 ; poule 2 (2 équipes) : E gagne 1 sur 1
    const matches = [
      finished('1', 'A', 'B', 'A', 10, 5, 1),
      finished('2', 'A', 'C', 'A', 10, 5, 1),
      finished('3', 'A', 'D', 'D', 5, 10, 1),
      finished('4', 'B', 'C', 'B', 10, 5, 1),
      finished('5', 'B', 'D', 'B', 10, 5, 1),
      finished('6', 'C', 'D', 'C', 10, 5, 1),
      finished('7', 'E', team('F').id, 'E', 6, 5, 2),
    ];
    const teams = [...T, team('F')];
    const overall = calculateTeamOverallRanking(teams, matches);
    expect(overall[0]).toMatchObject({ team: { id: 'E' }, ratio: 1 });
    expect(calculateTeamPoolRanking(teams, matches)[0].team.id).not.toBe('E');
    expect(rankedTeamPool(teams, matches)[0]).toMatchObject({ rank: 1, ratio: 1 });
  });
});

describe('Classement toutes poules confondues : départages (ADR-0044 amendée)', () => {
  const relays = (aWins: number, bWins: number) => [
    ...Array.from({ length: aWins }, () => ({
      status: 'finished',
      winnerId: 'fa',
      fencerAId: 'fa',
      fencerBId: 'fb',
    })),
    ...Array.from({ length: bWins }, () => ({
      status: 'finished',
      winnerId: 'fb',
      fencerAId: 'fa',
      fencerBId: 'fb',
    })),
  ];
  const withBouts = (m: TeamMatchRow, aWins: number, bWins: number): TeamMatchRow =>
    ({ ...m, bouts: relays(aWins, bWins) }) as unknown as TeamMatchRow;
  const teams = ['A', 'B', 'C', 'D'].map(id => team(id));

  it('ratio égal : indice des relais, puis indice des touches', () => {
    // Deux poules de 2 : A et C gagnent leur seule rencontre (ratio 1)
    // A : relais 6-3 (+3) ; C : relais 5-4 (+1) → A devant C
    const byRelays = [
      withBouts(finished('1', 'A', 'B', 'A', 45, 40, 1), 6, 3),
      withBouts(finished('2', 'C', 'D', 'C', 45, 20, 2), 5, 4),
    ];
    expect(
      calculateTeamOverallRanking(teams, byRelays)
        .map(r => r.team.id)
        .slice(0, 2)
    ).toEqual(['A', 'C']);
    // Indice des relais égal (+1 chacun) : indice des touches, C (+25) devant A (+5)
    const byTouches = [
      withBouts(finished('1', 'A', 'B', 'A', 45, 40, 1), 5, 4),
      withBouts(finished('2', 'C', 'D', 'C', 45, 20, 2), 5, 4),
    ];
    expect(
      calculateTeamOverallRanking(teams, byTouches)
        .map(r => r.team.id)
        .slice(0, 2)
    ).toEqual(['C', 'A']);
  });
});

describe('Tableau d’équipes : petite finale, têtes de série (docs/adr/0044)', () => {
  const teams = ['A', 'B', 'C', 'D'].map(id => team(id));
  const tableau = planTeamTableau(teams);
  const semis = (winners: [string, string]): TeamTableauMatchState[] => [
    { round: 2, position: 0, status: 'finished', winnerId: winners[0] },
    { round: 2, position: 1, status: 'finished', winnerId: winners[1] },
  ];

  it('perdants des demi-finales en petite finale (case t1-1), avec la finale', () => {
    const out = planTeamTableauMatches('c', tableau, semis(['A', 'B']), teams, 3, Weapon.EPEE, {
      thirdPlace: true,
    });
    expect(out.map(m => [m.matchId, m.teamAId, m.teamBId])).toEqual([
      ['c-t1-0', 'A', 'B'],
      ['c-t1-1', 'D', 'C'],
    ]);
    expect(isThirdPlaceSlot(out[1])).toBe(true);
    // Sans réglage : pas de petite finale (inchangé)
    expect(
      planTeamTableauMatches('c', tableau, semis(['A', 'B']), teams, 3, Weapon.EPEE)
    ).toHaveLength(1);
  });

  it('une seule demi-finale terminée, ou petite finale déjà créée : rien de plus', () => {
    const one: TeamTableauMatchState[] = [
      { round: 2, position: 0, status: 'finished', winnerId: 'A' },
      { round: 2, position: 1, status: 'in_progress', winnerId: null },
    ];
    expect(
      planTeamTableauMatches('c', tableau, one, teams, 3, Weapon.EPEE, { thirdPlace: true })
    ).toEqual([]);
    const done = [
      ...semis(['A', 'B']),
      { round: 1, position: 1, status: 'not_started', winnerId: null },
    ];
    expect(
      planTeamTableauMatches('c', tableau, done, teams, 3, Weapon.EPEE, { thirdPlace: true }).map(
        m => m.matchId
      )
    ).toEqual(['c-t1-0']);
  });

  it('demi-finale exemptée (3 équipes) : pas de petite finale', () => {
    const three = teams.slice(0, 3);
    const t3 = planTeamTableau(three);
    const out = planTeamTableauMatches(
      'c',
      t3,
      [{ round: 2, position: 1, status: 'finished', winnerId: 'B' }],
      three,
      3,
      Weapon.EPEE,
      { thirdPlace: true }
    );
    expect(out.map(m => m.matchId)).toEqual(['c-t1-0']);
  });

  it('têtes de série retrouvées depuis les cases du tableau tiré', () => {
    const five = ['A', 'B', 'C', 'D', 'E'].map(id => team(id));
    expect(tableauSeedIds(planTeamTableau(five))).toEqual(['A', 'B', 'C', 'D', 'E']);
  });
});
