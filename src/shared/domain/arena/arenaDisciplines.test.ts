import { describe, expect, it } from 'vitest';
import {
  arenaFootprint,
  computePisteGeometry,
  computeStageGeometry,
  FENCING_PISTE,
  nextArenaRotation,
} from './arenaDisciplines';
import {
  checkRoomItems,
  LASER_FOOTPRINT,
  moveArenaWithPush,
  optimizeArenaLayout,
  spreadArenaCenters,
  type RoomItem,
} from './arenaPlanner';
import { technicalDimensions } from './arenaDimensions';

const table = (x: number, y: number): RoomItem => ({
  id: 't',
  kind: 'table',
  label: '',
  x,
  y,
  widthM: 1,
  heightM: 1,
});

describe('disciplines du planificateur', () => {
  it('laser : cercle de sécurité Ø 12 m', () => {
    expect(arenaFootprint('laser')).toBe(LASER_FOOTPRINT);
    expect(arenaFootprint()).toBe(LASER_FOOTPRINT);
  });

  it('escrime : piste 14 × 2 m, dégagements 2 m, couloir 1,5 m', () => {
    expect(arenaFootprint('fencing')).toEqual({ shape: 'rect', halfX: 9, halfY: 2.5 });
    const g = computePisteGeometry({ x: 10, y: 5 });
    expect(g.halfTotalM * 2).toBe(FENCING_PISTE.lengthM + 2 * FENCING_PISTE.runoffM);
    expect(g.lines.guard).toEqual([-2, 2]);
    expect(g.lines.warning).toEqual([-5, 5]);
    expect(g.lines.end).toEqual([-7, 7]);
    expect(g.roles.map(r => r.position.x)).toEqual([8, 12, 10]);
  });

  it('escrime artistique : scène 10 × 8 m, jury face à la scène, au sud', () => {
    expect(arenaFootprint('artistic')).toEqual({ shape: 'rect', halfX: 6, halfY: 6.5 });
    const g = computeStageGeometry({ x: 0, y: 0 });
    expect([g.halfWidthM * 2, g.halfDepthM * 2]).toEqual([10, 8]);
    const [jardin, cour, jury] = g.roles.map(r => r.position);
    expect(jardin.x).toBeLessThan(-5);
    expect(jardin.y).toBeLessThan(0);
    expect(cour.x).toBeGreaterThan(5);
    expect(cour.y).toBeGreaterThan(0);
    expect(jury.y).toBeGreaterThan(4);
    // Rôles dans l'emprise de sécurité
    const fp = arenaFootprint('artistic');
    g.roles.forEach(r => {
      expect(Math.abs(r.position.x)).toBeLessThanOrEqual(fp.halfX);
      expect(Math.abs(r.position.y)).toBeLessThanOrEqual(fp.halfY);
    });
  });

  it('optimiseur : pistes empilées en grille, sans quinconce', () => {
    const fp = arenaFootprint('fencing');
    // 20 × 26 m, marge 1 : 1 colonne de 18 m, 24 m / 5 m = 4 rangées
    const layout = optimizeArenaLayout({ widthM: 20, lengthM: 26 }, 1, [], fp);
    expect(layout.lattice).toBe('square');
    expect(layout.count).toBe(4);
    const ys = layout.centers.map(c => c.y).sort((a, b) => a - b);
    expect(ys[1] - ys[0]).toBeCloseTo(5, 6);
  });

  it('espacées : pistes réparties sur la longueur', () => {
    const fp = arenaFootprint('fencing');
    const centers = spreadArenaCenters({ widthM: 20, lengthM: 30 }, 2, 1, [], fp);
    expect(centers).not.toBeNull();
    expect(centers!.map(c => c.y)).toEqual([3.5, 26.5]);
  });

  it('élément dans le couloir de la piste signalé, hors couloir accepté', () => {
    const fp = arenaFootprint('fencing');
    const room = { widthM: 20, lengthM: 20 };
    const c = [{ x: 10, y: 10 }];
    expect(checkRoomItems(room, c, [table(9.5, 11.6)], fp)).toContainEqual({
      itemId: 't',
      type: 'inSafetyZone',
      arenaIndex: 0,
    });
    expect(checkRoomItems(room, c, [table(9.5, 12.6)], fp)).toEqual([]);
  });

  it('glisser une piste sur une autre la repousse bord contre bord', () => {
    const fp = arenaFootprint('fencing');
    const room = { widthM: 20, lengthM: 30 };
    const { centers } = moveArenaWithPush(
      [
        { x: 10, y: 5 },
        { x: 10, y: 12 },
      ],
      0,
      { x: 10, y: 10 },
      room,
      1,
      [],
      fp
    );
    expect(centers[1]).toEqual({ x: 10, y: 15 });
  });

  it("cotes décalées selon l'emprise rectangulaire", () => {
    const fp = arenaFootprint('fencing');
    const dims = technicalDimensions({ widthM: 20, lengthM: 20 }, [{ x: 10, y: 10 }], [], fp);
    const h = dims.lines.find(l => l.orientation === 'h' && l.from === 0 && l.to === 10);
    expect(h?.at).toBeCloseTo(10 + 2.5 + 0.8, 6);
  });
});

describe('rotation des arènes', () => {
  it('laser : quart de tour, retour à 0 après 270', () => {
    expect(nextArenaRotation(0, 'laser')).toBe(90);
    expect(nextArenaRotation(90, 'laser')).toBe(180);
    expect(nextArenaRotation(270, 'laser')).toBe(0);
  });
  it('piste et scène : demi-tour, emprise alignée sur les murs', () => {
    expect(nextArenaRotation(0, 'fencing')).toBe(180);
    expect(nextArenaRotation(180, 'fencing')).toBe(0);
    expect(nextArenaRotation(90, 'artistic')).toBe(0);
  });
  it('valeur invalide ou négative ramenée au pas', () => {
    expect(nextArenaRotation(Number.NaN)).toBe(90);
    expect(nextArenaRotation(-90)).toBe(0);
  });
});
