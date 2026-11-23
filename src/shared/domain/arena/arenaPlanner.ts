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
  /** Rotation autour du centre, en degrés (0 = non tourné) */
  rotationDeg?: number;
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
    const b = itemBounds(item);
    // Tolérance EPS : un élément posé exactement contre un mur peut déborder de 1e-17 après rotation
    if (
      b.minX < -EPS ||
      b.minY < -EPS ||
      b.maxX > room.widthM + EPS ||
      b.maxY > room.lengthM + EPS
    ) {
      issues.push({ itemId: item.id, type: 'outOfRoom' });
    }
    if (item.kind === 'exit' && !touchesWall(item, room)) {
      issues.push({ itemId: item.id, type: 'exitNotOnWall' });
    }
    const poly = itemCorners(item);
    if (item.kind !== 'blocked' && blocked.some(bl => polygonsOverlap(poly, itemCorners(bl)))) {
      issues.push({ itemId: item.id, type: 'overlapsBlocked' });
    }
    arenaCenters.forEach((c, arenaIndex) => {
      if (polygonIntersectsCircle(poly, c, safetyRadiusM)) {
        issues.push({
          itemId: item.id,
          type: item.kind === 'blocked' ? 'arenaBlocked' : 'inSafetyZone',
          arenaIndex,
        });
      }
    });
  }
  return issues;
}

/** Angle normalisé dans [0, 360). */
export function normalizeRotation(deg: number): number {
  const r = deg % 360;
  return r < 0 ? r + 360 : r;
}

const EPS = 1e-6;
const round6 = (v: number) => Math.round(v / EPS) * EPS;

/** Les 4 coins de l'élément, après rotation autour de son centre. */
export function itemCorners(item: RoomItem): Point[] {
  const cx = item.x + item.widthM / 2;
  const cy = item.y + item.heightM / 2;
  const hw = item.widthM / 2;
  const hh = item.heightM / 2;
  const rad = ((item.rotationDeg ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([dx, dy]) => ({ x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }));
}

/** Boîte englobante de l'élément tourné. */
export function itemBounds(item: RoomItem): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const pts = itemCorners(item);
  return {
    minX: Math.min(...pts.map(p => p.x)),
    minY: Math.min(...pts.map(p => p.y)),
    maxX: Math.max(...pts.map(p => p.x)),
    maxY: Math.max(...pts.map(p => p.y)),
  };
}

function touchesWall(item: RoomItem, room: RoomSize): boolean {
  const tol = EXIT_WALL_TOLERANCE_M;
  const b = itemBounds(item);
  return (
    b.minX <= tol || b.minY <= tol || b.maxX >= room.widthM - tol || b.maxY >= room.lengthM - tol
  );
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Vrai si le cercle (centre c, rayon r) touche le polygone. */
function polygonIntersectsCircle(poly: Point[], c: Point, r: number): boolean {
  if (pointInPolygon(c, poly)) return true;
  for (let i = 0; i < poly.length; i++) {
    if (distanceToSegment(c, poly[i], poly[(i + 1) % poly.length]) < r) return true;
  }
  return false;
}

/** Séparation par les axes (SAT) : vrai si les deux polygones se recouvrent strictement. */
function polygonsOverlap(a: Point[], b: Point[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p1 = poly[i];
      const p2 = poly[(i + 1) % poly.length];
      const ax = -(p2.y - p1.y);
      const ay = p2.x - p1.x;
      const proj = (pts: Point[]) => {
        const values = pts.map(p => p.x * ax + p.y * ay);
        return [Math.min(...values), Math.max(...values)];
      };
      const [minA, maxA] = proj(a);
      const [minB, maxB] = proj(b);
      if (maxA <= minB + EPS || maxB <= minA + EPS) return false;
    }
  }
  return true;
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
  return { id, kind, label, x, y, rotationDeg: 0, ...size };
}

