/**
 * BPM - Escrime - Tour en vagues d'une poule (docs/adr/0043, lot F4a ; ex-rapières, #1118)
 * Calendrier en vagues (toutes rondes), ordre classique des poules de 10 à 15, vagues d'un
 * tour (lancer, finir, feuilles d'arbitrage) et état de session `waves` du tour courant.
 * Domaine pur.
 * Licensed under GPL-3.0
 */

import { MatchStatus } from '../../types';
import type { Fencer, Pool, PoolBoutOrder } from '../../types';
import type { TableauMatchForPDF } from '../../utils/pdfExport/tableauPdf';
import { isWithdrawn } from '../fencers/fencerStatus';
import { areAllPoolsComplete } from './poolCompletion';
import { classicMatchOrder, classicWaves } from './wavesClassicOrder';

export { hasClassicOrder } from './wavesClassicOrder';

/** Taille d'une poule d'un tour en vagues : 2 à 10 tireurs (docs/adr/0043) */
export const POOL_WAVES_SIZE = { min: 2, max: 10 } as const;
/** Vagues classiques : 2 à 15 tireurs, tables fixes jusqu'à 15 (docs/adr/0043, amendée le 2026-11-27) */
export const POOL_WAVES_CLASSIC_SIZE = { min: 2, max: 15 } as const;

/** Bornes de taille d'une poule selon l'ordre ; undefined : ordre hors vagues */
export const wavesSizeBounds = (
  order: PoolBoutOrder | string | null | undefined
): { readonly min: number; readonly max: number } | undefined =>
  order === 'waves_classic'
    ? POOL_WAVES_CLASSIC_SIZE
    : order === 'waves'
      ? POOL_WAVES_SIZE
      : undefined;

/** Ordre des matchs d'un tour en vagues (« waves », « waves_classic ») */
export const isWavesOrder = (order: PoolBoutOrder | string | null | undefined): boolean =>
  order === 'waves' || order === 'waves_classic';

/** Vagues du tour courant : dernière vague lancée (0 = aucune), arrêt avant le terme */
export interface PoolWavesState {
  launched: number;
  ended: boolean;
}

export const emptyPoolWaves = (): PoolWavesState => ({ launched: 0, ended: false });

/**
 * Vagues du tour courant lues dans l'état de session : clé `waves`, sinon ancienne clé des
 * rapières (`rapieres.launchedWave` / `wavesEnded`) lue comme alias tant qu'elle existe
 * (jusqu'à F4e, docs/adr/0043).
 */
export function poolWavesOf(session: {
  waves?: Partial<PoolWavesState> | null;
  rapieres?: { launchedWave?: number; wavesEnded?: boolean } | null;
}): PoolWavesState {
  const own = session.waves;
  if (own && typeof own === 'object') {
    return { launched: Number(own.launched ?? 0) || 0, ended: own.ended === true };
  }
  const legacy = session.rapieres;
  return {
    launched: Number(legacy?.launchedWave ?? 0) || 0,
    ended: legacy?.wavesEnded === true,
  };
}

/**
 * Ordre des matchs d'une poule en vagues : « waves_classic » suit la table fixe de la taille
 * de la poule (10 à 15), sinon (et pour « waves ») les vagues calculées.
 */
export function wavesBoutOrder(order: PoolBoutOrder, poolFencers: Fencer[]): [number, number][] {
  if (order === 'waves_classic') {
    const table = classicMatchOrder(poolFencers.length);
    if (table) return table;
  }
  return waveMatchOrder(poolFencers);
}

type Pair = [string, string];

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Couplage de taille maximale parmi les paires restantes (recherche exhaustive, ≤ 10 équipes) */
function maxMatching(teamIds: string[], remaining: Set<string>): Pair[] {
  let best: Pair[] = [];
  const target = Math.floor(teamIds.length / 2);
  const search = (free: string[], acc: Pair[]): boolean => {
    if (acc.length > best.length) best = [...acc];
    if (best.length === target) return true;
    if (free.length < 2 || acc.length + Math.floor(free.length / 2) <= best.length) return false;
    const [first, ...rest] = free;
    for (let j = 0; j < rest.length; j++) {
      if (!remaining.has(pairKey(first, rest[j]))) continue;
      const next = rest.filter((_, k) => k !== j);
      if (search(next, [...acc, [first, rest[j]]])) return true;
    }
    // `first` au repos dans cette vague
    return search(rest, acc);
  };
  search(teamIds, []);
  return best;
}

