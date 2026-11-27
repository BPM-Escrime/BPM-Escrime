/**
 * BPM - Escrime - Mode expert de l'éditeur de formule (#2013 étape F, lot F2 ; docs/adr/0041)
 * Niveau simple : tours de poules, tableau complet, réglages courants. Mode expert, en plus :
 * scission, Tour Quest, tableau arrêté, ex aequo à la barre, qualification « têtes de poule »
 * (`pool_heads`, docs/adr/0043), répartition par cumul des tours,
 * ordre des matchs libre ou en vagues, barème à zones. Une formule reste valide quel que soit le mode : il ne
 * règle que ce que l'éditeur propose. Domaine pur.
 * Licensed under GPL-3.0
 */

import type { AdvancementRule } from '../../types';
import type { FriezeBrick } from './formulaFrieze';
import type { FormulaPhaseV2, FormulaV2 } from './formulaV2';
import { isWavesOrder } from '../pools/waves';

/** Briques de la frise réservées au mode expert */
export const EXPERT_BRICKS: readonly FriezeBrick[] = ['quest', 'split'];

/** Briques proposées au « ＋ » selon le mode */
export const bricksForLevel = (bricks: FriezeBrick[], expert: boolean): FriezeBrick[] =>
  expert ? bricks : bricks.filter(b => !EXPERT_BRICKS.includes(b));

/** Ex aequo à la barre autre que « tous passent » (réglage avancé) */
const customTies = (rule?: AdvancementRule): boolean => !!rule?.ties && rule.ties !== 'all';

const zonesScoring = (p: { scoring?: { type: string } }): boolean =>
  !!p.scoring && p.scoring.type !== 'standard';

function phaseNeedsExpert(p: FormulaPhaseV2): boolean {
  if (p.kind === 'split' || p.kind === 'quest') return true;
  if (p.kind === 'tableau') return !!p.stopAt || zonesScoring(p);
  return (
    customTies(p.qualification) ||
    p.qualification.mode === 'pool_heads' ||
    p.seeding === 'cumulative' ||
    p.boutOrder === 'free' ||
    isWavesOrder(p.boutOrder) ||
    zonesScoring(p)
  );
}

/**
 * La formule contient-elle une brique ou un réglage expert, ou est-ce une épreuve du mode spécial
 * rapières (`specialMode`) ? Alors l'éditeur rallume le mode
 * expert pour cette édition, sans changer la préférence du poste.
 */
export function formulaNeedsExpert(f: FormulaV2, specialMode = false): boolean {
  // Mode spécial rapières : formule experte (qualification « têtes de poule », docs/adr/0043)
  return specialMode || f.phases.some(phaseNeedsExpert) || !!f.general.postPoolSplitCriteria;
}
