/**
 * Lecture d'une épreuve par le contrat (docs/adr/0018) : dates rendues en Date, tireurs
 * joints sur demande, épreuve absente → null.
 */
import { describe, it, expect, vi } from 'vitest';
import { loadCompetition } from './competitionMapping';
import { ApiError, type BpmClient } from '../../shared/api/client';

const dto = {
  id: 'c1',
  title: 'Open',
  shortTitle: null,
  date: '2026-12-06T00:00:00.000Z',
  location: 'Lyon',
  organizer: null,
  weapon: 'E',
  gender: 'M',
  category: 'SEN',
  championship: null,
  color: null,
  isTeamEvent: false,
  status: 'draft',
  fencerCount: 2,
  settings: { thirdPlaceMatch: true },
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-02T00:00:00.000Z',
};

const clientWith = (query: (name: string) => unknown) =>
  ({
    call: vi.fn(),
    subscribe: vi.fn(),
    query: vi.fn(async (n: string) => query(n)),
  }) as unknown as BpmClient;

describe('loadCompetition', () => {
  it('épreuve convertie : Date, réglages, sans tireurs par défaut', async () => {
    const c = await loadCompetition(
      clientWith(() => dto),
      'c1'
    );
    expect(c?.date).toBeInstanceOf(Date);
    expect(c?.date.toISOString()).toBe(dto.date);
    expect(c).toMatchObject({ location: 'Lyon', fencerCount: 2, fencers: [], color: '#3B82F6' });
    expect(c?.settings.thirdPlaceMatch).toBe(true);
    expect(c).not.toHaveProperty('organizer');
  });

  it('avec les tireurs : listFencers joint', async () => {
    const c = await loadCompetition(
      clientWith(n =>
        n === 'listFencers'
          ? [{ id: 'f1', ref: 1, lastName: 'A', firstName: 'B', birthDate: null, status: 'N' }]
          : dto
      ),
      'c1',
      { withFencers: true }
    );
    expect(c?.fencers.map(f => f.id)).toEqual(['f1']);
  });

  it('épreuve absente : null ; autre erreur : propagée', async () => {
    const missing = clientWith(() => {
      throw new ApiError('competition_not_found', 'introuvable');
    });
    expect(await loadCompetition(missing, 'x')).toBeNull();
    const broken = clientWith(() => {
      throw new ApiError('internal', 'panne');
    });
    await expect(loadCompetition(broken, 'x')).rejects.toMatchObject({ code: 'internal' });
  });
});
