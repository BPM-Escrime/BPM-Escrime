/**
 * projectCompetition (docs/adr/0017, étape 5) : règles du rejeu, sans base.
 */
import { describe, it, expect } from 'vitest';
import type { JournalEventBody } from '../../api/events';
import { projectCompetition } from './projectCompetition';

const ev = <T extends JournalEventBody['type']>(
  type: T,
  payload: Extract<JournalEventBody, { type: T }>['payload']
) => ({ type, schemaVersion: 1, payload }) as JournalEventBody;

const drawn = (round: number, poolId = `p${round}`) =>
  ev('PoolsGenerated', {
    round,
    pools: [
      {
        poolId,
        number: 1,
        strip: null,
        fencerIds: ['a', 'b', 'c'],
        matches: [
          { matchId: `${poolId}-1`, fencerAId: 'a', fencerBId: 'b' },
          { matchId: `${poolId}-2`, fencerAId: 'b', fencerBId: 'c' },
        ],
      },
    ],
  });
const tableau = ev('TableauGenerated', {
  size: 2,
  thirdPlaceMatch: false,
  playAllPositions: false,
  matches: [
    {
      matchId: '2-0',
      round: 2,
      position: 0,
      fencerAId: 'a',
      fencerBId: 'b',
      isBye: false,
      seedA: 1,
      seedB: 2,
    },
  ],
});

describe('projectCompetition', () => {
  it('journal complet seulement s’il commence (après l’appel) par un tirage', () => {
    expect(projectCompetition([]).complete).toBe(false);
    expect(projectCompetition([ev('FencerCheckedIn', { fencerId: 'a' }), drawn(1)]).complete).toBe(
      true
    );
    expect(projectCompetition([ev('ScoreRecorded', score('x', 5, 1)), drawn(1)]).complete).toBe(
      false
    );
  });

  it('tirage refait sur le même tour : il remplace le précédent', () => {
    const facts = projectCompetition([drawn(1, 'old'), drawn(1, 'new')]);
    expect(facts.rounds.map(r => r.pools[0].poolId)).toEqual(['new']);
  });

  it('score, annulation ; statut spécial : perdant seulement', () => {
    const facts = projectCompetition([
      drawn(1),
      ev('ScoreRecorded', score('p1-1', 5, 2)),
      ev('ScoreRecorded', {
        matchId: 'p1-2',
        poolId: 'p1',
        scoreA: 1,
        scoreB: 0,
        winnerId: 'b',
        specialStatus: 'abandon',
        fencerId: 'c',
      }),
      ev('ScoreCleared', { matchId: 'p1-1', poolId: 'p1' }),
    ]);
    expect(facts.rounds[0].pools[0].matches.map(m => m.result)).toEqual([null, { loserId: 'c' }]);
  });

  it('correction avec tableau à refaire : tableau retiré', () => {
    const facts = projectCompetition([
      drawn(1),
      tableau,
      ev('ScoreRecorded', {
        ...score('p1-1', 5, 4),
        correction: { reason: 'erreur', rebuildTableau: true },
      }),
    ]);
    expect(facts.tableau).toBeNull();
    expect(facts.rounds[0].pools[0].matches[0].result).toMatchObject({ scoreA: 5, scoreB: 4 });
  });

  it('tableau : décision, retrait puis réintégration (match rouvert)', () => {
    const decided = projectCompetition([
      drawn(1),
      tableau,
      ev('FencerWithdrawn', {
        fencerId: 'b',
        reason: 'forfait',
        blackCard: false,
        matchId: '2-0',
        forfeitedMatchIds: ['2-0'],
      }),
      ev('TableauMatchDecided', { matchId: '2-0', winnerId: 'a' }),
    ]);
    expect(decided.bracketResults['2-0']).toEqual({ loserId: 'b', winnerId: 'a' });
    expect(decided.fencerStatus.b).toBe('F');
    const reopened = projectCompetition([
      drawn(1),
      tableau,
      ev('FencerWithdrawn', {
        fencerId: 'b',
        reason: 'forfait',
        blackCard: false,
        matchId: '2-0',
        forfeitedMatchIds: ['2-0'],
      }),
      ev('FencerReinstated', { fencerId: 'b', restoredStatus: 'Q', restoredMatchIds: ['2-0'] }),
    ]);
    expect(reopened.bracketResults).toEqual({});
    expect(reopened.fencerStatus.b).toBe('Q');
  });

  it('rapières : vague, arrêt, remise à zéro au tirage suivant', () => {
    const facts = projectCompetition([
      drawn(1),
      ev('RapieresWaveLaunched', { wave: 2, matchIds: [] }),
      ev('RapieresWavesEnded', { ended: true }),
    ]);
    expect(facts.rapieres).toEqual({ wave: 2, ended: true });
    expect(
      projectCompetition([
        drawn(1),
        ev('RapieresWaveLaunched', { wave: 2, matchIds: [] }),
        drawn(2),
      ]).rapieres
    ).toEqual({ wave: 0, ended: false });
  });
});

function score(matchId: string, scoreA: number, scoreB: number) {
  return { matchId, poolId: 'p1', scoreA, scoreB, winnerId: scoreA > scoreB ? 'a' : 'b' };
}

describe('tableaux séparés après les poules (docs/adr/0024)', () => {
  const groupTableau = (group: string) =>
    ev('TableauGenerated', {
      group,
      size: 2,
      thirdPlaceMatch: false,
      playAllPositions: false,
      matches: [
        {
          matchId: `${group}:2-0`,
          round: 2,
          position: 0,
          fencerAId: `${group}a`,
          fencerBId: `${group}b`,
          isBye: false,
          seedA: 1,
          seedB: 2,
        },
      ],
    });
  const decided = (group: string) =>
    ev('TableauMatchDecided', { matchId: `${group}:2-0`, winnerId: `${group}a` });

  it('un tableau par groupe ; décisions rangées dans leur tableau', () => {
    const facts = projectCompetition([
      drawn(1),
      groupTableau('F'),
      groupTableau('M'),
      decided('F'),
      decided('M'),
      ev('TableauCleared', { group: 'M' }),
    ]);
    expect(facts.tableau).toBeNull();
    expect(Object.keys(facts.groupTableaux)).toEqual(['F']);
    expect(Object.keys(facts.bracketResults)).toEqual(['F:2-0']);
  });

  it('nouveau tirage d’un groupe : ses décisions seules sont retirées', () => {
    const facts = projectCompetition([
      drawn(1),
      groupTableau('F'),
      groupTableau('M'),
      decided('F'),
      decided('M'),
      groupTableau('F'),
    ]);
    expect(Object.keys(facts.bracketResults)).toEqual(['M:2-0']);
  });

  it('nouveau tirage des poules : tous les tableaux retirés', () => {
    const facts = projectCompetition([drawn(1), groupTableau('F'), decided('F'), drawn(1)]);
    expect(facts.groupTableaux).toEqual({});
    expect(facts.bracketResults).toEqual({});
  });
});
