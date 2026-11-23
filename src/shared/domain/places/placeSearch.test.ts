import { describe, it, expect } from 'vitest';
import {
  dedupePlaces,
  geopfUrl,
  normalizePlaceQuery,
  parseGeopf,
  parsePhoton,
  photonUrl,
  placeLabel,
} from './placeSearch';

const pt = (lon: number, lat: number) => ({ type: 'Point', coordinates: [lon, lat] });

describe('placeSearch', () => {
  it('requête : espaces réduits, 3 caractères minimum', () => {
    expect(normalizePlaceQuery('  gy  ')).toBeNull();
    expect(normalizePlaceQuery('  gym   nase ')).toBe('gym nase');
  });

  it('URL Photon : langue connue ou « default »', () => {
    expect(photonUrl('salle a', 'fr')).toContain('lang=fr');
    expect(photonUrl('salle a', 'br')).toContain('lang=default');
    expect(photonUrl('salle a', 'fr')).toContain('q=salle+a');
    expect(geopfUrl('salle')).toContain('index=address%2Cpoi');
  });

  it('Photon : nom, adresse, commune', () => {
    const [p] = parsePhoton({
      features: [
        {
          properties: {
            name: 'Gymnase Jean-Jaurès',
            street: 'Avenue Jean Jaurès',
            housenumber: '12',
            city: 'Châtenay-Malabry',
            postcode: '92290',
          },
          geometry: pt(2.25, 48.76),
        },
      ],
    });
    expect(p).toEqual({
      name: 'Gymnase Jean-Jaurès',
      address: '12 Avenue Jean Jaurès, 92290 Châtenay-Malabry',
      city: 'Châtenay-Malabry',
      postcode: '92290',
      lat: 48.76,
      lon: 2.25,
      source: 'osm',
    });
    expect(placeLabel(p)).toBe('Gymnase Jean-Jaurès, Châtenay-Malabry');
  });

  it('Photon : adresse sans nom → nom = adresse', () => {
    const [p] = parsePhoton({
      features: [
        { properties: { street: 'Rue X', city: 'Rennes', postcode: '35000' }, geometry: pt(0, 0) },
      ],
    });
    expect(p.name).toBe('Rue X, 35000 Rennes');
    expect(p.address).toBe('');
    expect(placeLabel(p)).toBe('Rue X, 35000 Rennes');
  });

  it('Géoplateforme : lieu (tableaux) et adresse', () => {
    const list = parseGeopf({
      features: [
        {
          properties: {
            _type: 'poi',
            toponym: 'Gymnase Jean Jaurès',
            name: ['Gymnase Jean Jaurès'],
            city: ['Tarare'],
            postcode: ['69170'],
          },
          geometry: pt(4.43, 45.89),
        },
        {
          properties: {
            _type: 'address',
            label: '8 Boulevard du Port 80000 Amiens',
            name: '8 Boulevard du Port',
            city: 'Amiens',
            postcode: '80000',
          },
          geometry: pt(2.29, 49.89),
        },
      ],
    });
    expect(list.map(p => [p.name, p.address, p.city])).toEqual([
      ['Gymnase Jean Jaurès', '69170 Tarare', 'Tarare'],
      ['8 Boulevard du Port', '8 Boulevard du Port 80000 Amiens', 'Amiens'],
    ]);
  });

  it('réponse invalide → liste vide ; doublons retirés', () => {
    expect(parsePhoton(null)).toEqual([]);
    expect(parseGeopf({ features: [{ properties: {}, geometry: pt(0, 0) }, 'x'] })).toEqual([]);
    const a = parsePhoton({
      features: [
        { properties: { name: 'A', city: 'B' }, geometry: pt(0, 0) },
        { properties: { name: 'a', city: 'b' }, geometry: pt(1, 1) },
      ],
    });
    expect(dedupePlaces(a)).toHaveLength(1);
  });
});
