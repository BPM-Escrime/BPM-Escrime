/**
 * BPM - Escrime - Préload : base ouverte (db:ready) retenue pour les appels tardifs (ADR-0030)
 * Remplace onDbReady et le délai de secours de l'écran : whenDbReady() est résolue tout de suite
 * si db:ready est déjà passé. Aucun nouveau canal.
 * Licensed under GPL-3.0
 */

import { ipcRenderer } from 'electron';

/** Écoute db:ready dès le chargement du préload ; rend l'attente à exposer au renderer */
export function createDbReady(): () => Promise<void> {
  let ready = false;
  const waiting: Array<() => void> = [];
  // Le main renvoie db:ready à chaque chargement de page tant que la base est ouverte
  ipcRenderer.on('db:ready', () => {
    ready = true;
    for (const resolve of waiting.splice(0)) resolve();
  });
  return () => (ready ? Promise.resolve() : new Promise<void>(resolve => waiting.push(resolve)));
}
