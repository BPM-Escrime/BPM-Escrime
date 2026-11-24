/**
 * BPM - Escrime - Répartition des tireurs dans les poules (serpentin, séparations, niveaux)
 * Règles pures, extraites de shared/utils/poolCalculations.ts (#2197, docs/adr/0002).
 * Licensed under GPL-3.0
 */
import { type Fencer } from '../../types';

/**
 * Distribue les tireurs dans les poules selon la méthode serpentine FIE
 * en respectant les critères de séparation (club, région, nation)
 *
 * Algorithme (FIE §2 et §3) :
 * 1. Serpentine intégrée avec descente dans le classement si conflit (FIE §2)
 * 2. Rééquilibrage des tailles de poules
 * 3. Tirage au sort des positions dans la poule (FIE §3)
 */
export type SeparationCriterionKey = 'byClub' | 'byRegion' | 'byNation';

/**
 * Regroupement par niveau (tournoi des rapières, #1441) : les équipes de même niveau
 * sont placées ensemble, poule après poule (tailles équilibrées). Avec `separateClubs`,
 * les clubs alternent à l'intérieur d'un niveau pour limiter les rencontres d'un même club.
 */
export function distributeFencersGroupedByLevel(
  fencers: Fencer[],
  poolCount: number,
  levelRankOf: (fencer: Fencer) => number,
  separateClubs: boolean
): Fencer[][] {
  if (!Number.isInteger(poolCount) || poolCount < 1) return [];
  const byLevel = new Map<number, Fencer[]>();
  fencers.forEach(f => {
    const lvl = levelRankOf(f);
    byLevel.set(lvl, [...(byLevel.get(lvl) ?? []), f]);
  });
  const ordered: Fencer[] = [];
  [...byLevel.keys()]
    .sort((a, b) => a - b)
    .forEach(lvl => {
      const group = byLevel.get(lvl)!;
      if (!separateClubs) {
        ordered.push(...group);
        return;
      }
      // Tourniquet par club : A1 B1 C1 A2 B2…
      const byClub = new Map<string, Fencer[]>();
      group.forEach(f => {
        const key = (f.club ?? '').trim().toLowerCase();
        byClub.set(key, [...(byClub.get(key) ?? []), f]);
      });
      const queues = [...byClub.values()].sort((a, b) => b.length - a.length);
      while (queues.some(q => q.length > 0)) {
        queues.forEach(q => {
          const f = q.shift();
          if (f) ordered.push(f);
        });
      }
    });
  const base = Math.floor(ordered.length / poolCount);
  const extra = ordered.length % poolCount;
  const pools: Fencer[][] = [];
  let cursor = 0;
  for (let i = 0; i < poolCount; i++) {
    const size = base + (i < extra ? 1 : 0);
    pools.push(ordered.slice(cursor, cursor + size));
    cursor += size;
  }
  return pools;
}

/**
 * @param separation critères prioritaires sur le classement : descente libre dans le classement
 * @param belowRanking critères moins prioritaires que le classement : échange limité au chapeau
 *   courant (tireurs restants de la rangée serpentine), l'équilibre du classement est préservé
 */