/** Déplace un élément en le gardant entièrement dans la salle (élément tourné compris). */
export function moveRoomItem(item: RoomItem, x: number, y: number, room: RoomSize): RoomItem {
  const b = itemBounds(item);
  const offMinX = round6(b.minX - item.x);
  const offMaxX = round6(b.maxX - item.x);
  const offMinY = round6(b.minY - item.y);
  const offMaxY = round6(b.maxY - item.y);
  const clamp = (v: number, lo: number, hi: number) =>
    lo > hi ? lo : Math.min(hi, Math.max(lo, v));
  return {
    ...item,
    // « + 0 » évite un -0 (égalité stricte dans les tests)
    x: clamp(x, -offMinX + 0, room.widthM - offMaxX) + 0,
    y: clamp(y, -offMinY + 0, room.lengthM - offMaxY) + 0,
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

/** Redimensionne en gardant le centre de l'élément (poignée de coin à la souris). */
export function resizeRoomItemAroundCenter(
  item: RoomItem,
  widthM: number,
  heightM: number,
  room: RoomSize
): RoomItem {
  const cx = item.x + item.widthM / 2;
  const cy = item.y + item.heightM / 2;
  const w = Math.min(room.widthM, Math.max(MIN_ITEM_SIZE_M, widthM));
  const h = Math.min(room.lengthM, Math.max(MIN_ITEM_SIZE_M, heightM));
  return moveRoomItem({ ...item, widthM: w, heightM: h }, cx - w / 2, cy - h / 2, room);
}

/** Tourne l'élément autour de son centre, en le gardant dans la salle. */
export function rotateRoomItem(item: RoomItem, deg: number, room: RoomSize): RoomItem {
  return moveRoomItem({ ...item, rotationDeg: normalizeRotation(deg) }, item.x, item.y, room);
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
  return !blocked.some(b => polygonIntersectsCircle(itemCorners(b), c, r));
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

/** Pas de poussée d'un élément hors d'un cercle de sécurité (mètres). */
const PUSH_STEP_M = 0.1;
/** Déplacement maximal d'un élément poussé (mètres) : au-delà, il reste à sa place. */
const PUSH_MAX_M = 30;

/** Éloigne un élément d'un cercle, pas à pas, dans la direction centre de l'élément → centre du cercle. */
function pushItemOutOfCircle(item: RoomItem, c: Point, room: RoomSize, r: number): RoomItem {
  let current = item;
  const steps = Math.round(PUSH_MAX_M / PUSH_STEP_M);
  for (let k = 0; k < steps; k++) {
    if (!polygonIntersectsCircle(itemCorners(current), c, r)) return current;
    const cx = current.x + current.widthM / 2;
    const cy = current.y + current.heightM / 2;
    let dx = cx - c.x;
    let dy = cy - c.y;
    let len = Math.hypot(dx, dy);
    if (len < 1e-9) {
      dx = 1;
      dy = 0;
      len = 1;
    }
    current = moveRoomItem(
      current,
      current.x + (dx / len) * PUSH_STEP_M,
      current.y + (dy / len) * PUSH_STEP_M,
      room
    );
  }
  return current;
}

/**
 * Déplace l'arène `index` au point `target` (borné à la salle et à la marge),
 * puis repousse les autres arènes qui se chevauchent (distance minimale 2 × rayon
 * de sécurité) et tous les éléments qui touchent un cercle de sécurité.
 * Les éléments sont repoussés sans sortir de la salle ; s'ils ne peuvent pas
 * l'être, la contrainte reste signalée par checkRoomItems.
 */
export function moveArenaWithPush(
  centers: Point[],
  index: number,
  target: Point,
  room: RoomSize,
  marginM: number,
  items: RoomItem[]
): { centers: Point[]; items: RoomItem[] } {
  const r = ARENA_SAFETY_RADIUS_M;
  const pitch = 2 * r;
  const minX = marginM + r;
  const maxX = room.widthM - marginM - r;
  const minY = marginM + r;
  const maxY = room.lengthM - marginM - r;
  const clampPoint = (p: Point): Point => ({
    x: Math.min(Math.max(p.x, minX), Math.max(minX, maxX)),
    y: Math.min(Math.max(p.y, minY), Math.max(minY, maxY)),
  });

  const next = centers.map(c => ({ ...c }));
  next[index] = clampPoint(target);

  // Arènes voisines : poussées sur la droite centre → centre, à 2 × rayon
  for (let j = 0; j < next.length; j++) {
    if (j === index) continue;
    const a = next[index];
    const b = next[j];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    if (d >= pitch - 1e-6) continue;
    const ux = d < 1e-9 ? 1 : dx / d;
    const uy = d < 1e-9 ? 0 : dy / d;
    next[j] = clampPoint({ x: a.x + ux * pitch, y: a.y + uy * pitch });
  }

  // Éléments qui touchent un cercle de sécurité : repoussés hors du cercle
  let moved = items.map(i => ({ ...i }));
  for (const c of next) {
    moved = moved.map(i =>
      i.kind === 'exit' ||
      i.kind === 'table' ||
      i.kind === 'outlet' ||
      i.kind === 'accessory' ||
      i.kind === 'blocked'
        ? pushItemOutOfCircle(i, c, room, r)
        : i
    );
  }

  return { centers: next, items: moved };
}

/** Centrage horizontal du bloc d'arènes dans la salle. */
export type ArenaAlign = 'left' | 'center' | 'right';
/**
 * Espacement : « packed » = arènes collées au pas minimal (2 × rayon de sécurité) ;
 * « spread » = arènes étirées pour occuper toute la salle (espace libre réparti).
 */
export type ArenaSpacing = 'packed' | 'spread';

/** Pas de recherche du centrage quand une zone bloquée empêche le décalage idéal. */
const ALIGN_SEARCH_STEP_M = 0.1;

/**
 * Translate horizontalement le bloc d'arènes pour le coller à gauche, le centrer
 * ou le coller à droite (marge au mur respectée). Si le décalage idéal touche une
 * zone bloquée, on se rapproche de la position d'origine pas à pas ; sans
 * décalage valide, les centres d'origine sont rendus inchangés.
 */
export function alignArenaCenters(
  centers: Point[],
  room: RoomSize,
  marginM: number,
  align: ArenaAlign,
  blocked: RoomItem[] = []
): Point[] {
  if (centers.length === 0) return [];
  const r = ARENA_SAFETY_RADIUS_M;
  const minX = Math.min(...centers.map(c => c.x)) - r;
  const maxX = Math.max(...centers.map(c => c.x)) + r;
  const blockWidth = maxX - minX;
  const freeLeft = marginM;
  const freeRight = room.widthM - marginM;
  let targetStart: number;
  if (align === 'left') targetStart = freeLeft;
  else if (align === 'right') targetStart = freeRight - blockWidth;
  else targetStart = (room.widthM - blockWidth) / 2;
  const ideal = targetStart - minX;
  const fits = (dx: number) =>
    centers
      .map(c => ({ x: c.x + dx, y: c.y }))
      .every(c => isValidCenter(c, room, marginM, blocked));
  // Décalages candidats, du plus proche de l'idéal vers 0 (position d'origine)
  const candidates: number[] = [];
  for (let k = 0; ; k++) {
    const magnitude = Math.abs(ideal) - k * ALIGN_SEARCH_STEP_M;
    if (magnitude <= 0) {
      candidates.push(0);
      break;
    }
    candidates.push(Math.sign(ideal) * magnitude);
  }
  const dx = candidates.find(fits) ?? 0;
  return centers.map(c => ({ x: c.x + dx, y: c.y }));
}

/**
 * Répartit `count` arènes sur toute la salle : grille qui tient dans la salle
 * (moins de cases vides), étirée pour occuper toute la place disponible entre
 * les marges. Renvoie null si la salle est trop petite ou si une arène tombe
 * sur une zone bloquée.
 */
export function spreadArenaCenters(
  room: RoomSize,
  count: number,
  marginM: number,
  blocked: RoomItem[] = []
): Point[] | null {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return [];
  const pitch = 2 * ARENA_SAFETY_RADIUS_M;
  // Disposition qui tient dans la salle avec le moins de cases vides (à égalité, moins de colonnes)
  let best: { columns: number; rows: number; waste: number } | null = null;
  for (let columns = 1; columns <= n; columns++) {
    const rows = Math.ceil(n / columns);
    const fits =
      columns * pitch + 2 * marginM <= room.widthM && rows * pitch + 2 * marginM <= room.lengthM;
    const waste = columns * rows - n;
    if (fits && (!best || waste < best.waste)) best = { columns, rows, waste };
  }
  if (!best) return null;
  const r = ARENA_SAFETY_RADIUS_M;
  const availW = room.widthM - 2 * marginM - 2 * r;
  const availL = room.lengthM - 2 * marginM - 2 * r;
  const pitchX = best.columns > 1 ? availW / (best.columns - 1) : 0;
  const pitchY = best.rows > 1 ? availL / (best.rows - 1) : 0;
  const centers: Point[] = [];
  for (let i = 0; i < n; i++) {
    const col = i % best.columns;
    const row = Math.floor(i / best.columns);
    centers.push({
      x: marginM + r + col * pitchX,
      y: marginM + r + row * pitchY,
    });
  }
  if (!centers.every(c => isValidCenter(c, room, marginM, blocked))) return null;
  return centers;
}