/**
 * Nombre impair d'équipes (#1441) : une équipe au repos par vague, en commençant par la
 * dernière de la liste puis en remontant. Méthode du cercle : vague w, repos de l'équipe
 * r = n − w (0-indexée) ; i et j se rencontrent quand i + j ≡ 2r (mod n). n vagues de
 * (n − 1) / 2 matchs, chaque paire une seule fois, aucune équipe ne tire deux fois.
 */
function scheduleOddWaves(teamIds: string[]): { teamAId: string; teamBId: string; wave: number }[] {
  const n = teamIds.length;
  const result: { teamAId: string; teamBId: string; wave: number }[] = [];
  for (let wave = 1; wave <= n; wave++) {
    const rest = n - wave;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if ((i + j) % n === (2 * rest) % n)
          result.push({ teamAId: teamIds[i], teamBId: teamIds[j], wave });
      }
    }
  }
  return result;
}

/**
 * Calendrier en vagues d'une poule (round-robin : chaque équipe rencontre toutes les autres).
 * Nombre pair : toutes les équipes tirent à chaque vague. Nombre impair : une équipe au repos
 * par vague (dernière de la liste d'abord, #1441).
 * Les équipes les plus contraintes (paires restantes nombreuses) sont appariées en premier.
 */
export function scheduleWaves(
  teamIds: string[]
): { teamAId: string; teamBId: string; wave: number }[] {
  if (teamIds.length % 2 === 1) return scheduleOddWaves(teamIds);
  const remaining = new Set<string>();
  for (let i = 0; i < teamIds.length; i++)
    for (let j = i + 1; j < teamIds.length; j++) remaining.add(pairKey(teamIds[i], teamIds[j]));
  const doubled = new Set<string>();
  const result: { teamAId: string; teamBId: string; wave: number }[] = [];
  const pending = (id: string) =>
    teamIds.filter(o => o !== id && remaining.has(pairKey(id, o))).length;

  for (let wave = 1; remaining.size > 0; wave++) {
    const order = [...teamIds].sort((a, b) => pending(b) - pending(a));
    const pairs = maxMatching(order, remaining);
    for (const [a, b] of pairs) remaining.delete(pairKey(a, b));
    const busy = new Set(pairs.flat());
    // Équipe au repos : elle tire contre une équipe qui n'a encore jamais tiré deux fois
    for (const idle of order.filter(id => !busy.has(id))) {
      const partner = order.find(
        o => o !== idle && busy.has(o) && !doubled.has(o) && remaining.has(pairKey(idle, o))
      );
      if (!partner) continue;
      remaining.delete(pairKey(idle, partner));
      doubled.add(partner);
      busy.add(idle);
      pairs.push([partner, idle]);
    }
    if (pairs.length === 0) break; // garde-fou (ne doit pas arriver)
    for (const [a, b] of pairs) result.push({ teamAId: a, teamBId: b, wave });
  }
  return result;
}

/** Ordre des matchs d'une poule (paires 1-indexées) suivant les vagues */
export function waveMatchOrder(poolFencers: Fencer[]): [number, number][] {
  const index = new Map(poolFencers.map((f, i) => [f.id, i + 1]));
  return scheduleWaves(poolFencers.map(f => f.id)).map(b => [
    index.get(b.teamAId)!,
    index.get(b.teamBId)!,
  ]);
}

/**
 * Vagues de l'ordre classique (#1816) : appliquées quand les matchs de la poule suivent
 * exactement la table classique de sa taille (numéros de match), null sinon.
 */
function classicPoolWaves(pool: Pool): Map<string, number> | null {
  const waves = classicWaves(pool.fencers.length);
  if (!waves) return null;
  const flat = waves.flatMap((pairs, w) => pairs.map(pair => ({ pair, wave: w + 1 })));
  const matches = pool.matches
    .filter(m => m.fencerA && m.fencerB)
    .sort((a, b) => a.number - b.number);
  if (matches.length !== flat.length) return null;
  const index = new Map(pool.fencers.map((f, i) => [f.id, i + 1]));
  const result = new Map<string, number>();
  for (let i = 0; i < matches.length; i++) {
    const a = index.get(matches[i].fencerA!.id);
    const b = index.get(matches[i].fencerB!.id);
    const [x, y] = flat[i].pair;
    if (!((a === x && b === y) || (a === y && b === x))) return null;
    result.set(matches[i].id, flat[i].wave);
  }
  return result;
}

/**
 * Ordre classique (#1816) : matchs renumérotés et orientés selon la table de la taille de
 * poule (ids conservés, scores suivant l'orientation). Poule sans table : inchangée.
 */