export function distributeFencersToPoolsSerpentine(
  fencers: Fencer[],
  poolCount: number,
  separation: SeparationCriterionKey[],
  belowRanking: SeparationCriterionKey[] = [],
  /** Tirage des positions dans la poule (FIE §3) : fourni par l'appelant (domaine pur) */
  random: () => number
): Fencer[][] {
  if (!Array.isArray(fencers))
    throw new TypeError('distributeFencersToPoolsSerpentine: fencers doit être un tableau');
  if (!Number.isInteger(poolCount) || poolCount < 1) {
    throw new RangeError(
      `distributeFencersToPoolsSerpentine: poolCount doit être un entier ≥ 1 (reçu: ${poolCount})`
    );
  }
  if (fencers.length < poolCount) {
    throw new RangeError(
      `distributeFencersToPoolsSerpentine: pas assez de tireurs (${fencers.length}) pour ${poolCount} poules`
    );
  }
  const pools: Fencer[][] = Array.from({ length: poolCount }, () => []);
  const indexes = createPoolIndexes(pools);
  // Quota par valeur (BPM - Escrime) : un club de N tireurs tolère ⌈N/poules⌉ tireurs par poule
  const quotas = createQuotas(fencers, poolCount);

  // Trier les tireurs par classement (meilleur classement = premier, non-classés = derniers)
  const pending = [...fencers].sort((a, b) => (a.ranking ?? 99999) - (b.ranking ?? 99999));
  const seedOrder = [...pending];

  // Distribution serpentine avec descente dans le classement (FIE §2) :
  // pour chaque slot, prendre le premier tireur sans conflit dans la poule cible.
  // Si impossible (tous en conflit), prendre le suivant naturel (FIE : "rester dans la poule initiale").
  let direction = 1;
  let poolIndex = 0;
  let placed = 0;

  const firstFree = (limit: number, criteria: SeparationCriterionKey[]): number => {
    for (let i = 0; i < limit; i++) {
      if (!hasConflictWith(pending[i], indexes[poolIndex], criteria, quotas)) return i;
    }
    return -1;
  };

  while (pending.length > 0) {
    const pool = pools[poolIndex];

    let chosen = 0;
    // Têtes de poule (premier chapeau) jamais déplacées (BPM - Escrime)
    const isHead = placed < poolCount;
    // Critères sous le classement : recherche dans le chapeau courant seulement
    let inPot = -1;
    if (!isHead && belowRanking.length > 0) {
      const potSize = Math.min(pending.length, poolCount - (placed % poolCount));
      for (let take = belowRanking.length; take >= 1 && inPot < 0; take--) {
        inPot = firstFree(potSize, [...separation, ...belowRanking.slice(0, take)]);
      }
      if (inPot < 0 && separation.length > 0) inPot = firstFree(potSize, separation);
    }
    if (inPot >= 0) {
      chosen = inPot;
    } else if (!isHead && separation.length > 0) {
      // Relâchement progressif : d'abord tous les critères, puis en retirant le moins
      // prioritaire (dernier) jusqu'à ne garder que le plus prioritaire (premier).
      // Garantit que le critère 1 n'est jamais sacrifié si une solution existe.
      let found = false;
      for (let take = separation.length; take >= 1 && !found; take--) {
        const activeSub = separation.slice(0, take);
        for (let i = 0; i < pending.length; i++) {
          if (!hasConflictWith(pending[i], indexes[poolIndex], activeSub, quotas)) {
            chosen = i;
            found = true;
            break;
          }
        }
      }
    }

    const picked = pending.splice(chosen, 1)[0];
    pool.push(picked);
    indexAddFencer(indexes[poolIndex], picked);
    placed++;

    poolIndex += direction;
    if (poolIndex >= poolCount) {
      direction = -1;
      poolIndex = poolCount - 1;
    } else if (poolIndex < 0) {
      direction = 1;
      poolIndex = 0;
    }
  }

  // Rééquilibrer les poules pour assurer un nombre égal (ou presque égal) de tireurs
  rebalancePools(pools, [...separation, ...belowRanking], indexes, quotas);

  // Conflits restants : échanges au plus proche classement (NeoSwapper de BPM - Escrime)
  swapRemainingConflicts(pools, indexes, quotas, [...separation, ...belowRanking], seedOrder);

  // Tirage au sort des positions dans la poule (FIE §3)
  for (const pool of pools) {
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
  }

  return pools;
}

function criterionMap(index: PoolConflictIndex, key: SeparationCriterionKey) {
  return key === 'byClub' ? index.clubs : key === 'byRegion' ? index.regions : index.nations;
}

function criterionValue(fencer: Fencer, key: SeparationCriterionKey): string | undefined {
  const v =
    key === 'byClub' ? fencer.club : key === 'byRegion' ? fencer.region : fencer.nationality;
  return v || undefined;
}

/**
 * Échanges à la BPM - Escrime (NeoSwapper) : pour chaque critère par ordre de priorité,
 * un tireur au-delà du quota de sa poule est échangé avec le tireur le plus proche au
 * classement (alternance dessous/dessus) d'une autre poule, si l'échange respecte les quotas
 * des critères de priorité supérieure ou égale. Les têtes de poule ne bougent jamais.
 */
