/**
 * BPM - Escrime - Dessin d'une arène du planificateur selon la discipline (#2075)
 * Sabre Laser : cercles de combat et de sécurité, lignes de mise en garde, rôles 1 à 6.
 * Escrime : piste FIE 14 × 2 m, dégagements, lignes, couloir de sécurité, tireurs et arbitre.
 * Escrime artistique : espace scénique 10 × 8 m, dégagements, arbitres jardin / cour, jury.
 * Géométrie : shared/domain/arena. Plan d'une salle (poignée de déplacement) et vue d'ensemble.
 * Licensed under GPL-3.0
 */

import React from 'react';
import {
  ARENA_SAFETY_RADIUS_M,
  ARENA_ZONE_RADIUS_M,
  computeArenaGeometry,
  type Point,
} from '@shared/domain/arena/arenaPlanner';
import {
  arenaFootprint,
  computePisteGeometry,
  computeStageGeometry,
  type ArenaDiscipline,
  type PlanRole,
} from '@shared/domain/arena/arenaDisciplines';

export interface ArenaShapeProps {
  discipline: ArenaDiscipline;
  center: Point;
  /** Nom écrit au-dessus de l'arène */
  name?: string;
  /** Vue d'ensemble : contours seuls, sans rôles ni lignes */
  compact?: boolean;
  /** Poignée de déplacement (zone de combat, piste ou scène) */
  onGrab?: (e: React.PointerEvent<SVGElement>) => void;
  grabTitle?: string;
}

const Roles: React.FC<{ roles: PlanRole[] }> = ({ roles }) => (
  <>
    {roles.map(r => (
      <g key={r.label}>
        <circle cx={r.position.x} cy={r.position.y} r={0.35} className="arena-planner-role" />
        <text
          x={r.position.x}
          y={r.position.y + 0.15}
          className="arena-planner-role-label"
          textAnchor="middle"
        >
          {r.label}
        </text>
      </g>
    ))}
  </>
);

const Name: React.FC<{ center: Point; top: number; name?: string }> = ({ center, top, name }) =>
  name?.trim() ? (
    <text
      x={center.x}
      y={center.y - top - 0.3}
      className="arena-planner-arena-name"
      textAnchor="middle"
    >
      {name.trim()}
    </text>
  ) : null;

/** Rectangle centré en c, demi-côtés hx / hy */
const centredRect = (c: Point, hx: number, hy: number) => ({
  x: c.x - hx,
  y: c.y - hy,
  width: 2 * hx,
  height: 2 * hy,
});

/** Trait vertical d'une ligne de piste, à l'abscisse x (relative au milieu) */
const PisteLine: React.FC<{ c: Point; dx: number; hy: number; className: string }> = ({
  c,
  dx,
  hy,
  className,
}) => <line x1={c.x + dx} y1={c.y - hy} x2={c.x + dx} y2={c.y + hy} className={className} />;

export const ArenaShape: React.FC<ArenaShapeProps> = ({
  discipline,
  center,
  name,
  compact,
  onGrab,
  grabTitle,
}) => {
  const grab = onGrab
    ? { onPointerDown: onGrab, className: 'arena-planner-arena-grab' }
    : { className: '' };
  const title = onGrab && grabTitle ? <title>{grabTitle}</title> : null;
  const fp = arenaFootprint(discipline);

  if (discipline === 'fencing') {
    const g = computePisteGeometry(center);
    return (
      <g className="arena-planner-arena arena-planner-arena-fencing">
        <rect {...centredRect(center, fp.halfX, fp.halfY)} className="arena-planner-safety" />
        <rect
          {...centredRect(center, g.halfTotalM, g.halfWidthM)}
          className="arena-planner-runoff"
        />
        <rect
          {...centredRect(center, g.halfLengthM, g.halfWidthM)}
          className={`arena-planner-piste ${grab.className}`}
          onPointerDown={grab.onPointerDown}
        >
          {title}
        </rect>
        {compact ? null : (
          <>
            <PisteLine c={center} dx={0} hy={g.halfWidthM} className="arena-planner-piste-line" />
            {g.lines.guard.map(dx => (
              <PisteLine
                key={`g${dx}`}
                c={center}
                dx={dx}
                hy={g.halfWidthM}
                className={dx < 0 ? 'arena-planner-guard-red' : 'arena-planner-guard-green'}
              />
            ))}
            {g.lines.warning.map(dx => (
              <PisteLine
                key={`w${dx}`}
                c={center}
                dx={dx}
                hy={g.halfWidthM}
                className="arena-planner-piste-warning"
              />
            ))}
            {g.lines.end.map(dx => (
              <PisteLine
                key={`e${dx}`}
                c={center}
                dx={dx}
                hy={g.halfWidthM}
                className="arena-planner-piste-end"
              />
            ))}
            <Name center={center} top={g.halfWidthM} name={name} />
            <Roles roles={g.roles} />
          </>
        )}
      </g>
    );
  }

  if (discipline === 'artistic') {
    const g = computeStageGeometry(center);
    return (
      <g className="arena-planner-arena arena-planner-arena-artistic">
        <rect {...centredRect(center, fp.halfX, fp.halfY)} className="arena-planner-safety" />
        <rect
          {...centredRect(center, g.halfWidthM, g.halfDepthM)}
          className={`arena-planner-stage ${grab.className}`}
          onPointerDown={grab.onPointerDown}
        >
          {title}
        </rect>
        {compact ? null : (
          <>
            <Name center={center} top={g.halfDepthM} name={name} />
            <Roles roles={g.roles} />
          </>
        )}
      </g>
    );
  }

  const g = computeArenaGeometry(center);
  return (
    <g className="arena-planner-arena">
      <circle
        cx={center.x}
        cy={center.y}
        r={ARENA_SAFETY_RADIUS_M}
        className="arena-planner-safety"
      />
      <circle
        cx={center.x}
        cy={center.y}
        r={ARENA_ZONE_RADIUS_M}
        className={`arena-planner-zone ${grab.className}`}
        onPointerDown={grab.onPointerDown}
      >
        {title}
      </circle>
      {compact ? null : (
        <>
          <line
            x1={center.x + g.guardLines.red}
            y1={center.y - 0.6}
            x2={center.x + g.guardLines.red}
            y2={center.y + 0.6}
            className="arena-planner-guard-red"
          />
          <line
            x1={center.x + g.guardLines.green}
            y1={center.y - 0.6}
            x2={center.x + g.guardLines.green}
            y2={center.y + 0.6}
            className="arena-planner-guard-green"
          />
          <Name center={center} top={ARENA_ZONE_RADIUS_M} name={name} />
          <Roles roles={g.roles} />
        </>
      )}
    </g>
  );
};
