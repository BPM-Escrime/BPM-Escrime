/**
 * BPM - Escrime - Répartition d'une scission entre ses branches (#2013 étape E2, ADR-0039)
 * Entrée : classement de la phase qui précède la scission, dans l'ordre. Par sexe et par
 * catégorie : champ du tireur ; par rang : chaque branche prend dans l'ordre son nombre ou son
 * pourcentage de l'effectif entrant, ex aequo à la borne gardés comme la qualification
 * (applyTableauAdvancement), la dernière prend le reste ; manuelle : affectations de l'écran.
 * Domaine pur.
 * Licensed under GPL-3.0
 */

import type { PoolRanking } from '../../types';
import { getAdvancementCount } from '../../utils/customFormulaSettings';
import type { SplitBranch, SplitPhase } from './formulaV2';

/** Affectation manuelle d'un tireur à une branche (libellé) */
export interface SplitAssignment {
  fencerId: string;
  branch: string;
}

export interface SplitPlanBranch {
  label: string;
  /** Tireurs de la branche dans l'ordre, rangs renumérotés depuis 1, égalités gardées */
  rows: PoolRanking[];
}

export interface SplitPlan {
  branches: SplitPlanBranch[];
  /** Tireurs sans valeur pour le critère (sexe, catégorie, affectation) : aucune branche */
  missing: string[];
}

/** Scission faite, gardée dans l'état de session de l'épreuve d'origine (ADR-0039) */
export interface SplitHistoryEntry {
  label: string;
  competitionId: string;
  fencerIds: string[];
}

/** Rangs renumérotés depuis 1 ; deux rangs égaux restent égaux */
export function renumberRanks(rows: PoolRanking[]): PoolRanking[] {
  let prev = NaN;
  let start = 0;
  return rows.map((r, i) => {
    if (r.rank !== prev) {
      start = i;
      prev = r.rank;
    }
    return { ...r, rank: start + 1 };
  });
}

/** Branche d'un tireur selon le critère sexe, catégorie ou manuel ; -1 : aucune */
function branchIndexOf(
  split: SplitPhase,
  row: PoolRanking,
  assigned: ReadonlyMap<string, string>
): number {
  const f = row.fencer;
  const match = (b: SplitBranch): boolean => {
    if (split.criterion === 'gender') return !!f.gender && b.gender === f.gender;
    if (split.criterion === 'category')
      return !!f.category && (b.categories ?? []).includes(f.category);
    return assigned.get(f.id) === b.label;
  };
  return split.branches.findIndex(match);
}

/** Répartition par rang : nombre ou pourcentage de l'effectif entrant, la dernière le reste */
function byRank(ranking: PoolRanking[], branches: SplitBranch[]): PoolRanking[][] {
  const total = ranking.length;
  let pos = 0;
  return branches.map((b, i) => {
    if (i === branches.length - 1) return ranking.slice(pos);
    const count = getAdvancementCount(total, b.take) ?? total - pos;
    let end = Math.min(pos + count, total);
    // Ex aequo à la borne : gardés dans la branche, comme la qualification
    while (end > pos && end < total && ranking[end].rank === ranking[end - 1].rank) end++;
    const rows = ranking.slice(pos, end);
    pos = end;
    return rows;
  });
}

/**
 * Répartit le classement entre les branches de la scission. Ordre gardé dans chaque branche ;
 * un tireur sans valeur pour le critère (ou non affecté, en manuel) va dans `missing`.
 */
export function planSplit(
  ranking: PoolRanking[],
  split: SplitPhase,
  assignments: readonly SplitAssignment[] = []
): SplitPlan {
  const ordered = [...ranking].sort((a, b) => a.rank - b.rank);
  if (split.criterion === 'rank') {
    return {
      branches: byRank(ordered, split.branches).map((rows, i) => ({
        label: split.branches[i].label,
        rows: renumberRanks(rows),
      })),
      missing: [],
    };
  }
  const assigned = new Map(assignments.map(a => [a.fencerId, a.branch]));
  const buckets: PoolRanking[][] = split.branches.map(() => []);
  const missing: string[] = [];
  for (const row of ordered) {
    const i = branchIndexOf(split, row, assigned);
    if (i < 0) missing.push(row.fencer.id);
    else buckets[i].push(row);
  }
  return {
    branches: split.branches.map((b, i) => ({ label: b.label, rows: renumberRanks(buckets[i]) })),
    missing,
  };
}

/** Historique de scission lu dans l'état de session (absent, mal formé : aucun) */
export const splitHistoryOf = (raw: unknown): SplitHistoryEntry[] =>
  Array.isArray(raw)
    ? (raw as SplitHistoryEntry[]).filter(
        e =>
          !!e &&
          typeof e.label === 'string' &&
          typeof e.competitionId === 'string' &&
          Array.isArray(e.fencerIds)
      )
    : [];

/**
 * Classement de l'épreuve d'origine après une scission (Q6, ADR-0039 ; Q5 d'ADR-0037 amendée) :
 * les tireurs passés dans une branche sont classés dans les filles ; restent les autres, rangs
 * renumérotés depuis 1, égalités gardées. À passer ensuite à `rankAfterStages` : éliminés du
 * tableau arrêté, puis des poules.
 */
export function rankingWithoutSplit(
  ranking: PoolRanking[],
  history: readonly SplitHistoryEntry[]
): PoolRanking[] {
  if (history.length === 0) return ranking;
  const gone = new Set(history.flatMap(h => h.fencerIds));
  return renumberRanks(ranking.filter(r => !gone.has(r.fencer.id)));
}