function swapRemainingConflicts(
  pools: Fencer[][],
  indexes: PoolConflictIndex[],
  quotas: PoolConflictIndex,
  criteria: SeparationCriterionKey[],
  seedOrder: Fencer[]
): void {
  const poolCount = pools.length;
  if (criteria.length === 0 || poolCount < 2) return;
  const seed = new Map(seedOrder.map((f, i) => [f.id, i]));
  const heads = new Set(seedOrder.slice(0, poolCount).map(f => f.id));
  const poolOf = new Map<string, number>();
  pools.forEach((p, i) => p.forEach(f => poolOf.set(f.id, i)));

  const quotaOf = (key: SeparationCriterionKey, v: string) => criterionMap(quotas, key).get(v) ?? 1;
  /** f peut rejoindre la poule p (sans `leaving`) pour les critères 0..depth-1 */
  const fits = (f: Fencer, p: number, leaving: Fencer, depth: number) =>
    criteria.slice(0, depth).every(key => {
      const v = criterionValue(f, key);
      if (!v) return true;
      const n =
        (criterionMap(indexes[p], key).get(v) ?? 0) - (criterionValue(leaving, key) === v ? 1 : 0);
      return n < quotaOf(key, v);
    });

  const findErrors = (depth: number): Fencer[] => {
    const errors: Fencer[] = [];
    pools.forEach((pool, p) => {
      for (const key of criteria.slice(0, depth)) {
        criterionMap(indexes[p], key).forEach((n, v) => {
          const excess = n - quotaOf(key, v);
          if (excess <= 0) return;
          // Les moins bien classés de la valeur sont « en trop »
          pool
            .filter(f => criterionValue(f, key) === v && !heads.has(f.id))
            .sort((a, b) => (seed.get(b.id) ?? 0) - (seed.get(a.id) ?? 0))
            .slice(0, excess)
            .forEach(f => errors.includes(f) || errors.push(f));
        });
      }
    });
    return errors.sort((a, b) => (seed.get(a.id) ?? 0) - (seed.get(b.id) ?? 0));
  };

  const trySwap = (e: Fencer, depth: number): boolean => {
    const pe = poolOf.get(e.id)!;
    const key = criteria[depth - 1];
    const start = seed.get(e.id) ?? 0;
    for (let d = 1; d < seedOrder.length; d++) {
      for (const idx of [start + d, start - d]) {
        const x = seedOrder[idx];
        if (!x || heads.has(x.id)) continue;
        const px = poolOf.get(x.id)!;
        if (px === pe || criterionValue(x, key) === criterionValue(e, key)) continue;
        if (!fits(e, px, x, depth) || !fits(x, pe, e, depth)) continue;
        pools[pe][pools[pe].indexOf(e)] = x;
        pools[px][pools[px].indexOf(x)] = e;
        indexRemoveFencer(indexes[pe], e);
        indexAddFencer(indexes[pe], x);
        indexRemoveFencer(indexes[px], x);
        indexAddFencer(indexes[px], e);
        poolOf.set(e.id, px);
        poolOf.set(x.id, pe);
        return true;
      }
    }
    return false;
  };

  for (let depth = 1; depth <= criteria.length; depth++) {
    // Chaque échange respecte les quotas des critères 0..depth-1 : borne de sécurité
    for (let guard = 0; guard < seedOrder.length * 2; guard++) {
      if (!findErrors(depth).some(e => trySwap(e, depth))) break;
    }
  }
}

/**
 * Index multiensemble (valeur → occurrences) des clubs/régions/nations d'une poule,
 * pour vérifier les conflits en O(1) au lieu de scanner la poule à chaque test.
 * Valeurs vides ignorées : pas de conflit entre tireurs sans club/région/nation.
 */
interface PoolConflictIndex {
  clubs: Map<string, number>;
  regions: Map<string, number>;
  nations: Map<string, number>;
}

function indexAdd<K>(map: Map<K, number>, key: K): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function indexRemove<K>(map: Map<K, number>, key: K): void {
  const count = map.get(key);
  if (count === undefined) return;
  if (count > 1) map.set(key, count - 1);
  else map.delete(key);
}

function indexAddFencer(index: PoolConflictIndex, fencer: Fencer): void {
  if (fencer.club) indexAdd(index.clubs, fencer.club);
  if (fencer.region) indexAdd(index.regions, fencer.region);
  if (fencer.nationality) indexAdd(index.nations, fencer.nationality);
}

function indexRemoveFencer(index: PoolConflictIndex, fencer: Fencer): void {
  if (fencer.club) indexRemove(index.clubs, fencer.club);
  if (fencer.region) indexRemove(index.regions, fencer.region);
  if (fencer.nationality) indexRemove(index.nations, fencer.nationality);
}

/** Occupation maximale tolérée par poule pour chaque valeur : ⌈effectif / nb poules⌉ */
function createQuotas(fencers: Fencer[], poolCount: number): PoolConflictIndex {
  const totals = createPoolIndexes([fencers])[0];
  const toQuota = <K>(m: Map<K, number>) => {
    m.forEach((n, k) => m.set(k, Math.ceil(n / poolCount)));
  };
  toQuota(totals.clubs);
  toQuota(totals.regions);
  toQuota(totals.nations);
  return totals;
}

/** Quota maximal d'une valeur par poule (club/région/nation), cf. NeoSwapper de BPM - Escrime */
export function separationQuota(total: number, poolCount: number): number {
  return poolCount > 0 ? Math.max(1, Math.ceil(total / poolCount)) : total;
}

function createPoolIndexes(pools: Fencer[][]): PoolConflictIndex[] {
  return pools.map(pool => {
    const index: PoolConflictIndex = { clubs: new Map(), regions: new Map(), nations: new Map() };
    for (const fencer of pool) indexAddFencer(index, fencer);
    return index;
  });
}

/**
 * Vérifie si un tireur crée un conflit (club/région/nation) avec une poule existante.
 */
