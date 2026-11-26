/**
 * BPM - Escrime - Ordre « classique » des poules de 10 à 15 (#1816) : déplacé dans
 * shared/domain/pools/wavesClassicOrder.ts (docs/adr/0043, F4a), réexporté jusqu'à F4e.
 * Licensed under GPL-3.0
 */
export { classicMatchOrder, classicWaves, hasClassicOrder } from '../pools/wavesClassicOrder';

/** Ordre des combats choisi au lancement des poules (fenêtre des rapières) */
export type RapieresMatchOrder = 'standard' | 'classic';
