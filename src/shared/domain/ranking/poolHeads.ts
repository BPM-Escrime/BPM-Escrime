/**
 * BPM - Escrime - Qualification « têtes de poule, puis suivants » (`pool_heads`, docs/adr/0043, F4b)
 * Les premiers de chaque poule, puis les deuxièmes, etc., jusqu'à `count` ; chaque rang de poule
 * est pris dans l'ordre du classement général. Coupe à la barre (docs/adr/0040) sur le dernier
 * rang de poule pris. Domaine pur : hasard injecté (`random`, tirage au sort des ex aequo).
 * Licensed under GPL-3.0
 */
import type { Pool, PoolRanking, TiesAtBar } from '../../types';
import { calculatePoolRanking } from '../../utils/poolCalculations';
import { isWithdrawn } from '../fencers/fencerStatus';
import { cutAtBar, type TiedAtBar } from './advancement';

export interface PoolHeadsOptions {
  /** Ex aequo à la barre (dernier rang de poule pris) : absent = 'all' */
  ties?: TiesAtBar;
  /** Rang d'entrée d'un ex aequo (`'initial_ranking'`) : par défaut `fencer.ranking` */
  entryRank?: (row: PoolRanking) => number | undefined;
  /** Hasard injecté pour le tirage au sort des ex aequo ('draw') */
  random?: () => number;
}

export interface PoolHeadsCut {
  /** Qualifiés dans l'ordre d'entrée au tableau, rangs renumérotés depuis 1 */
  ranking: PoolRanking[];
  /** Ex aequo à la barre au-delà du quota (docs/adr/0040) ; null sinon */
  tiedAtBar: TiedAtBar | null;
}

/**
 * Qualifiés « têtes de poule » : `count` tireurs au plus, retirés (abandon, forfait, exclusion)
 * écartés et rangs de poule renumérotés. Plus de poules que `count` : seuls les meilleurs
 * premiers de poule passent (la formule refuse ce cas, remarque S4 de docs/adr/0041).
 *
 * Ordre d'entrée au tableau : rang de poule par rang de poule, chacun dans l'ordre des poules
 * quand au moins deux rangs complets sont pris (deux poules : A1, B1, A2, B2, donc A1–B2 et
 * B1–A2 : croisement) ; sinon dans l'ordre du classement général (un seul rang complet,
 * dernier rang partiel : trois poules, les trois premiers et le meilleur deuxième).
 */
export function poolHeadsCut(
  pools: readonly Pool[],
  overall: readonly PoolRanking[],
  count: number | undefined,
  { ties, entryRank, random }: PoolHeadsOptions = {}
): PoolHeadsCut {
  const poolRankings = pools.map(p =>
    (p.ranking?.length ? p.ranking : calculatePoolRanking(p))
      .filter(r => !isWithdrawn(r.fencer))
      .map((r, i) => ({ ...r, rank: i + 1 }))
  );
  const overallOf = new Map(overall.map(r => [r.fencer.id, r]));
  const limit = count !== undefined && count > 0 ? count : Number.POSITIVE_INFINITY;
  const depth = Math.max(0, ...poolRankings.map(r => r.length));

  const picked: PoolRanking[] = [];
  let completeGroups = 0;
  let allComplete = true;
  let tiedAtBar: TiedAtBar | null = null;
  for (let rank = 1; rank <= depth && picked.length < limit; rank++) {
    // Rang de poule `rank` de chaque poule (ordre des poules), avec sa ligne du général
    const group = poolRankings
      .map(r => r.find(x => x.rank === rank))
      .flatMap(r => {
        const row = r && overallOf.get(r.fencer.id);
        return row ? [row] : [];
      });
    if (group.length === 0) continue;
    const places = limit - picked.length;
    if (group.length <= places) {
      picked.push(...group);
      if (group.length === pools.length) completeGroups++;
      else allComplete = false;
      continue;
    }
    // Dernier rang de poule pris : meilleurs du général, coupe à la barre (docs/adr/0040)
    allComplete = false;
    const sorted = [...group].sort((a, b) => a.rank - b.rank);
    const cut = cutAtBar(sorted, places, ties, entryRank, random);
    picked.push(...cut.qualified);
    tiedAtBar = cut.tiedAtBar;
  }

  // ≥ 2 rangs complets, rien d'autre : rang par rang, dans l'ordre des poules (croisement) ;
  // sinon ordre du classement général (tri stable : ex aequo dans l'ordre des poules)
  const ordered =
    allComplete && completeGroups >= 2 ? picked : [...picked].sort((a, b) => a.rank - b.rank);
  return { ranking: ordered.map((r, i) => ({ ...r, rank: i + 1 })), tiedAtBar };
}
