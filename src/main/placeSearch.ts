/**
 * BPM - Escrime - Recherche de lieu depuis le poste (docs/adr/0026)
 * La CSP de l'écran bloque les hôtes externes : l'appel part d'ici. Photon (OpenStreetMap)
 * d'abord, Géoplateforme (IGN) si Photon échoue ou ne trouve rien. Gratuits, sans clé.
 * Seul le texte tapé part sur le réseau ; réponses gardées en mémoire (session).
 * Licensed under GPL-3.0
 */
import {
  dedupePlaces,
  geopfUrl,
  parseGeopf,
  parsePhoton,
  photonUrl,
  type PlaceSuggestion,
} from '../shared/domain/places/placeSearch';

export interface PlaceSearchResult {
  suggestions: PlaceSuggestion[];
  /** Aucun service joignable (hors ligne, refus) */
  unavailable: boolean;
}

const TIMEOUT_MS = 5000;
const CACHE_MAX = 100;
const USER_AGENT = 'BPM-Escrime (fencing tournament manager)';

export function createPlaceSearch(fetchImpl: typeof fetch = fetch) {
  const cache = new Map<string, PlaceSuggestion[]>();

  const get = async (url: string): Promise<unknown> => {
    const res = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };

  return async (query: string, language: string): Promise<PlaceSearchResult> => {
    const key = `${language}|${query.toLowerCase()}`;
    const hit = cache.get(key);
    if (hit) return { suggestions: hit, unavailable: false };

    let reached = false;
    let found: PlaceSuggestion[] = [];
    try {
      found = parsePhoton(await get(photonUrl(query, language)));
      reached = true;
    } catch {
      // Photon injoignable : secours
    }
    if (found.length === 0) {
      try {
        found = parseGeopf(await get(geopfUrl(query)));
        reached = true;
      } catch {
        // Les deux services sont injoignables
      }
    }
    if (!reached) return { suggestions: [], unavailable: true };
    const suggestions = dedupePlaces(found);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, suggestions);
    return { suggestions, unavailable: false };
  };
}