function hasConflictWith(
  fencer: Fencer,
  index: PoolConflictIndex,
  separation: SeparationCriterionKey[],
  quotas?: PoolConflictIndex
): boolean {
  if (separation.length === 0) return false;
  const full = <K>(m: Map<K, number>, q: Map<K, number> | undefined, k: K) =>
    (m.get(k) ?? 0) >= (q?.get(k) ?? 1);
  return separation.some(key => {
    switch (key) {
      case 'byClub':
        return !!fencer.club && full(index.clubs, quotas?.clubs, fencer.club);
      case 'byRegion':
        return !!fencer.region && full(index.regions, quotas?.regions, fencer.region);
      case 'byNation':
        return !!fencer.nationality && full(index.nations, quotas?.nations, fencer.nationality);
    }
  });
}

/**
 * Rééquilibre les poules pour assurer un nombre égal (ou presque égal) de tireurs
 * Déplace des tireurs des poules surchargées vers les poules sous-chargées
 */
function rebalancePools(
  pools: Fencer[][],
  separation: SeparationCriterionKey[],
  indexes: PoolConflictIndex[] = createPoolIndexes(pools),
  quotas?: PoolConflictIndex
): void {
  const poolCount = pools.length;
  if (poolCount === 0) return;

  // Calculer la taille idéale
  const totalFencers = pools.reduce((sum, pool) => sum + pool.length, 0);
  const idealSize = Math.floor(totalFencers / poolCount);

  let rebalanced = true;
  let iterations = 0;
  const maxIterations = 100;

  while (rebalanced && iterations < maxIterations) {
    rebalanced = false;
    iterations++;

    // Trouver les poules sources (> idealSize) et sous-chargées (< idealSize)
    // On utilise idealSize comme seuil source (pas maxSize) pour corriger les cas où
    // toutes les poules sont à maxSize mais certaines restent sous idealSize
    const overloaded: { idx: number; pool: Fencer[]; size: number }[] = [];
    const underloaded: { idx: number; pool: Fencer[]; size: number }[] = [];
    pools.forEach((pool, idx) => {
      const size = pool.length;
      if (size > idealSize) overloaded.push({ idx, pool, size });
      else if (size < idealSize) underloaded.push({ idx, pool, size });
    });
    overloaded.sort((a, b) => b.size - a.size);
    underloaded.sort((a, b) => a.size - b.size);

    if (overloaded.length === 0 || underloaded.length === 0) break;

    // Déplacer des tireurs des poules surchargées vers les sous-chargées
    for (const source of overloaded) {
      for (const target of underloaded) {
        if (source.size <= idealSize || target.size >= idealSize) continue;
        const targetIndex = indexes[target.idx];

        // Chercher un tireur à déplacer qui ne crée pas de conflit
        for (let i = source.pool.length - 1; i >= 0; i--) {
          const fencer = source.pool[i];

          // Vérifier que le déplacement ne crée pas de conflit sur les critères actifs
          const wouldCreateConflict = hasConflictWith(fencer, targetIndex, separation, quotas);

          if (!wouldCreateConflict) {
            // Déplacer le tireur
            source.pool.splice(i, 1);
            target.pool.push(fencer);
            indexRemoveFencer(indexes[source.idx], fencer);
            indexAddFencer(targetIndex, fencer);
            source.size--;
            target.size++;
            rebalanced = true;
            break;
          }
        }
      }
    }
  }
}

/**
 * Calcule le nombre optimal de poules selon le nombre de tireurs
 */
export function calculateOptimalPoolCount(
  fencerCount: number,
  minPoolSize: number = 5,
  maxPoolSize: number = 8
): number {
  if (!Number.isFinite(fencerCount) || fencerCount < 1) {
    throw new RangeError(
      `calculateOptimalPoolCount: fencerCount doit être ≥ 1 (reçu: ${fencerCount})`
    );
  }
  if (minPoolSize < 2)
    throw new RangeError(
      `calculateOptimalPoolCount: minPoolSize doit être ≥ 2 (reçu: ${minPoolSize})`
    );
  if (maxPoolSize < minPoolSize)
    throw new RangeError(
      `calculateOptimalPoolCount: maxPoolSize (${maxPoolSize}) doit être ≥ minPoolSize (${minPoolSize})`
    );
  // Objectif: avoir des poules de taille similaire entre min et max
  for (
    let poolCount = Math.ceil(fencerCount / maxPoolSize);
    poolCount <= Math.ceil(fencerCount / minPoolSize);
    poolCount++
  ) {
    const avgSize = fencerCount / poolCount;
    if (avgSize >= minPoolSize && avgSize <= maxPoolSize) {
      return poolCount;
    }
  }

  // Fallback
  return Math.ceil(fencerCount / 6);
}
