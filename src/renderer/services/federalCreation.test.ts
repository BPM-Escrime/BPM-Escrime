// @vitest-environment jsdom
/**
 * Import fédéral (#1938) : tireurs et arbitres par le contrat (registerFencers,
 * registerReferees, #1981) ; équipes encore par l'écran (#2100).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { BpmClient } from '../../shared/api/client';
import { applyFederalImport } from './federalCreation';

const dto = (id: string, lastName: string, firstName: string) => ({
  id,
  ref: 1,
  lastName,
  firstName,
  birthDate: null,
  gender: 'M',
  nationality: 'FRA',
  region: null,
  department: null,
  club: null,
  license: null,
  ranking: null,
  handedness: null,
  status: 'N',
  exclusionReason: null,
  seedNumber: null,
  initialRanking: null,
  finalRanking: null,
  photo: null,
});

afterEach(() => {
  delete (window as { electronAPI?: unknown }).electronAPI;
});

describe('applyFederalImport', () => {
  it('inscrit tireurs et arbitres d’un bloc, équipes avec leurs membres', async () => {
    const call = vi.fn(async (name: string, input: Record<string, unknown>) => {
      if (name === 'registerFencers') {
        const list = input.fencers as Array<{ lastName: string; firstName: string }>;
        return { fencers: list.map((f, i) => dto(`f${i}`, f.lastName, f.firstName)) };
      }
      return { referees: (input.referees as unknown[]).map((_, i) => ({ id: `r${i}` })) };
    });
    const client = { call, query: vi.fn(), subscribe: vi.fn() } as unknown as BpmClient;
    const createTeam = vi.fn().mockResolvedValue({ id: 't1' });
    const upsertTeamFencer = vi.fn().mockResolvedValue(undefined);
    (window as { electronAPI?: unknown }).electronAPI = { db: { createTeam, upsertTeamFencer } };

    const counts = await applyFederalImport(
      client,
      'c1',
      {
        fencers: [
          { lastName: 'Dupont', firstName: 'Ana' },
          { lastName: 'Martin', firstName: 'Léo' },
        ],
        teams: [{ name: 'Club A', members: ['N:MARTIN|léo', 'N:DUPONT|ana'] }],
        referees: [{ firstName: 'Paul', lastName: 'Durand', gender: 'M', nationality: 'FRA' }],
      } as never,
      1
    );

    expect(counts).toEqual({ fencers: 2, teams: 1, referees: 1 });
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[0][1]).toMatchObject({ competitionId: 'c1' });
    expect(call.mock.calls[1][0]).toBe('registerReferees');
    expect(upsertTeamFencer.mock.calls).toEqual([
      ['t1', 'f1', 1, false],
      ['t1', 'f0', 2, true],
    ]);
  });

  it('bloc refusé : un par un, l’entrée invalide seule écartée', async () => {
    const call = vi.fn(async (name: string, input: Record<string, unknown>) => {
      const list = input.fencers as Array<{ lastName: string; firstName: string }>;
      if (list.some(f => !f.firstName)) throw new Error('invalid_input');
      return { fencers: list.map((f, i) => dto(`f${i}`, f.lastName, f.firstName)) };
    });
    const client = { call, query: vi.fn(), subscribe: vi.fn() } as unknown as BpmClient;
    const counts = await applyFederalImport(
      client,
      'c1',
      {
        fencers: [
          { lastName: 'Dupont', firstName: 'Ana' },
          { lastName: 'Sans', firstName: '' },
        ],
        teams: [],
        referees: [],
      } as never,
      3
    );
    expect(counts).toEqual({ fencers: 1, teams: 0, referees: 0 });
    expect(call).toHaveBeenCalledTimes(3);
  });
});
