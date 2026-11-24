/**
 * BPM - Escrime - Cartons P (non-combativité, t.124) : types et rangement en table, module
 * feuille (dépôt, rejeu du journal) ; règles : `passivityCards.ts` (docs/adr/0028 § 5 bis).
 * Licensed under GPL-3.0
 */

/** Escalade t.124 sur la rencontre */
export const PASSIVITY_STEPS = ['yellow', 'red', 'black'] as const;
export type PassivityCardType = (typeof PASSIVITY_STEPS)[number];

/** Rangement dans team_match_cards : team_id NULL, type préfixé (migration 49) */
export const PASSIVITY_TYPE_PREFIX = 'p_';
export const PASSIVITY_REASON = 'passivity';

/** Type rangé en table (`p_yellow`…) → type du carton ; null : pas un carton P */
export function passivityTypeOf(stored: string): PassivityCardType | null {
  if (!stored.startsWith(PASSIVITY_TYPE_PREFIX)) return null;
  const type = stored.slice(PASSIVITY_TYPE_PREFIX.length);
  return (PASSIVITY_STEPS as readonly string[]).includes(type) ? (type as PassivityCardType) : null;
}
