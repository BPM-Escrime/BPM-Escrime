/**
 * BPM - Escrime - Disciplines du planificateur d'arène (#2075)
 * Sabre Laser (arène circulaire, arenaPlanner.ts), escrime (piste FIE) et escrime
 * artistique (espace scénique). Géométrie pure, en mètres ; repère : x vers l'est,
 * y vers le sud. Piste et scène sont alignées sur les murs, axe long selon x.
 *
 * - Piste (règlement technique FIE) : 14 m × 2 m, dégagements de 2 m à chaque bout
 *   (18 m au total) ; lignes de milieu, de mise en garde (2 m du milieu),
 *   d'avertissement (5 m) et de fin de piste (7 m). Couloir latéral de 1,5 m
 *   (arbitre, circulation) : valeur d'organisation, à valider.
 * - Espace scénique (FFE, règlement national escrime artistique 2026, § 5.11) :
 *   rectangle de 10 m × 8 m. Arbitres en coulisses arrière gauche (jardin) et
 *   avant droite (cour), jury face à la scène. Dégagements de 1 m sur les
 *   côtés et de 2,5 m devant et derrière : valeurs d'organisation, à valider.
 * Licensed under GPL-3.0
 */

import { LASER_FOOTPRINT, type ArenaFootprint, type Point } from './arenaPlanner';

export type ArenaDiscipline = 'laser' | 'fencing' | 'artistic';

export const ARENA_DISCIPLINES: readonly ArenaDiscipline[] = ['laser', 'fencing', 'artistic'];

/** Piste d'escrime FIE */
export const FENCING_PISTE = {
  lengthM: 14,
  widthM: 2,
  runoffM: 2,
  guardFromCentreM: 2,
  warningFromCentreM: 5,
  lateralSafetyM: 1.5,
} as const;

/** Espace scénique d'escrime artistique */
export const ARTISTIC_STAGE = {
  widthM: 10,
  depthM: 8,
  sideClearanceM: 1,
  frontBackClearanceM: 2.5,
} as const;

/** Emprise de sécurité d'une arène de la discipline (rien ne se pose dedans). */
export function arenaFootprint(discipline: ArenaDiscipline = 'laser'): ArenaFootprint {
  if (discipline === 'fencing') {
    return {
      shape: 'rect',
      halfX: FENCING_PISTE.lengthM / 2 + FENCING_PISTE.runoffM,
      halfY: FENCING_PISTE.widthM / 2 + FENCING_PISTE.lateralSafetyM,
    };
  }
  if (discipline === 'artistic') {
    return {
      shape: 'rect',
      halfX: ARTISTIC_STAGE.widthM / 2 + ARTISTIC_STAGE.sideClearanceM,
      halfY: ARTISTIC_STAGE.depthM / 2 + ARTISTIC_STAGE.frontBackClearanceM,
    };
  }
  return LASER_FOOTPRINT;
}

export interface PlanRole {
  label: string;
  position: Point;
}

export interface PisteGeometry {
  center: Point;
  /** Piste seule (14 m) : demi-longueur, demi-largeur */
  halfLengthM: number;
  halfWidthM: number;
  /** Piste et dégagements (18 m) */
  halfTotalM: number;
  /** Abscisses des lignes, depuis le milieu de la piste */
  lines: { centre: number; guard: number[]; warning: number[]; end: number[] };
  /** 1 : tireur gauche, 2 : tireur droit, 3 : arbitre */
  roles: PlanRole[];
}

export function computePisteGeometry(center: Point): PisteGeometry {
  const p = FENCING_PISTE;
  const halfLengthM = p.lengthM / 2;
  const halfWidthM = p.widthM / 2;
  return {
    center,
    halfLengthM,
    halfWidthM,
    halfTotalM: halfLengthM + p.runoffM,
    lines: {
      centre: 0,
      guard: [-p.guardFromCentreM, p.guardFromCentreM],
      warning: [-p.warningFromCentreM, p.warningFromCentreM],
      end: [-halfLengthM, halfLengthM],
    },
    roles: [
      { label: '1', position: { x: center.x - p.guardFromCentreM, y: center.y } },
      { label: '2', position: { x: center.x + p.guardFromCentreM, y: center.y } },
      { label: '3', position: { x: center.x, y: center.y + halfWidthM + p.lateralSafetyM * 0.6 } },
    ],
  };
}

export interface StageGeometry {
  center: Point;
  halfWidthM: number;
  halfDepthM: number;
  /** 1 : arbitre jardin (arrière gauche), 2 : arbitre cour (avant droite), 3 : jury (face) */
  roles: PlanRole[];
}

/** Scène vue du jury (au sud) : jardin à gauche (ouest), cour à droite (est), arrière au nord. */
export function computeStageGeometry(center: Point): StageGeometry {
  const s = ARTISTIC_STAGE;
  const hw = s.widthM / 2;
  const hd = s.depthM / 2;
  const side = s.sideClearanceM / 2;
  return {
    center,
    halfWidthM: hw,
    halfDepthM: hd,
    roles: [
      { label: '1', position: { x: center.x - hw - side, y: center.y - hd / 2 } },
      { label: '2', position: { x: center.x + hw + side, y: center.y + hd / 2 } },
      { label: '3', position: { x: center.x, y: center.y + hd + s.frontBackClearanceM * 0.6 } },
    ],
  };
}

/**
 * Pas de rotation d'une arène (degrés). Sabre Laser : quart de tour (emprise circulaire,
 * inchangée). Piste et scène : demi-tour seulement, l'emprise reste alignée sur les murs.
 */
export function arenaRotationStep(discipline: ArenaDiscipline = 'laser'): number {
  return discipline === 'laser' ? 90 : 180;
}

/** Rotation suivante d'une arène, dans [0, 360), arrondie au pas de la discipline. */
export function nextArenaRotation(current: number, discipline: ArenaDiscipline = 'laser'): number {
  const step = arenaRotationStep(discipline);
  const snapped = Math.round((Number.isFinite(current) ? current : 0) / step) * step;
  return (((snapped + step) % 360) + 360) % 360;
}
