/**
 * BPM - Escrime - Égalité tranchée par un vainqueur désigné (V) (#1442)
 * Sabre laser (existant), armes olympiques (épée, fleuret, sabre : « minute prioritaire ») et
 * formule qui le demande (`general.tieBreakByVictory`, ex tournoi des rapières, docs/adr/0043) :
 * une égalité en fin de temps se tranche par le vainqueur saisi (tirage au sort avant la minute
 * supplémentaire, ou V manuel).
 * Licensed under GPL-3.0
 */

import { Weapon } from '../types';

export function allowsVictoryTieBreak(
  weapon: Weapon | string | undefined,
  /** Réglage général de la formule (`tieBreakByVictory`), absent : selon l'arme */
  byFormula = false
): boolean {
  return (
    byFormula ||
    weapon === Weapon.LASER ||
    weapon === Weapon.EPEE ||
    weapon === Weapon.FOIL ||
    weapon === Weapon.SABRE
  );
}
