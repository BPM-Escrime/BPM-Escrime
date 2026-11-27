/**
 * Rang d'entrée effectif d'une équipe (ADR-0044) : rang saisi, sinon somme des classements des
 * titulaires (tous classés), puis le nom ; équipes classées devant.
 */
import { describe, expect, it } from 'vitest';
import type { TeamRow } from './team.types';
import { teamEntryKey, teamEntryRanking, teamEntryRanks } from './teamEntryRanking';

const team = (
  id: string,
  ranking: number | null,
  fencerIds: string[],
  reserve?: string
): TeamRow => ({
  id,
  name: id,
  club: id,
  ranking,
  fencers: [
    ...fencerIds.map((fencerId, i) => ({
      fencerId,
      fencerLastName: fencerId,
      fencerFirstName: '',
      teamOrder: i + 1,
      isReserve: false,
    })),
    ...(reserve
      ? [
          {
            fencerId: reserve,
            fencerLastName: reserve,
            fencerFirstName: '',
            teamOrder: 9,
            isReserve: true,
          },
        ]
      : []),
  ],
});
const RANKS: Record<string, number | null> = {
  a1: 1,
  a2: 2,
  a3: 3,
  b1: 10,
  b2: 1,
  b3: 1,
  r: 1,
  c1: 4,
};
const rankOf = (id: string) => RANKS[id] ?? null;

describe('teamEntryKey', () => {
  it('rang saisi d’abord ; sinon somme des titulaires tous classés ; remplaçant ignoré', () => {
    expect(teamEntryKey(team('T', 7, ['a1', 'a2', 'a3']), 3, rankOf)).toBe(7);
    expect(teamEntryKey(team('T', null, ['a1', 'a2', 'a3'], 'r'), 3, rankOf)).toBe(6);
    // Titulaire non classé, ou titulaires manquants : non classée
    expect(teamEntryKey(team('T', null, ['a1', 'x', 'a3']), 3, rankOf)).toBeNull();
    expect(teamEntryKey(team('T', null, ['a1', 'a2']), 3, rankOf)).toBeNull();
    // Rang ≤ 0 : ignoré
    expect(teamEntryKey(team('T', 0, ['a1', 'a2', 'a3']), 3, rankOf)).toBe(6);
  });
});

describe('teamEntryRanking', () => {
  it('classées par rang effectif, puis le nom ; non classées ensuite, par nom', () => {
    const teams = [
      team('Zulu', null, ['x', 'y', 'z']),
      team('Bravo', null, ['b1', 'b2', 'b3']), // somme 12
      team('Alpha', null, ['a1', 'a2', 'a3']), // somme 6
      team('Echo', 6, []), // rang saisi 6 : même rang qu'Alpha, départagé par le nom
      team('Delta', null, ['c1', 'x', 'y']),
      team('Kilo', 2, []),
    ];
    const order = teamEntryRanking(teams, 3, rankOf).map(t => t.id);
    expect(order).toEqual(['Kilo', 'Alpha', 'Echo', 'Bravo', 'Delta', 'Zulu']);
    expect([...teamEntryRanks(teamEntryRanking(teams, 3, rankOf)).entries()][0]).toEqual([
      'Kilo',
      1,
    ]);
  });

  it('sans aucun classement : ordre des noms (comme avant)', () => {
    const teams = [team('Charlie', null, []), team('Alpha', null, []), team('Bravo', null, [])];
    expect(teamEntryRanking(teams, 3, () => null).map(t => t.id)).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
    ]);
  });
});
