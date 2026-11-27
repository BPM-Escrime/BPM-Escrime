/**
 * BPM - Escrime - Aide intégrée de l'éditeur de formule (#2013 F5, docs/FORMULES.md)
 * Sujets du guide, un par brique (carte de phase) : chacun est une ancre de l'article du wiki
 * intégré (`wikiFormulaArticle.ts`). Fonctions pures ; l'ouverture du wiki passe par
 * `WikiHelpContext` (aucun canal du poste, ADR-0030).
 * Licensed under GPL-3.0
 */

import type { FriezePhase } from '../../../shared/domain/formula/formulaFrieze';
import type { FormulaV2 } from '../../../shared/domain/formula/formulaV2';
import { isWavesOrder } from '../../../shared/domain/pools/waves';

/** Identifiant de l'article du wiki qui reprend le guide */
export const FORMULA_HELP_ARTICLE = 'formula-bricks';

/** Sujets du guide : ancre de la section dans l'article du wiki, dans l'ordre de l'article */
export const FORMULA_HELP_TOPICS = [
  'pools',
  'qualification',
  'quest',
  'tableau',
  'stopped-tableau',
  'split',
  'waves',
  'team-entry',
  'ranking-filters',
  'expert',
  'checks',
] as const;

export type FormulaHelpTopic = (typeof FORMULA_HELP_TOPICS)[number];

/**
 * Sujet de l'aide de la carte d'une phase de la frise : tour de poules (en vagues : le tour en
 * vagues), Tour Quest, tableau (arrêté à N : le tableau arrêté), scission.
 */
export function helpTopicOfPhase(phase: FriezePhase, formula: FormulaV2): FormulaHelpTopic {
  if (phase.kind === 'quest') return 'quest';
  if (phase.kind === 'split') return 'split';
  if (phase.kind === 'pool') {
    const pool = formula.phases.filter(p => p.kind === 'pool')[phase.round];
    return pool?.kind === 'pool' && isWavesOrder(pool.boutOrder) ? 'waves' : 'pools';
  }
  const tableau = formula.phases.find(p => p.kind === 'tableau');
  return tableau?.kind === 'tableau' && tableau.stopAt ? 'stopped-tableau' : 'tableau';
}

/** Clé de traduction du nom d'un sujet (infobulle et nom accessible du lien) */
export const helpTopicKey = (topic: FormulaHelpTopic): string =>
  `formulaHelp.topic_${topic.replace(/-/g, '_')}`;
