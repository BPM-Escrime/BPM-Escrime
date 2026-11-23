import { describe, it, expect, vi } from 'vitest';
import { createPlaceSearch } from './placeSearch';

const json = (body: unknown, ok = true) =>
  Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) } as Response);
const feature = (props: Record<string, unknown>) => ({
  features: [{ properties: props, geometry: { coordinates: [1, 2] } }],
});

describe('createPlaceSearch', () => {
  it('Photon répond : pas d’appel à la Géoplateforme, réponse gardée', async () => {
    const fetchImpl = vi.fn(() => json(feature({ name: 'Salle', city: 'Vitré' })));
    const search = createPlaceSearch(fetchImpl as unknown as typeof fetch);
    const r = await search('salle', 'fr');
    expect(r.unavailable).toBe(false);
    expect(r.suggestions[0].source).toBe('osm');
    await search('SALLE', 'fr');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]).startsWith('https://photon.komoot.io/')).toBe(true);
  });

  it('Photon en panne → Géoplateforme', async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(() => json({}, false))
      .mockImplementationOnce(() => json(feature({ _type: 'poi', toponym: 'Gymnase' })));
    const r = await createPlaceSearch(fetchImpl as unknown as typeof fetch)('gymnase', 'fr');
    expect(r.suggestions.map(s => [s.name, s.source])).toEqual([['Gymnase', 'ign']]);
  });

  it('hors ligne → unavailable, rien de gardé', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new Error('offline')));
    const search = createPlaceSearch(fetchImpl as unknown as typeof fetch);
    expect(await search('gymnase', 'fr')).toEqual({ suggestions: [], unavailable: true });
    await search('gymnase', 'fr');
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});
