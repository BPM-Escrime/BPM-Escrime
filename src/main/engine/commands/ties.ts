/**
 * BPM - Escrime - Ex aequo à la barre choisis pour une coupe (#2013 étape F1, docs/adr/0040)
 * Champ « ties » des commandes de coupe (closePoolRound, generateTableau, splitCompetition) :
 * prime sur la formule ; « barrage » refusé jusqu'au lot F1b.
 * Licensed under GPL-3.0
 */
import type { TiesAtBar } from '../../../shared/types';
import { CommandError } from './context';

export function assertTies(ties: TiesAtBar | undefined): TiesAtBar | undefined {
  if (ties === 'barrage') {
    throw new CommandError(
      'invalid_settings',
      'Barrage des ex aequo à la barre : pas encore disponible'
    );
  }
  return ties;
}
