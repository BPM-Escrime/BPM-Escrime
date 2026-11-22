/**
 * persistCompetitionUpdate (docs/adr/0018) : seuls les champs modifiés partent, chacun vers sa
 * commande (données sans règle, ou arme et réglages).
 */
import { describe, it, expect, vi } from 'vitest';
import { persistCompetitionUpdate } from './competitionUpdate';
import type { BpmClient } from '../../shared/api/client';
import type { Competition } from '../../shared/types';

const before = {
  id: 'c1',
  title: 'Open',
  date: new Date('2026-12-06T00:00:00.000Z'),
  location: 'Lyon',
  weapon: 'E',
  gender: 'M',
  category: 'SEN',
  isTeamEvent: false,
  settings: { thirdPlaceMatch: false, defaultPoolMaxScore: 5 },
} as unknown as Competition;

const client = () => {
  const call = vi.fn(async () => ({}));
  return { client: { call, query: vi.fn(), subscribe: vi.fn() } as unknown as BpmClient, call };
};

describe('persistCompetitionUpdate', () => {
  it('rien de changé : aucune commande', async () => {
    const { client: c, call } = client();
    await persistCompetitionUpdate(c, before, { ...before });
    expect(call).not.toHaveBeenCalled();
  });

  it('titre et lieu → updateCompetitionDetails ; réglage modifié seul → updateCompetitionSettings', async () => {
    const { client: c, call } = client();
    await persistCompetitionUpdate(c, before, {
      ...before,
      title: 'Open 2',
      location: '',
      settings: { ...before.settings, thirdPlaceMatch: true },
    });
    expect(call).toHaveBeenCalledWith('updateCompetitionDetails', {
      competitionId: 'c1',
      details: { title: 'Open 2', location: null },
    });
    expect(call).toHaveBeenCalledWith('updateCompetitionSettings', {
      competitionId: 'c1',
      settings: { thirdPlaceMatch: true },
    });
  });

  it('arme changée : updateCompetitionSettings sans réglages', async () => {
    const { client: c, call } = client();
    await persistCompetitionUpdate(c, before, { weapon: 'S' as never });
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith('updateCompetitionSettings', {
      competitionId: 'c1',
      weapon: 'S',
    });
  });
});
