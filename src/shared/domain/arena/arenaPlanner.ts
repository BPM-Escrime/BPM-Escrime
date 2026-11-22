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
  kind: 'table' | 'outlet' | 'accessory' | 'exit' | 'blocked';
  label: string;
  x: number;
  y: number;
  widthM: number;
  heightM: number;
}

export interface LayoutIssue {
  itemId: string;
  type: 'outOfRoom' | 'inSafetyZone' | 'exitNotOnWall' | 'overlapsBlocked' | 'arenaBlocked';
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
  const blocked = items.filter(i => i.kind === 'blocked');
  for (const item of items) {
    const right = item.x + item.widthM;
    const bottom = item.y + item.heightM;
    if (item.x < 0 || item.y < 0 || right > room.widthM || bottom > room.lengthM) {
      issues.push({ itemId: item.id, type: 'outOfRoom' });
    }
    if (item.kind === 'exit' && !touchesWall(item, room)) {
      issues.push({ itemId: item.id, type: 'exitNotOnWall' });
    }
    if (item.kind !== 'blocked' && blocked.some(b => rectsOverlap(item, b))) {
      issues.push({ itemId: item.id, type: 'overlapsBlocked' });
    }
    arenaCenters.forEach((c, arenaIndex) => {
      if (item.kind === 'blocked') {
        if (rectIntersectsCircle(item, c, safetyRadiusM)) {
          issues.push({ itemId: item.id, type: 'arenaBlocked', arenaIndex });
        }
      } else if (rectIntersectsCircle(item, c, safetyRadiusM)) {
        issues.push({ itemId: item.id, type: 'inSafetyZone', arenaIndex });
      }
    });
  }
  return issues;
}

function touchesWall(rect: RoomItem, room: RoomSize): boolean {
  const tol = EXIT_WALL_TOLERANCE_M;
  return (
    rect.x <= tol ||
    rect.y <= tol ||
    rect.x + rect.widthM >= room.widthM - tol ||
    rect.y + rect.heightM >= room.lengthM - tol
  );
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
  exit: { widthM: 1.2, heightM: 0.5 },
  blocked: { widthM: 2, heightM: 2 },
};

export const MIN_ITEM_SIZE_M = 0.1;

/** Une issue de secours doit toucher un mur de la salle (tolérance en mètres). */
export const EXIT_WALL_TOLERANCE_M = 0.5;

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

/** Redimensionne un élément (zone bloquée notamment), borné à la salle. */
export function resizeRoomItem(
  item: RoomItem,
  widthM: number,
  heightM: number,
  room: RoomSize
): RoomItem {
  const w = Math.min(room.widthM, Math.max(MIN_ITEM_SIZE_M, widthM));
  const h = Math.min(room.lengthM, Math.max(MIN_ITEM_SIZE_M, heightM));
  return moveRoomItem({ ...item, widthM: w, heightM: h }, item.x, item.y, room);
}

function rectsOverlap(a: RoomItem, b: RoomItem): boolean {
  return (
    a.x < b.x + b.widthM && b.x < a.x + a.widthM && a.y < b.y + b.heightM && b.y < a.y + a.heightM
  );
}

/** Pas d'un quinconce : deux rangées voisines sont décalées de 6 m, espacées de 12·√3/2. */
export const HEX_ROW_SPACING_M = (2 * ARENA_SAFETY_RADIUS_M * Math.sqrt(3)) / 2;
/** Pas de recherche de l'optimiseur (décalage de la grille). */
export const OPTIMIZER_STEP_M = 0.5;

export type ArenaLattice = 'square' | 'hex';

export interface OptimizedLayout {
  count: number;
  lattice: ArenaLattice;
  centers: Point[];
}

/** Arène valide : cercle de sécurité dans la salle (marge comprise), hors zones bloquées. */
function isValidCenter(c: Point, room: RoomSize, marginM: number, blocked: RoomItem[]): boolean {
  const r = ARENA_SAFETY_RADIUS_M;
  if (c.x - r < marginM || c.y - r < marginM) return false;
  if (c.x + r > room.widthM - marginM || c.y + r > room.lengthM - marginM) return false;
  return !blocked.some(b => rectIntersectsCircle(b, c, r));
}

/** Toutes les arènes possibles pour un quinconce ou une grille carrée, décalée de (ox, oy). */
function latticeCenters(
  lattice: ArenaLattice,
  ox: number,
  oy: number,
  room: RoomSize,
  marginM: number,
  blocked: RoomItem[]
): Point[] {
  const pitch = 2 * ARENA_SAFETY_RADIUS_M;
  const rowStep = lattice === 'hex' ? HEX_ROW_SPACING_M : pitch;
  const out: Point[] = [];
  const startY = marginM + ARENA_SAFETY_RADIUS_M + oy;
  for (let j = 0, y = startY; y <= room.lengthM; j++, y = startY + j * rowStep) {
    const shift = lattice === 'hex' && j % 2 === 1 ? ARENA_SAFETY_RADIUS_M : 0;
    const startX = marginM + ARENA_SAFETY_RADIUS_M + ((ox + shift) % pitch);
    for (let x = startX; x <= room.widthM; x += pitch) {
      const c = { x, y };
      if (isValidCenter(c, room, marginM, blocked)) out.push(c);
    }
  }
  return out;
}

/**
 * Cherche la disposition qui place le plus d'arènes dans la salle : grille
 * carrée ou quinconce (le plus dense pour des cercles de sécurité), avec un
 * décalage cherché par pas de 0,5 m. Respecte la marge au mur et les zones
 * bloquées. Ne tient pas compte des tables ni des prises (à placer ensuite).
 */
export function optimizeArenaLayout(
  room: RoomSize,
  marginM: number,
  blocked: RoomItem[] = []
): OptimizedLayout {
  const pitch = 2 * ARENA_SAFETY_RADIUS_M;
  let best: OptimizedLayout = { count: 0, lattice: 'square', centers: [] };
  const lattices: ArenaLattice[] = ['square', 'hex'];
  for (const lattice of lattices) {
    const maxOy = lattice === 'hex' ? HEX_ROW_SPACING_M : pitch;
    for (let ox = 0; ox < pitch; ox += OPTIMIZER_STEP_M) {
      for (let oy = 0; oy < maxOy; oy += OPTIMIZER_STEP_M) {
        const centers = latticeCenters(lattice, ox, oy, room, marginM, blocked);
        // Strictement plus : à égalité, on garde la grille carrée (plus simple à mettre en place)
        if (centers.length > best.count) {
          best = { count: centers.length, lattice, centers };
        }
      }
    }
  }
  return best;
}

/** Arrondit une coordonnée au pas donné (aimantation de l'éditeur). */
export function snapToStep(value: number, step = OPTIMIZER_STEP_M): number {
  return Math.round(value / step) * step;
}
