/**
 * BPM - Escrime - Nombre de qualifiés d'une règle de qualification (percentage, fixed_count,
 * fixed_bracket) : tour suivant, tableau, scission (docs/adr/0036, 0039). Coupe à la barre et
 * ex aequo (docs/adr/0040). Domaine pur.
 * Licensed under GPL-3.0
 */
import type { AdvancementRule, TiesAtBar } from '../../types';

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

/** Ex aequo à la barre quand ils dépassent le quota (docs/adr/0040) */
export interface TiedAtBar {
  /** Rang partagé à la barre */
  rank: number;
  /** Ex aequo à ce rang, dans l'ordre du classement */
  fencerIds: string[];
  /** Places restantes pour eux sous le quota */
  places: number;
}

/** Ligne de classement coupée : rang, rang d'entrée (`fencer.ranking`) et nom du tireur */
interface CutRow {
  rank: number;
  fencer: { id: string; ranking?: number; lastName?: string; firstName?: string };
}

/** Rang d'entrée du tour par défaut : `fencer.ranking` (classement initial, puis place au tour) */
const fencerEntryRank = (r: CutRow): number | undefined => r.fencer.ranking;
const nameOf = (r: CutRow) => `${r.fencer.lastName ?? ''} ${r.fencer.firstName ?? ''}`.trim();

/**
 * Coupe à la barre, une seule pour le tour suivant, le tableau et la scission par rang
 * (docs/adr/0040). `sorted` : classement trié par rang, tireurs à couper seulement.
 * `count` absent ou ≥ effectif : tout le monde passe. Ex aequo à la barre au-delà du quota :
 * 'all' les garde tous ; 'initial_ranking' les départage par le rang d'entrée du tour
 * (`entryRank`, par défaut `fencer.ranking`) ; rang d'entrée égal ou absent : ordre du
 * classement (rang), puis nom ; le quota est tenu. 'barrage' (lot F1b)
 * est refusé par la grammaire et les commandes avant d'arriver ici : traité comme 'all'.
 */
export function cutAtBar<T extends CutRow>(
  sorted: readonly T[],
  count: number | undefined,
  ties: TiesAtBar | undefined = 'all',
  entryRank: (row: T) => number | undefined = fencerEntryRank
): { qualified: T[]; eliminated: T[]; tiedAtBar: TiedAtBar | null } {
  if (count === undefined || count >= sorted.length) {
    return { qualified: [...sorted], eliminated: [], tiedAtBar: null };
  }
  if (count <= 0) return { qualified: [], eliminated: [...sorted], tiedAtBar: null };
  const barRank = sorted[count - 1].rank;
  let start = count - 1;
  while (start > 0 && sorted[start - 1].rank === barRank) start--;
  let end = count;
  while (end < sorted.length && sorted[end].rank === barRank) end++;
  if (end === count) {
    return { qualified: sorted.slice(0, count), eliminated: sorted.slice(count), tiedAtBar: null };
  }
  const tied = sorted.slice(start, end);
  const places = count - start;
  const tiedAtBar = { rank: barRank, fencerIds: tied.map(r => r.fencer.id), places };
  if (ties !== 'initial_ranking') {
    return { qualified: sorted.slice(0, end), eliminated: sorted.slice(end), tiedAtBar };
  }
  const entry = (r: T) => entryRank(r) ?? Number.POSITIVE_INFINITY;
  const byEntry = tied
    .map((r, i) => ({ r, i }))
    .sort(
      (a, b) =>
        entry(a.r) - entry(b.r) ||
        a.r.rank - b.r.rank ||
        nameOf(a.r).localeCompare(nameOf(b.r), 'fr') ||
        a.i - b.i
    )
    .map(x => x.r);
  // Départagés : dans l'ordre du rang d'entrée, de part et d'autre de la barre
  return {
    qualified: [...sorted.slice(0, start), ...byEntry.slice(0, places)],
    eliminated: [...byEntry.slice(places), ...sorted.slice(end)],
    tiedAtBar,
  };
}
