// @vitest-environment jsdom
/**
 * Import fédéral (#1938) : tireurs, équipes et arbitres par le contrat (registerFencers,
 * registerTeam, assignTeamFencer, registerReferees : #1981, docs/adr/0024).
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
      if (name === 'registerTeam') return { team: { id: 't1' } };
      if (name === 'assignTeamFencer') return {};
      return { referees: (input.referees as unknown[]).map((_, i) => ({ id: `r${i}` })) };
    });
    const client = { call, query: vi.fn(), subscribe: vi.fn() } as unknown as BpmClient;
    // Aucune écriture par le préload (docs/adr/0024, lot N)
    const createTeam = vi.fn();
    (window as { electronAPI?: unknown }).electronAPI = { db: { createTeam } };

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
    expect(call.mock.calls.map(c => c[0])).toEqual([
      'registerFencers',
      'registerTeam',
      'assignTeamFencer',
      'assignTeamFencer',
      'registerReferees',
    ]);
    expect(call.mock.calls[0][1]).toMatchObject({ competitionId: 'c1' });
    // Club absent : le nom de l'équipe par défaut (registerTeam)
    expect(call.mock.calls[1][1]).toEqual({ competitionId: 'c1', name: 'Club A' });
    expect(call.mock.calls.slice(2, 4).map(c => c[1])).toEqual([
      { competitionId: 'c1', teamId: 't1', fencerId: 'f1', teamOrder: 1, isReserve: false },
      { competitionId: 'c1', teamId: 't1', fencerId: 'f0', teamOrder: 2, isReserve: true },
    ]);
    expect(createTeam).not.toHaveBeenCalled();
  });

  it('rang d’entrée de l’équipe lu dans le fichier : transmis à registerTeam (docs/adr/0044)', async () => {
    const call = vi.fn(async (name: string, input: Record<string, unknown>) => {
      if (name === 'registerFencers') return { fencers: [] };
      if (name === 'registerTeam') return { team: { id: `t-${String(input.name)}` } };
      return { referees: [] };
    });
    const client = { call, query: vi.fn(), subscribe: vi.fn() } as unknown as BpmClient;
    await applyFederalImport(
      client,
      'c1',
      {
        fencers: [],
        teams: [
          { name: 'Club A', club: 'CE A', ranking: 3, members: [] },
          { name: 'Club B', members: [] },
        ],
        referees: [],
      } as never,
      1
    );
    const teams = call.mock.calls.filter(c => c[0] === 'registerTeam').map(c => c[1]);
    expect(teams).toEqual([
      { competitionId: 'c1', name: 'Club A', club: 'CE A', ranking: 3 },
      { competitionId: 'c1', name: 'Club B' },
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
