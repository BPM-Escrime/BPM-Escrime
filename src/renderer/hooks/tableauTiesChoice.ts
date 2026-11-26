/**
 * BPM - Escrime - Ex aequo à la barre du tableau choisis à l'écran (#2013 étape F1,
 * docs/adr/0040) : choix fait au passage au tableau, avant sa génération, pour ce tableau
 * seulement (absent : réglage de la formule). État d'interface du poste, par épreuve ; la
 * coupe retenue est figée par TableauGenerated.
 * Tirage au sort ('draw', F1c) : le hasard est tiré une fois, au choix, et rejoué à chaque
 * calcul du classement du tableau : le tableau composé ne change pas d'un rendu à l'autre.
 * Licensed under GPL-3.0
 */
import { useSyncExternalStore } from 'react';
import type { TiesChoice } from '../components/ties/TiesAtBar';

export interface TableauTiesEntry {
  ties: TiesChoice;
  /** Tirage au sort : valeurs du hasard tirées au choix, rejouées dans l'ordre */
  draws?: readonly number[];
}

/** Valeurs tirées pour un tirage au sort (plus que d'ex aequo possibles à la barre) */
const DRAW_VALUES = 512;

const choices = new Map<string, TableauTiesEntry>();
const listeners = new Set<() => void>();

export function setTableauTies(
  competitionId: string,
  ties: TiesChoice | undefined,
  random: () => number = Math.random
): void {
  if (ties) {
    choices.set(competitionId, {
      ties,
      ...(ties === 'draw' ? { draws: Array.from({ length: DRAW_VALUES }, () => random()) } : {}),
    });
  } else choices.delete(competitionId);
  listeners.forEach(l => l());
}

export const getTableauTies = (competitionId: string): TiesChoice | undefined =>
  choices.get(competitionId)?.ties;

/** Hasard rejoué depuis les valeurs tirées (même tirage à chaque calcul) */
export function replayDraws(draws: readonly number[]): () => number {
  let k = 0;
  return () => draws[k++ % draws.length];
}

/** Choix courant de l'épreuve, relu à chaque changement */
export function useTableauTies(competitionId: string): TableauTiesEntry | undefined {
  return useSyncExternalStore(
    l => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => choices.get(competitionId)
  );
}
