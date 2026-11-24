/**
 * BPM - Escrime - Stockage clé/valeur injecté (#2203)
 * Le code partagé n'accède pas directement à localStorage : il passe par ce port, comme pour
 * l'heure et le hasard (docs/adr/0002). Par défaut, le localStorage du navigateur ; un test, le
 * main ou le MCP peuvent en injecter un autre. Les erreurs remontent à l'appelant : la clé de
 * chiffrement du nuage ne doit pas être perdue en silence.
 * Licensed under GPL-3.0
 */

export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

let injected: KeyValueStore | null = null;

/** Remplace le stockage (null : retour au localStorage du navigateur) */
export function setKeyValueStore(store: KeyValueStore | null): void {
  injected = store;
}

/** Stockage courant ; lève si aucun n'est disponible (hors navigateur, sans injection) */
export function keyValueStore(): KeyValueStore {
  if (injected) return injected;
  const browser = globalThis.localStorage as KeyValueStore | undefined;
  if (!browser) throw new Error('key_value_store_unavailable');
  return browser;
}
