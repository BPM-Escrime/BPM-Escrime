/**
 * Données de secours des exports des résultats lues par le contrat (#1981) : chaque lecture
 * isolée, un échec rend la valeur vide.
 */
import { describe, it, expect, vi } from 'vitest';
import type { BpmClient } from '../../../shared/api/client';
import type { Pool } from '../../../shared/types';
import {
  loadExportFencers,
  loadExportPoolSignatures,
  loadExportState,
  loadExportTableauSignatures,
} from './resultsExportData';

const clientWith = (query: (name: string, input: Record<string, unknown>) => unknown) =>
  ({
    query: vi.fn(async (n: string, i: Record<string, unknown>) => query(n, i)),
    call: vi.fn(),
    subscribe: vi.fn(),
  }) as unknown as BpmClient;

const failing = clientWith(() => {
  throw new Error('x');
});

describe('resultsExportData', () => {
  it('tireurs : listFencers converti au format de l’écran ; échec : liste vide', async () => {
    const client = clientWith(() => [
      {
        id: 'f1',
        ref: 1,
        lastName: 'Dupont',
        firstName: 'Ana',
        birthDate: null,
        gender: 'F',
        nationality: 'FRA',
        region: null,
        department: null,
        club: null,
        license: null,
        ranking: null,
        handedness: null,
        status: 'P',
        exclusionReason: null,
        seedNumber: null,
        initialRanking: null,
        finalRanking: null,
        photo: null,
      },
    ]);
    const fencers = await loadExportFencers(client, 'c1');
    expect(fencers).toHaveLength(1);
    expect(fencers[0]).toMatchObject({ id: 'f1', lastName: 'Dupont' });
    expect(client.query).toHaveBeenCalledWith('listFencers', { competitionId: 'c1' });
    expect(await loadExportFencers(failing, 'c1')).toEqual([]);
  });

  it('poules et tableau : état de l’épreuve ; sans état ou échec : vides', async () => {
    const pools = [{ id: 'p1' }];
    const tableauMatches = [{ id: 't1' }];
    const client = clientWith(() => ({
      revision: 1,
      sessionRevision: 1,
      state: { pools, tableauMatches },
    }));
    expect(await loadExportState(client, 'c1')).toEqual({ pools, tableauMatches });
    const empty = clientWith(() => ({ revision: 0, sessionRevision: 0, state: null }));
    expect(await loadExportState(empty, 'c1')).toEqual({ pools: [], tableauMatches: [] });
    expect(await loadExportState(failing, 'c1')).toEqual({ pools: [], tableauMatches: [] });
  });

  it('signatures des poules par poule et tireur ; échec : objet vide', async () => {
    const client = clientWith((_n, i) =>
      i.poolId === 'p1' ? [{ fencerId: 'f1', signatureData: 'S1' }] : []
    );
    const pools = [{ id: 'p1' }, { id: 'p2' }] as Pool[];
    expect(await loadExportPoolSignatures(client, pools)).toEqual({ p1: { f1: 'S1' }, p2: {} });
    expect(await loadExportPoolSignatures(failing, pools)).toEqual({});
  });

  it('signatures du tableau rangées par côté ; échec : objet vide', async () => {
    const client = clientWith(() => [{ matchId: 't1', fencerId: 'a', signatureData: 'SA' }]);
    const m = { id: 't1', fencerA: { id: 'a' }, fencerB: { id: 'b' } } as never;
    expect(await loadExportTableauSignatures(client, [m])).toEqual({ t1: { A: 'SA' } });
    expect(await loadExportTableauSignatures(failing, [m])).toEqual({});
  });
});
