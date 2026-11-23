/**
 * BPM - Escrime - Cotes techniques du plan d'arène (#2075)
 * Calcule les lignes de cotes (salle, arènes, espacements, marges, éléments)
 * affichées sur le plan et reprises dans les exports PDF et PNG. Géométrie pure :
 * les lignes sont données en mètres, le dessin est fait par l'interface.
 * Licensed under GPL-3.0
 */

import { ARENA_SAFETY_RADIUS_M, type Point, type RoomItem, type RoomSize } from './arenaPlanner';

/** Ligne de cote : h = horizontale (de x=from à x=to, à y=at), v = verticale (de y=from à y=to, à x=at) */
export interface DimensionLine {
  orientation: 'h' | 'v';
  from: number;
  to: number;
  at: number;
  label: string;
}

/** Texte de cote libre (dimensions d'un élément, par exemple) */
export interface DimensionText {
  x: number;
  y: number;
  label: string;
}

export interface TechnicalDimensions {
  lines: DimensionLine[];
  texts: DimensionText[];
  /** Centres des arènes : repères (croix) à matérialiser sur le plan */
  centers: Point[];
}

/** Décalage des cotes par rapport aux bords (en mètres) */
const ROOM_OFFSET_M = 1.3;
const ARENA_OFFSET_M = ARENA_SAFETY_RADIUS_M + 0.8;
const SPACING_OFFSET_M = ARENA_SAFETY_RADIUS_M + 1.5;
const ALIGN_EPS = 1e-6;

const label = (m: number) => `${Math.round(m * 100) / 100} m`;

/** Cotes du plan : salle, diamètres des arènes, espacements alignés, marges et dimensions des éléments. */
export function technicalDimensions(
  room: RoomSize,
  centers: Point[],
  items: RoomItem[]
): TechnicalDimensions {
  const lines: DimensionLine[] = [];
  const texts: DimensionText[] = [];

  // Salle
  lines.push({
    orientation: 'h',
    from: 0,
    to: room.widthM,
    at: -ROOM_OFFSET_M,
    label: label(room.widthM),
  });
  lines.push({
    orientation: 'v',
    from: 0,
    to: room.lengthM,
    at: -ROOM_OFFSET_M,
    label: label(room.lengthM),
  });

  // Cotes utilisables pour l'installation : chaque centre d'arène mesuré depuis le mur
  // gauche (x) et le mur haut (y). Les diamètres ne sont pas cotés.
  centers.forEach(c => {
    lines.push({
      orientation: 'h',
      from: 0,
      to: c.x,
      at: c.y + ARENA_OFFSET_M,
      label: label(c.x),
    });
    lines.push({
      orientation: 'v',
      from: 0,
      to: c.y,
      at: c.x - ARENA_OFFSET_M,
      label: label(c.y),
    });
  });

  // Espacements entre arènes alignées : voisine la plus proche, même rangée ou même colonne
  centers.forEach(a => {
    let nextX: Point | null = null;
    let nextY: Point | null = null;
    centers.forEach(b => {
      if (Math.abs(b.y - a.y) < ALIGN_EPS && b.x > a.x && (!nextX || b.x < nextX.x)) nextX = b;
      if (Math.abs(b.x - a.x) < ALIGN_EPS && b.y > a.y && (!nextY || b.y < nextY.y)) nextY = b;
    });
    if (nextX) {
      const n: Point = nextX;
      lines.push({
        orientation: 'h',
        from: a.x,
        to: n.x,
        at: a.y - SPACING_OFFSET_M,
        label: label(n.x - a.x),
      });
    }
    if (nextY) {
      const n: Point = nextY;
      lines.push({
        orientation: 'v',
        from: a.y,
        to: n.y,
        at: a.x + SPACING_OFFSET_M,
        label: label(n.y - a.y),
      });
    }
  });

  // Dimensions de chaque élément, sous son nom
  items.forEach(i => {
    texts.push({
      x: i.x + i.widthM / 2,
      y: i.y + i.heightM + 0.5,
      label: `${label(i.widthM)} × ${label(i.heightM)}`,
    });
  });

  return { lines, texts, centers: centers.map(c => ({ ...c })) };
}
