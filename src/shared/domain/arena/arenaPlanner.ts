/**
 * BellePoule Modern - Planificateur de placement d'arène Sabre Laser (#2075)
 * Géométrie pure, en mètres, d'après le schéma « Placement et zone
 * d'évolution » du Règlement national Sabre Laser, Livret 2 (p. 13) :
 * - zone de combat A et limite de sortie D : Ø 8 m ;
 * - limite de sécurité public E : Ø 12 m ;
 * - lignes de mise en garde B (rouge) et C (vert) : 2 m du centre, soit 4 m
 *   entre elles ;
 * - positions des arbitres (estimées sur le schéma, à valider) : arbitre
 *   principal ≈ 5 m, assesseurs ≈ 5 m à ±40°, e-arbitre ≈ 6 m.
 * Coordonnées : x vers l'est, y vers le sud (repère écran), nord = -y.
 * Ni React, ni Electron, ni base : utilisable par l'UI et l'export PDF.
 * Licensed under GPL-3.0
 */

export const ARENA_ZONE_RADIUS_M = 4;
export const ARENA_SAFETY_RADIUS_M = 6;
export const ARENA_GUARD_OFFSET_M = 2;
export const ARBITRE_PRINCIPAL_DISTANCE_M = 5;
export const ASSESSEUR_DISTANCE_M = 5;
export const ASSESSEUR_ANGLE_DEG = 40;
export const E_ARBITRE_DISTANCE_M = 6;

export interface Point {
  x: number;
  y: number;
}

export type RoleKind =
  'fighterGreen' | 'fighterRed' | 'arbitrePrincipal' | 'assesseur' | 'eArbitre';

export interface ArenaRole {
  kind: RoleKind;
  label: string;
  position: Point;
}

export interface ArenaGeometry {
  center: Point;
  zoneRadiusM: number;
  safetyRadiusM: number;
  guardLines: { red: number; green: number };
  roles: ArenaRole[];
}

/** Point situé à `distance` mètres du centre, `angleDeg` depuis le nord (horaire). */
export function polarPoint(center: Point, distance: number, angleDeg: number): Point {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: center.x + distance * Math.sin(rad), y: center.y - distance * Math.cos(rad) };
}

/** Géométrie complète d'une arène centrée en `center`. */
export function computeArenaGeometry(center: Point = { x: 0, y: 0 }): ArenaGeometry {
  return {
    center,
    zoneRadiusM: ARENA_ZONE_RADIUS_M,
    safetyRadiusM: ARENA_SAFETY_RADIUS_M,
    guardLines: { red: -ARENA_GUARD_OFFSET_M, green: ARENA_GUARD_OFFSET_M },
    roles: [
      { kind: 'fighterGreen', label: '1', position: polarPoint(center, ARENA_GUARD_OFFSET_M, 90) },
      { kind: 'fighterRed', label: '2', position: polarPoint(center, ARENA_GUARD_OFFSET_M, -90) },
      {
        kind: 'arbitrePrincipal',
        label: '3',
        position: polarPoint(center, ARBITRE_PRINCIPAL_DISTANCE_M, 180),
      },
      {
        kind: 'assesseur',
        label: '4',
        position: polarPoint(center, ASSESSEUR_DISTANCE_M, ASSESSEUR_ANGLE_DEG),
      },
      {
        kind: 'assesseur',
        label: '5',
        position: polarPoint(center, ASSESSEUR_DISTANCE_M, -ASSESSEUR_ANGLE_DEG),
      },
      { kind: 'eArbitre', label: '6', position: polarPoint(center, E_ARBITRE_DISTANCE_M, 0) },
    ],
  };
}

export interface RoomSize {
  widthM: number;
  lengthM: number;
}

export interface GridPlan {
  fits: boolean;
  columns: number;
  rows: number;
  /** Centres des arènes, en mètres depuis le coin nord-ouest de la salle. */
  centers: Point[];
  requiredWidthM: number;
  requiredLengthM: number;
}

/**
 * Placement en grille des arènes. Deux cercles de sécurité ne doivent pas se
 * chevaucher : pas de 2 × rayon de sécurité entre centres. `marginM` est la
 * distance minimale entre le cercle de sécurité et le mur de la salle.
 * Le nombre de colonnes est choisi pour minimiser la surface requise.
 */
