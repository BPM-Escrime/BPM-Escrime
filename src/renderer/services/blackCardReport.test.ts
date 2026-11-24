// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { blackCardReasonLabels, buildBlackCardEntries } from './blackCardReport';
import { FencerStatus, MatchStatus, Weapon, type Fencer, type Pool } from '../../shared/types';
import type { BpmClient } from '../../shared/api/client';

const f = (id: string, last: string, excluded = false) =>
  ({
    id,
    lastName: last,
    firstName: 'X',
    status: excluded ? FencerStatus.EXCLUDED : FencerStatus.CHECKED_IN,
    exclusionReason: excluded ? 'black_card' : null,
  }) as unknown as Fencer;

describe('buildBlackCardEntries (#1829)', () => {
  it('match de la sanction : celui qui porte le carton noir en base', async () => {
    const a = f('a', 'Alpha', true);
    const b = f('b', 'Bravo');
    const c = f('c', 'Charlie');
    const match = (id: string, x: Fencer, y: Fencer, sx: number, sy: number) => ({
      id,
      fencerA: x,
      fencerB: y,
      scoreA: { value: sx },
      scoreB: { value: sy },
      status: MatchStatus.FINISHED,
    });
    const pool = {
      number: 3,
      strip: 7,
      matches: [match('m1', a, b, 5, 2), match('m2', c, a, 4, 1)],
    } as unknown as Pool;
    // Contrat d'API (#1981) : requête getMatchCards simulée
    const client = {
      query: vi.fn(async (_name: string, { matchId }: { matchId: string }) =>
        matchId === 'm2'
          ? [{ fencerId: 'a', cardType: 'black', timestamp: '2026-11-15T10:00:00Z' }]
          : []
      ),
      call: vi.fn(),
      subscribe: vi.fn(),
    } as unknown as BpmClient;
    const [entry] = await buildBlackCardEntries([a, b, c], [pool], [], client);
    expect(client.query).toHaveBeenCalledWith('getMatchCards', { matchId: 'm1' });
    expect(entry).toMatchObject({
      fencer: { lastName: 'Alpha' },
      phase: 'Poule 3',
      opponent: 'CHARLIE X',
      score: '1 – 4',
      strip: 7,
    });
    expect(entry.at?.toISOString()).toBe('2026-11-15T10:00:00.000Z');
  });

  it('aucun exclu : rien', async () => {
    expect(await buildBlackCardEntries([f('a', 'Alpha')])).toEqual([]);
  });

  it('journal : match, heure et source du retrait sur carton noir (#2190)', async () => {
    const a = f('a', 'Alpha', true);
    const b = f('b', 'Bravo');
    const pool = {
      number: 1,
      matches: [
        {
          id: 'm1',
          fencerA: a,
          fencerB: b,
          scoreA: { value: 2 },
          scoreB: { value: 5 },
          status: MatchStatus.FINISHED,
        },
      ],
    } as unknown as Pool;
    const event = {
      type: 'FencerWithdrawn',
      schemaVersion: 1,
      payload: {
        fencerId: 'a',
        reason: 'exclusion',
        blackCard: true,
        matchId: 'm1',
        forfeitedMatchIds: [],
      },
      eventId: 'e1',
      commandId: 'k1',
      revision: 4,
      author: null,
      source: 'tablet',
      at: '2026-11-20T14:05:00Z',
    };
    const client = {
      query: vi.fn(async (name: string) =>
        name === 'getCompetitionEvents' ? { revision: 4, events: [event] } : []
      ),
    } as unknown as BpmClient;
    const [entry] = await buildBlackCardEntries([a, b], [pool], [], client, {
      competitionId: 'c1',
    });
    expect(client.query).not.toHaveBeenCalledWith('getMatchCards', expect.anything());
    expect(entry).toMatchObject({
      phase: 'Poule 1',
      opponent: 'BRAVO X',
      score: '2 – 5',
      source: 'Tablette d’arbitre',
    });
    expect(entry.at?.toISOString()).toBe('2026-11-20T14:05:00.000Z');
  });

  it('appel DT : tireur demandé, même pas encore exclu', async () => {
    const client = { query: vi.fn(async () => []) } as unknown as BpmClient;
    const out = await buildBlackCardEntries(
      [f('a', 'Alpha'), f('b', 'Bravo', true)],
      [],
      [],
      client,
      {
        fencerIds: ['a'],
      }
    );
    expect(out.map(e => e.fencer.lastName)).toEqual(['Alpha']);
  });

  it('motifs du 4e groupe par règlement', () => {
    expect(blackCardReasonLabels(Weapon.EPEE)).toContain('Refus du salut');
    expect(blackCardReasonLabels(Weapon.LASER)).toEqual([
      'Refus de combattre',
      'Anti-sportif',
      'Tricherie',
    ]);
  });
});