export function applyClassicOrder(pool: Pool): Pool {
  const order = classicMatchOrder(pool.fencers.length);
  if (!order) return pool;
  const byPair = new Map(
    pool.matches
      .filter(m => m.fencerA && m.fencerB)
      .map(m => [pairKey(m.fencerA!.id, m.fencerB!.id), m])
  );
  const matches = order.map(([a, b], i) => {
    const fencerA = pool.fencers[a - 1];
    const fencerB = pool.fencers[b - 1];
    const match = byPair.get(pairKey(fencerA.id, fencerB.id));
    if (!match) return null;
    const swapped = match.fencerA!.id !== fencerA.id;
    return swapped
      ? {
          ...match,
          number: i + 1,
          fencerA,
          fencerB,
          scoreA: match.scoreB,
          scoreB: match.scoreA,
        }
      : { ...match, number: i + 1 };
  });
  if (matches.some(m => !m)) return pool;
  return { ...pool, matches: matches as Pool['matches'] };
}

/** Vague de chaque match d'une poule (id du match → numéro de vague) */
export function poolMatchWaves(pool: Pool): Map<string, number> {
  const classic = classicPoolWaves(pool);
  if (classic) return classic;
  const waveOf = new Map(
    scheduleWaves(pool.fencers.map(f => f.id)).map(b => [pairKey(b.teamAId, b.teamBId), b.wave])
  );
  const result = new Map<string, number>();
  for (const m of pool.matches) {
    if (!m.fencerA || !m.fencerB) continue;
    const wave = waveOf.get(pairKey(m.fencerA.id, m.fencerB.id));
    if (wave !== undefined) result.set(m.id, wave);
  }
  return result;
}

/** Nombre de vagues : celui de la poule la plus longue */
export const waveCount = (pools: Pool[]): number =>
  pools.reduce((max, p) => Math.max(max, ...poolMatchWaves(p).values()), 0);

/** Matchs de la vague `wave`, toutes poules confondues */
export function waveMatchIds(pools: Pool[], wave: number): Set<string> {
  const ids = new Set<string>();
  if (wave < 1) return ids;
  for (const pool of pools) for (const [id, w] of poolMatchWaves(pool)) if (w === wave) ids.add(id);
  return ids;
}

/**
 * Matchs de la vague `wave` au format des feuilles d'arbitrage du tableau (#1118).
 * Triés par poule puis par ordre de rencontre ; la piste de la poule est reprise si elle existe.
 * Les matchs annulés ou avec une équipe retirée sont exclus (rien à arbitrer).
 */
export function waveSheetMatches(pools: Pool[], wave: number): TableauMatchForPDF[] {
  const result: TableauMatchForPDF[] = [];
  for (const pool of [...pools].sort((a, b) => a.number - b.number)) {
    const ids = waveMatchIds([pool], wave);
    pool.matches
      .filter(m => ids.has(m.id) && m.fencerA && m.fencerB)
      .filter(m => m.status !== MatchStatus.CANCELLED)
      .filter(m => !isWithdrawn(m.fencerA) && !isWithdrawn(m.fencerB))
      .forEach((m, i) => {
        result.push({
          id: m.id,
          round: 0,
          position: pool.number * 1000 + i,
          label: `Vague ${wave} — Poule ${pool.number}`,
          fencerA: m.fencerA,
          fencerB: m.fencerB,
          scoreA: null,
          scoreB: null,
          winner: null,
          isBye: false,
          arena: m.strip ?? pool.strip ?? null,
        });
      });
  }
  return result;
}

/** Vague terminée : chaque match joué, annulé, ou avec une équipe retirée */
export function isWaveComplete(pools: Pool[], wave: number): boolean {
  const ids = waveMatchIds(pools, wave);
  return pools.every(pool =>
    pool.matches
      .filter(m => ids.has(m.id))
      .every(
        m =>
          m.status === MatchStatus.FINISHED ||
          m.status === MatchStatus.CANCELLED ||
          isWithdrawn(m.fencerA) ||
          isWithdrawn(m.fencerB)
      )
  );
}

/** Le DT peut lancer la vague suivante */
export const canLaunchNextWave = (pools: Pool[], launchedWave: number): boolean =>
  launchedWave < waveCount(pools) && (launchedWave === 0 || isWaveComplete(pools, launchedWave));

/**
 * Tour de poules terminé : toutes les poules réglées ; pour un tour en vagues, aussi quand les
 * vagues sont arrêtées avant leur terme (matchs non joués ignorés, docs/adr/0043).
 */
export const isPoolRoundFinished = (
  pools: Pool[],
  waves: PoolWavesState | undefined,
  wavesRound: boolean
): boolean => pools.length > 0 && (areAllPoolsComplete(pools) || (wavesRound && !!waves?.ended));
