/**
 * BPM - Escrime - Ex aequo à la barre du tableau choisis à l'écran (#2013 étape F1,
 * docs/adr/0040) : choix fait au passage au tableau, avant sa génération, pour ce tableau
 * seulement (absent : réglage de la formule). État d'interface du poste, par épreuve ; la
 * coupe retenue est figée par TableauGenerated.
 * Licensed under GPL-3.0
 */
import { useSyncExternalStore } from 'react';
import type { TiesChoice } from '../components/ties/TiesAtBar';

const choices = new Map<string, TiesChoice>();
const listeners = new Set<() => void>();

export function setTableauTies(competitionId: string, ties: TiesChoice | undefined): void {
  if (ties) choices.set(competitionId, ties);
  else choices.delete(competitionId);
  listeners.forEach(l => l());
}

export const getTableauTies = (competitionId: string): TiesChoice | undefined =>
  choices.get(competitionId);

/** Choix courant de l'épreuve, relu à chaque changement */
export function useTableauTies(competitionId: string): TiesChoice | undefined {
  return useSyncExternalStore(
    l => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => choices.get(competitionId)
  );
}
