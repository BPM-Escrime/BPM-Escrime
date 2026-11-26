/**
 * BPM - Escrime - Nombre de qualifiés d'une règle de qualification (percentage, fixed_count,
 * fixed_bracket) : tour suivant, tableau, scission (docs/adr/0036, 0039). Domaine pur.
 * Licensed under GPL-3.0
 */
import type { AdvancementRule } from '../../types';

const positive = (n: unknown): number | undefined =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined;

/**
 * Nombre de qualifiés selon la règle (undefined = tous).
 * `pool_winner` est géré à part (vainqueurs de poule) : undefined ici.
 */
export function getAdvancementCount(
  activeCount: number,
  rule: AdvancementRule | undefined
): number | undefined {
  if (!rule) return undefined;
  switch (rule.mode) {
    case 'percentage': {
      const pct = rule.percentage ?? 100;
      if (pct >= 100) return undefined;
      return Math.max(1, Math.round((activeCount * pct) / 100));
    }
    case 'fixed_count':
      return positive(rule.count);
    case 'fixed_bracket': {
      const target = positive(rule.count);
      if (!target) return undefined;
      return [2, 4, 8, 16, 32, 64, 128, 256].filter(s => s <= target).pop() ?? 2;
    }
    default:
      return undefined;
  }
}
