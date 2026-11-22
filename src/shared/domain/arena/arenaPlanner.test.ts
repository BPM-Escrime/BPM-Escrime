/**
 * BellePoule Modern - Tests du planificateur d'arène Sabre Laser (#2075)
 * Licensed under GPL-3.0
 */

import { describe, expect, it } from 'vitest';
import {
  ARENA_GUARD_OFFSET_M,
  ARENA_SAFETY_RADIUS_M,
  checkRoomItems,
  computeArenaGeometry,
  planArenaGrid,
  polarPoint,
  type RoomItem,
} from './arenaPlanner';

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('computeArenaGeometry', () => {
  it('place les lignes de mise en garde à 2 m du centre, soit 4 m entre elles', () => {
    const g = computeArenaGeometry();
    expect(g.guardLines.green - g.guardLines.red).toBe(4);
    expect(g.guardLines.green).toBe(ARENA_GUARD_OFFSET_M);
  });

  it('a une zone de Ø 8 m et une limite de sécurité de Ø 12 m', () => {
    const g = computeArenaGeometry();
    expect(g.zoneRadiusM * 2).toBe(8);
    expect(g.safetyRadiusM * 2).toBe(12);
  });

  it('place combattants, arbitres et e-arbitre selon le schéma', () => {
    const g = computeArenaGeometry({ x: 10, y: 10 });
    const byLabel = Object.fromEntries(g.roles.map(r => [r.label, r.position]));
    // Combattant vert à l'est, rouge à l'ouest, à 2 m du centre
    close(byLabel['1'].x, 12);
    close(byLabel['1'].y, 10);
    close(byLabel['2'].x, 8);
    // Arbitre principal au sud (hors zone A : > 4 m)
    close(byLabel['3'].x, 10);
    expect(byLabel['3'].y).toBeGreaterThan(10 + 4);
    // e-arbitre au nord, à 6 m (bord de la limite de sécurité)
    close(byLabel['6'].y, 4);
  });
});

describe('polarPoint', () => {
  it('0° pointe vers le nord (y décroissant)', () => {
    const p = polarPoint({ x: 0, y: 0 }, 3, 0);
    close(p.x, 0);
    close(p.y, -3);
  });
});

describe('planArenaGrid', () => {
  it('une arène tient dans une salle de 12 m + marges', () => {
    const plan = planArenaGrid({ widthM: 14, lengthM: 14 }, 1);
    expect(plan.fits).toBe(true);
    expect(plan.centers).toHaveLength(1);
    expect(plan.requiredWidthM).toBe(14);
  });

  it('refuse une salle trop petite', () => {
    const plan = planArenaGrid({ widthM: 12, lengthM: 12 }, 1);
    expect(plan.fits).toBe(false);
  });

  it('espace les centres de 12 m (cercles de sécurité jointifs, pas de chevauchement)', () => {
    const plan = planArenaGrid({ widthM: 100, lengthM: 100 }, 4);
    const [a, b] = plan.centers;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    expect(d).toBeGreaterThanOrEqual(2 * ARENA_SAFETY_RADIUS_M);
  });

  it('choisit une disposition qui minimise la surface requise', () => {
    // 4 arènes : 2×2 (24×24) doit battre 4×1 (48×12) en surface
    const plan = planArenaGrid({ widthM: 100, lengthM: 100 }, 4, 0);
    expect(plan.columns * plan.rows).toBe(4);
    expect(plan.requiredWidthM * plan.requiredLengthM).toBe(24 * 24);
  });

  it('gère zéro arène', () => {
    const plan = planArenaGrid({ widthM: 10, lengthM: 10 }, 0);
    expect(plan.fits).toBe(true);
    expect(plan.centers).toEqual([]);
  });
});

describe('checkRoomItems', () => {
  const room = { widthM: 30, lengthM: 30 };
  const arena = [{ x: 15, y: 15 }];
  const item = (over: Partial<RoomItem>): RoomItem => ({
    id: 't1',
    kind: 'table',
    label: 'Table',
    x: 0,
    y: 0,
    widthM: 1,
    heightM: 1,
    ...over,
  });

  it("accepte un élément loin de l'arène et dans la salle", () => {
    expect(checkRoomItems(room, arena, [item({ x: 0, y: 0 })])).toEqual([]);
  });

  it('signale un élément hors de la salle', () => {
    const issues = checkRoomItems(room, arena, [item({ x: 29.5, y: 0 })]);
    expect(issues).toContainEqual({ itemId: 't1', type: 'outOfRoom' });
  });

  it("signale un élément dans la zone de sécurité d'une arène", () => {
    const issues = checkRoomItems(room, arena, [item({ x: 14, y: 14 })]);
    expect(issues).toContainEqual({ itemId: 't1', type: 'inSafetyZone', arenaIndex: 0 });
  });

  it('ne signale rien pour une prise juste hors du cercle de 6 m', () => {
    // centre (15,15), bord de la prise à 6.5 m horizontal
    const issues = checkRoomItems(room, arena, [
      item({ x: 21.5, y: 14.5, widthM: 0.5, heightM: 0.5 }),
    ]);
    expect(issues).toEqual([]);
  });
});
