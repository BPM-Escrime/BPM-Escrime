/**
 * BellePoule Modern - Tests du planificateur d'arène Sabre Laser (#2075)
 * Licensed under GPL-3.0
 */

import { describe, expect, it } from 'vitest';
import { technicalDimensions } from './arenaDimensions';
import {
  ARENA_GUARD_OFFSET_M,
  ARENA_SAFETY_RADIUS_M,
  checkRoomItems,
  createRoomItem,
  moveRoomItem,
  resizeRoomItem,
  resizeRoomItemAroundCenter,
  rotateRoomItem,
  itemBounds,
  normalizeRotation,
  optimizeArenaLayout,
  snapToStep,
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

describe('createRoomItem / moveRoomItem', () => {
  const room = { widthM: 10, lengthM: 8 };

  it('crée un élément à la taille par défaut, dans la salle', () => {
    const it = createRoomItem('table', 'a', 'Table', room);
    expect(it).toMatchObject({ kind: 'table', widthM: 1.5, heightM: 0.8 });
    expect(it.x).toBeGreaterThanOrEqual(0);
    expect(it.x + it.widthM).toBeLessThanOrEqual(room.widthM);
  });

  it('déplace un élément et le retient dans la salle', () => {
    const base = createRoomItem('accessory', 'b', 'Écran', room);
    expect(moveRoomItem(base, 3, 2, room)).toMatchObject({ x: 3, y: 2 });
    expect(moveRoomItem(base, 99, -5, room)).toMatchObject({ x: room.widthM - base.widthM, y: 0 });
  });

  it('signale une issue de secours qui ne touche aucun mur', () => {
    const exit = { ...createRoomItem('exit', 'e', 'Issue 1', room), x: 4, y: 3 };
    const issues = checkRoomItems(room, [], [exit]);
    expect(issues).toContainEqual({ itemId: 'e', type: 'exitNotOnWall' });
  });

  it('accepte une issue de secours collée à un mur', () => {
    const exit = { ...createRoomItem('exit', 'e', 'Issue 1', room), x: 0, y: 3 };
    expect(checkRoomItems(room, [], [exit])).toEqual([]);
  });

  it('signale un élément posé sur une zone bloquée', () => {
    const block = { ...createRoomItem('blocked', 'z', 'Zone', room), x: 5, y: 5 };
    const table = { ...createRoomItem('table', 't', 'Table', room), x: 5.5, y: 5.2 };
    expect(checkRoomItems(room, [], [block, table])).toContainEqual({
      itemId: 't',
      type: 'overlapsBlocked',
    });
  });

  it('signale une zone bloquée qui recouvre une arène', () => {
    const block = { ...createRoomItem('blocked', 'z', 'Zone', room), x: 14, y: 14 };
    expect(checkRoomItems(room, [{ x: 15, y: 15 }], [block])).toContainEqual({
      itemId: 'z',
      type: 'arenaBlocked',
      arenaIndex: 0,
    });
  });

  it('redimensionne une zone bloquée sans sortir de la salle', () => {
    const block = createRoomItem('blocked', 'z', 'Zone', room);
    const r = resizeRoomItem(block, 50, 3, room);
    expect(r.widthM).toBe(room.widthM);
    expect(r.heightM).toBe(3);
  });

  it('optimise : une arène par défaut dans 14 × 14 m, marge 1 m', () => {
    expect(optimizeArenaLayout({ widthM: 14, lengthM: 14 }, 1).count).toBe(1);
  });

  it('optimise : quatre arènes en carré dans 30 × 30 m, marge 1 m', () => {
    const r = optimizeArenaLayout({ widthM: 30, lengthM: 30 }, 1);
    expect(r.count).toBe(4);
    expect(r.lattice).toBe('square');
  });

  it('optimise : les arènes trouvées ne se chevauchent pas et restent dans la salle', () => {
    const room = { widthM: 47, lengthM: 36 };
    const r = optimizeArenaLayout(room, 1.5);
    for (let i = 0; i < r.centers.length; i++) {
      const c = r.centers[i];
      expect(c.x - ARENA_SAFETY_RADIUS_M).toBeGreaterThanOrEqual(1.5 - 1e-9);
      expect(c.x + ARENA_SAFETY_RADIUS_M).toBeLessThanOrEqual(room.widthM - 1.5 + 1e-9);
      expect(c.y + ARENA_SAFETY_RADIUS_M).toBeLessThanOrEqual(room.lengthM - 1.5 + 1e-9);
      for (let j = i + 1; j < r.centers.length; j++) {
        const d = Math.hypot(c.x - r.centers[j].x, c.y - r.centers[j].y);
        expect(d).toBeGreaterThanOrEqual(2 * ARENA_SAFETY_RADIUS_M - 1e-6);
      }
    }
  });

  it("optimise : une zone bloquée réduit le nombre d'arènes possibles", () => {
    const room = { widthM: 30, lengthM: 30 };
    const free = optimizeArenaLayout(room, 1).count;
    const block = {
      ...createRoomItem('blocked', 'z', 'Zone', room),
      x: 0,
      y: 0,
      widthM: 30,
      heightM: 30,
    };
    expect(free).toBe(4);
    expect(optimizeArenaLayout(room, 1, [block]).count).toBe(0);
  });

  it('snapToStep arrondit au demi-mètre', () => {
    expect(snapToStep(3.2)).toBe(3);
    expect(snapToStep(3.3)).toBe(3.5);
  });

  it('tourne un élément de 90° : la boîte englobante échange largeur et longueur', () => {
    const base = { ...createRoomItem('table', 'r', 'Table', room), x: 4, y: 3 };
    const turned = { ...base, rotationDeg: 90 };
    const b = itemBounds(turned);
    expect(b.maxX - b.minX).toBeCloseTo(base.heightM, 6);
    expect(b.maxY - b.minY).toBeCloseTo(base.widthM, 6);
  });

  it("rotateRoomItem garde l'élément tourné dans la salle", () => {
    const edge = { ...createRoomItem('table', 'r', 'Table', room), x: 0, y: 0 };
    const r = rotateRoomItem(edge, 90, room);
    expect(checkRoomItems(room, [], [r])).toEqual([]);
  });

  it('détecte le chevauchement de deux éléments tournés', () => {
    const a = { ...createRoomItem('table', 'a', 'A', room), x: 4, y: 4, rotationDeg: 0 };
    const b = { ...createRoomItem('blocked', 'b', 'B', room), x: 4, y: 4, rotationDeg: 45 };
    expect(checkRoomItems(room, [], [a, b])).toContainEqual({
      itemId: 'a',
      type: 'overlapsBlocked',
    });
  });

  it('normalise les angles', () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
  });

  it('redimensionne en gardant le centre', () => {
    const base = { ...createRoomItem('blocked', 'z', 'Zone', room), x: 4, y: 3 };
    const r = resizeRoomItemAroundCenter(base, 4, 2, room);
    expect(r.x + r.widthM / 2).toBeCloseTo(base.x + base.widthM / 2, 6);
    expect(r.y + r.heightM / 2).toBeCloseTo(base.y + base.heightM / 2, 6);
    expect(r.widthM).toBe(4);
  });
});

