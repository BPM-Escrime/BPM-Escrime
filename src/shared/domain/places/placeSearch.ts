/**
 * BPM - Escrime - Recherche de lieu (docs/adr/0026)
 * Règles pures : requête admise, URL des services gratuits (Photon / OpenStreetMap, puis
 * Géoplateforme de l'IGN en secours), lecture de leurs réponses GeoJSON en suggestions.
 * L'appel réseau est fait par le processus principal (src/main/placeSearch.ts).
 * Licensed under GPL-3.0
 */

export type PlaceSource = 'osm' | 'ign';

export interface PlaceSuggestion {
  /** Nom du lieu (« Gymnase Jean-Jaurès ») ; à défaut, l'adresse */
  name: string;
  /** Adresse sur une ligne (« Avenue Jean Jaurès, 92290 Châtenay-Malabry ») ; peut être vide */
  address: string;
  city: string;
  postcode: string;
  lat: number;
  lon: number;
  source: PlaceSource;
}

export const PLACE_QUERY_MIN = 3;
export const PLACE_QUERY_MAX = 200;
export const PLACE_LIMIT = 6;

export const PHOTON_URL = 'https://photon.komoot.io/api/';
export const GEOPF_URL = 'https://data.geopf.fr/geocodage/search';

/** Langues de Photon ; les autres → « default » (noms locaux) */
const PHOTON_LANGS = ['fr', 'en', 'de'];

/** Requête nettoyée ; null si trop courte pour chercher */
export function normalizePlaceQuery(raw: string): string | null {
  const q = raw.replace(/\s+/g, ' ').trim().slice(0, PLACE_QUERY_MAX);
  return q.length >= PLACE_QUERY_MIN ? q : null;
}

export function photonUrl(query: string, language: string): string {
  const lang = PHOTON_LANGS.includes(language) ? language : 'default';
  const p = new URLSearchParams({ q: query, limit: String(PLACE_LIMIT), lang });
  return `${PHOTON_URL}?${p.toString()}`;
}

export function geopfUrl(query: string): string {
  const p = new URLSearchParams({ q: query, index: 'address,poi', limit: String(PLACE_LIMIT) });
  return `${GEOPF_URL}?${p.toString()}`;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Texte d'une propriété : chaîne, ou premier élément d'un tableau (Géoplateforme, index poi) */
const str = (v: unknown): string => {
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0].trim();
  return '';
};
const join = (parts: string[], sep: string) => parts.filter(Boolean).join(sep);

function features(body: unknown): { props: Obj; lon: number; lat: number }[] {
  if (!isObj(body) || !Array.isArray(body.features)) return [];
  const out: { props: Obj; lon: number; lat: number }[] = [];
  for (const f of body.features) {
    if (!isObj(f) || !isObj(f.properties) || !isObj(f.geometry)) continue;
    const c = f.geometry.coordinates;
    if (!Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number') continue;
    out.push({ props: f.properties, lon: c[0], lat: c[1] });
  }
  return out;
}

/** Réponse Photon (GeoJSON, propriétés OpenStreetMap) */
export function parsePhoton(body: unknown): PlaceSuggestion[] {
  return features(body).flatMap(({ props, lon, lat }) => {
    const street = join([str(props.housenumber), str(props.street)], ' ');
    const city = str(props.city) || str(props.locality) || str(props.county);
    const postcode = str(props.postcode);
    const address = join([street, join([postcode, city], ' ')], ', ');
    const name = str(props.name) || address;
    if (!name) return [];
    return [
      { name, address: address === name ? '' : address, city, postcode, lat, lon, source: 'osm' },
    ];
  });
}

/** Réponse Géoplateforme (adresses : label ; lieux : toponym, tableaux) */
export function parseGeopf(body: unknown): PlaceSuggestion[] {
  return features(body).flatMap(({ props, lon, lat }) => {
    const city = str(props.city);
    const postcode = str(props.postcode);
    const isPoi = props._type === 'poi';
    const name = isPoi ? str(props.toponym) || str(props.name) : str(props.name);
    const address = isPoi ? join([postcode, city], ' ') : str(props.label);
    if (!name && !address) return [];
    return [
      {
        name: name || address,
        address: address === name ? '' : address,
        city,
        postcode,
        lat,
        lon,
        source: 'ign' as const,
      },
    ];
  });
}

/** Doublons (même nom, même commune) retirés, ordre du service gardé */
export function dedupePlaces(list: PlaceSuggestion[]): PlaceSuggestion[] {
  const seen = new Set<string>();
  return list.filter(p => {
    const key = `${p.name}|${p.postcode}|${p.city}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Texte du champ « Lieu » une fois la suggestion choisie : nom, commune */
export function placeLabel(p: PlaceSuggestion): string {
  if (!p.city || p.name.includes(p.city) || p.address === '') return p.name;
  return `${p.name}, ${p.city}`;
}
