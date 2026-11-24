/**
 * Tests unitaires - équipe retirée ou exclue, pénalités du relais (docs/adr/0028 §§ 3, 4)
 * BPM - Escrime
 */
import { describe, it, expect } from 'vitest';
import { nextTeamMatchStarted, withoutWithdrawnTeams } from './teamWithdrawal';
import { relayPenaltyTouches } from './teamCards';

const meeting = (
  id: string,
  a: string,
  b: string,
  status = 'not_started',
  bouts = ['not_started']
) => ({
  id,
  teamAId: a,
  teamBId: b,
  status,
  bouts: bouts.map(s => ({ status: s })),
});

describe('withoutWithdrawnTeams (o.99.8)', () => {
  it('retire l’équipe et toutes ses rencontres, y compris celles gagnées par ses adversaires', () => {
    const teams = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
    const matches = [
      meeting('1', 'A', 'B', 'finished'),
      meeting('2', 'B', 'C'),
      meeting('3', 'C', 'A'),
    ];
    const out = withoutWithdrawnTeams(teams, matches, new Set(['A']));
    expect(out.teams.map(t => t.id)).toEqual(['B', 'C']);
    expect(out.matches.map(m => m.id)).toEqual(['2']);
  });
});

describe('nextTeamMatchStarted', () => {
  const list = [meeting('1', 'A', 'B', 'finished'), meeting('2', 'C', 'D'), meeting('3', 'A', 'C')];

  it('rencontre suivante de l’équipe pas commencée, puis commencée (relais en cours)', () => {
    expect(nextTeamMatchStarted(list, '1', 'A')).toBe(false);
    const started = [...list.slice(0, 2), meeting('3', 'A', 'C', 'not_started', ['in_progress'])];
    expect(nextTeamMatchStarted(started, '1', 'A')).toBe(true);
    // B n'est pas de la rencontre 3
    expect(nextTeamMatchStarted(started, '1', 'B')).toBe(false);
  });

  it('rencontre d’une autre équipe ou antérieure : sans effet ; rencontre inconnue : false', () => {
    const other = [meeting('0', 'A', 'D', 'finished'), ...list];
    expect(nextTeamMatchStarted(other, '1', 'A')).toBe(false);
    expect(nextTeamMatchStarted(list, 'x', 'A')).toBe(false);
  });
});

describe('relayPenaltyTouches (t.162.2)', () => {
  it('un rouge donne une touche à l’équipe adverse ; jaunes et noirs sans touche', () => {
    const relay = { fencerAId: 'a', fencerBId: 'b' };
    const cards = [
      { fencerId: 'a', type: 'RED' },
      { fencerId: 'a', type: 'RED' },
      { fencerId: 'b', type: 'YELLOW' },
      { fencerId: 'b', type: 'BLACK' },
    ];
    expect(relayPenaltyTouches(relay, cards)).toEqual({ A: 0, B: 2 });
  });
});
