/**
 * BPM - Escrime - Salles du planificateur d'arène (#2075)
 * État d'une salle (champs saisis, matériel, arènes glissées, position sur la
 * vue d'ensemble) et calcul de sa disposition par shared/domain/arena.
 * Licensed under GPL-3.0
 */

import {
  alignArenaCenters,
  optimizeArenaLayout,
  spreadArenaCenters,
  type ArenaAlign,
  type ArenaSpacing,
  type OptimizedLayout,
  type Point,
  type RoomItem,
  type RoomSize,
} from '@shared/domain/arena/arenaPlanner';

/** Une salle du plan : dimensions, arènes et matériel propres. */
export interface RoomPlan {
  id: string;
  name: string;
  width: string;
  length: string;
  arenas: string;
  margin: string;
  /** Collées (pas minimal) ou espacées (occupation maximale de la salle) */
  spacing: ArenaSpacing;
  /** Centrage horizontal du bloc d'arènes */
  align: ArenaAlign;
  items: RoomItem[];
  /** Noms des arènes, par rang (vide : sans nom), affichés sur le plan */
  arenaNames?: string[];
  /** Positions des arènes après un glisser à la souris ; null = positions calculées */
  manual: { key: string; centers: Point[] } | null;
  /** Coin nord-ouest de la salle sur la vue d'ensemble (m) */
  x: number;
  y: number;
}

/** Écart entre une nouvelle salle et la précédente sur la vue d'ensemble (m). */
export const ROOM_GAP_M = 3;

export const newRoomPlan = (id: string, name: string, x = 0, y = 0): RoomPlan => ({
  id,
  name,
  width: '20',
  length: '20',
  arenas: '1',
  margin: '1',
  spacing: 'packed',
  align: 'left',
  items: [],
  manual: null,
  x,
  y,
});

export const parseNumber = (value: string): number | null => {
  const n = Number(value.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/** Clé des champs qui invalident les positions d'arènes glissées. */
export const roomDimsKey = (p: RoomPlan) =>
  [p.width, p.length, p.arenas, p.margin, p.spacing, p.align].join('|');

export interface RoomLayout {
  parsed: { w: number; l: number; n: number; m: number };
  room: RoomSize;
  maxLayout: OptimizedLayout;
  arenaCount: number;
  clamped: boolean;
  centers: Point[];
}

/** Disposition d'une salle ; null si un champ est invalide. */
export function computeRoomLayout(plan: RoomPlan): RoomLayout | null {
  const w = parseNumber(plan.width);
  const l = parseNumber(plan.length);
  const n = parseNumber(plan.arenas);
  const m = parseNumber(plan.margin);
  if (w === null || l === null || n === null || m === null || w <= 0 || l <= 0 || m < 0 || n < 1) {
    return null;
  }
  const parsed = { w, l, n: Math.floor(n), m };
  const room = { widthM: w, lengthM: l };
  const blocked = plan.items.filter(i => i.kind === 'blocked');
  // Maximum d'arènes que la zone peut recevoir (marge et zones bloquées prises en compte)
  const maxLayout = optimizeArenaLayout(room, m, blocked);
  // Jamais plus d'arènes que le maximum possible
  const arenaCount = Math.min(parsed.n, maxLayout.count);
  const manual = plan.manual && plan.manual.key === roomDimsKey(plan) ? plan.manual.centers : null;
  let centers: Point[];
  if (manual) {
    centers = manual;
  } else {
    // « Espacées » : répartition sur la salle ; à défaut (salle trop petite, zone bloquée), collées
    const base =
      (plan.spacing === 'spread' && spreadArenaCenters(room, arenaCount, m, blocked)) ||
      maxLayout.centers.slice(0, arenaCount);
    centers = alignArenaCenters(base, room, m, plan.align, blocked);
  }
  return { parsed, room, maxLayout, arenaCount, clamped: parsed.n > maxLayout.count, centers };
}

/** Position d'une nouvelle salle : à droite de la salle la plus à l'est. */
export function nextRoomPosition(rooms: RoomPlan[]): Point {
  if (rooms.length === 0) return { x: 0, y: 0 };
  const right = Math.max(...rooms.map(r => r.x + Math.max(0, parseNumber(r.width) ?? 0)));
  return { x: right + ROOM_GAP_M, y: Math.min(...rooms.map(r => r.y)) };
}