export function planArenaGrid(room: RoomSize, arenaCount: number, marginM = 1): GridPlan {
  const pitch = 2 * ARENA_SAFETY_RADIUS_M;
  const n = Math.max(0, Math.floor(arenaCount));
  if (n === 0) {
    return { fits: true, columns: 0, rows: 0, centers: [], requiredWidthM: 0, requiredLengthM: 0 };
  }
  let best: { columns: number; rows: number; width: number; length: number } | null = null;
  for (let columns = 1; columns <= n; columns++) {
    const rows = Math.ceil(n / columns);
    const width = columns * pitch + 2 * marginM;
    const length = rows * pitch + 2 * marginM;
    if (!best || width * length < best.width * best.length) {
      best = { columns, rows, width, length };
    }
  }
  const plan = best!;
  const centers: Point[] = [];
  for (let i = 0; i < n; i++) {
    const col = i % plan.columns;
    const row = Math.floor(i / plan.columns);
    centers.push({
      x: marginM + ARENA_SAFETY_RADIUS_M + col * pitch,
      y: marginM + ARENA_SAFETY_RADIUS_M + row * pitch,
    });
  }
  return {
    fits: plan.width <= room.widthM && plan.length <= room.lengthM,
    columns: plan.columns,
    rows: plan.rows,
    centers,
    requiredWidthM: plan.width,
    requiredLengthM: plan.length,
  };
}

/** Élément matériel posé sur le plan (table, prise, accessoire), rectangle en mètres. */
export interface RoomItem {
  id: string;
  kind: 'table' | 'outlet' | 'accessory';
  label: string;
  x: number;
  y: number;
  widthM: number;
  heightM: number;
}

export interface LayoutIssue {
  itemId: string;
  type: 'outOfRoom' | 'inSafetyZone';
  arenaIndex?: number;
}

/** Contrôle : chaque élément est dans la salle et hors des cercles de sécurité. */
export function checkRoomItems(
  room: RoomSize,
  arenaCenters: Point[],
  items: RoomItem[],
  safetyRadiusM = ARENA_SAFETY_RADIUS_M
): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  for (const item of items) {
    const right = item.x + item.widthM;
    const bottom = item.y + item.heightM;
    if (item.x < 0 || item.y < 0 || right > room.widthM || bottom > room.lengthM) {
      issues.push({ itemId: item.id, type: 'outOfRoom' });
    }
    arenaCenters.forEach((c, arenaIndex) => {
      if (rectIntersectsCircle(item, c, safetyRadiusM)) {
        issues.push({ itemId: item.id, type: 'inSafetyZone', arenaIndex });
      }
    });
  }
  return issues;
}

function rectIntersectsCircle(rect: RoomItem, c: Point, r: number): boolean {
  const nearestX = Math.max(rect.x, Math.min(c.x, rect.x + rect.widthM));
  const nearestY = Math.max(rect.y, Math.min(c.y, rect.y + rect.heightM));
  const dx = c.x - nearestX;
  const dy = c.y - nearestY;
  return dx * dx + dy * dy < r * r;
}

/** Dimensions par défaut (m) d'un élément posé à la main sur le plan. */
export const ROOM_ITEM_SIZES: Record<RoomItem['kind'], { widthM: number; heightM: number }> = {
  table: { widthM: 1.5, heightM: 0.8 },
  outlet: { widthM: 0.3, heightM: 0.3 },
  accessory: { widthM: 0.6, heightM: 0.6 },
};

/** Crée un élément au coin nord-ouest de la salle, décalé pour rester visible. */
export function createRoomItem(
  kind: RoomItem['kind'],
  id: string,
  label: string,
  room: RoomSize
): RoomItem {
  const size = ROOM_ITEM_SIZES[kind];
  const x = Math.min(0.5, Math.max(0, room.widthM - size.widthM));
  const y = Math.min(0.5, Math.max(0, room.lengthM - size.heightM));
  return { id, kind, label, x, y, ...size };
}

/** Déplace un élément en le gardant entièrement dans la salle. */
export function moveRoomItem(item: RoomItem, x: number, y: number, room: RoomSize): RoomItem {
  const maxX = Math.max(0, room.widthM - item.widthM);
  const maxY = Math.max(0, room.lengthM - item.heightM);
  return {
    ...item,
    x: Math.min(maxX, Math.max(0, x)),
    y: Math.min(maxY, Math.max(0, y)),
  };
}