describe('technicalDimensions', () => {
  it('donne la salle, le diamètre des arènes et les espacements alignés', () => {
    const room = { widthM: 30, lengthM: 30 };
    const centers = [
      { x: 7, y: 7 },
      { x: 19, y: 7 },
      { x: 7, y: 19 },
      { x: 19, y: 19 },
    ];
    const d = technicalDimensions(room, centers, []);
    expect(d.lines).toContainEqual(
      expect.objectContaining({ orientation: 'h', from: 0, to: 30, label: '30 m' })
    );
    // Chaque centre est coté depuis le mur gauche et le mur haut (2 cotes par arène)
    expect(d.lines.filter(l => l.orientation === 'h' && l.from === 0)).toHaveLength(5);
    expect(d.lines.filter(l => l.orientation === 'v' && l.from === 0)).toHaveLength(5);
    expect(d.lines.filter(l => l.label === '7 m')).toHaveLength(4);
    expect(d.centers).toHaveLength(4);
    expect(
      d.lines.filter(l => l.orientation === 'h' && l.label === '12 m' && l.from !== 0)
    ).toHaveLength(2);
    expect(
      d.lines.filter(l => l.orientation === 'v' && l.label === '12 m' && l.from !== 0)
    ).toHaveLength(2);
  });

  it('donne les dimensions des éléments', () => {
    const room = { widthM: 10, lengthM: 10 };
    const t = { ...createRoomItem('table', 't', 'Table', room), x: 1, y: 1 };
    const d = technicalDimensions(room, [], [t]);
    expect(d.texts[0].label).toBe('1.5 m × 0.8 m');
  });
});
