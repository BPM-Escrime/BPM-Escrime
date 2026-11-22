/**
 * BellePoule Modern - Plan de salle interactif du planificateur d'arène (#2075)
 * Dessin SVG à l'échelle : grille de 1 m, cotes de la salle, arènes et éléments
 * glissables à la souris (aimantation 0,5 m) ou au clavier.
 * Licensed under GPL-3.0
 */

import React, { useRef } from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import {
  ARENA_SAFETY_RADIUS_M,
  ARENA_ZONE_RADIUS_M,
  computeArenaGeometry,
  snapToStep,
  type Point,
  type RoomItem,
  type RoomSize,
} from '@shared/domain/arena/arenaPlanner';

const VIEW_PAD_M = 2;
const NUDGE_M = 0.1;
const NUDGE_BIG_M = 1;

export const ITEM_CLASS: Record<RoomItem['kind'], string> = {
  table: 'arena-planner-item-table',
  outlet: 'arena-planner-item-outlet',
  accessory: 'arena-planner-item-accessory',
  exit: 'arena-planner-item-exit',
  blocked: 'arena-planner-item-blocked',
};

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

export interface ArenaPlanCanvasProps {
  room: RoomSize;
  centers: Point[];
  items: RoomItem[];
  selectedId: string | null;
  conflictIds: Set<string>;
  snap: boolean;
  svgRef: React.RefObject<SVGSVGElement | null>;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
  onDelete: (id: string) => void;
}

export const ArenaPlanCanvas: React.FC<ArenaPlanCanvasProps> = ({
  room,
  centers,
  items,
  selectedId,
  conflictIds,
  snap,
  svgRef,
  onSelect,
  onMove,
  onDelete,
}) => {
  const { t } = useTranslation();
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);

  const toMetres = (clientX: number, clientY: number): Point | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };

  const itemAt = (id: string) => items.find(i => i.id === id);

  const onItemPointerDown = (e: React.PointerEvent<SVGGElement>, item: RoomItem) => {
    e.stopPropagation();
    const p = toMetres(e.clientX, e.clientY);
    if (!p) return;
    dragRef.current = { id: item.id, dx: p.x - item.x, dy: p.y - item.y };
    onSelect(item.id);
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  const onSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const p = toMetres(e.clientX, e.clientY);
    if (!p) return;
    const rawX = p.x - drag.dx;
    const rawY = p.y - drag.dy;
    onMove(drag.id, snap ? snapToStep(rawX) : rawX, snap ? snapToStep(rawY) : rawY);
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const onItemKeyDown = (e: React.KeyboardEvent<SVGGElement>, item: RoomItem) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onDelete(item.id);
      return;
    }
    const step = e.shiftKey ? NUDGE_BIG_M : NUDGE_M;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = moves[e.key];
    if (!delta) return;
    e.preventDefault();
    const current = itemAt(item.id);
    if (current) onMove(item.id, current.x + delta[0], current.y + delta[1]);
  };

  const W = room.widthM;
  const L = room.lengthM;
  const gridX = Array.from({ length: Math.floor(W) + 1 }, (_, i) => i);
  const gridY = Array.from({ length: Math.floor(L) + 1 }, (_, i) => i);
  const geos = centers.map(c => computeArenaGeometry(c));

  return (
    <svg
      ref={svgRef}
      className="arena-planner-svg"
      viewBox={`${-VIEW_PAD_M} ${-VIEW_PAD_M} ${W + 2 * VIEW_PAD_M} ${L + 2 * VIEW_PAD_M}`}
      role="img"
      aria-label={t('arenaPlanner.title')}
      onPointerMove={onSvgPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerDown={() => onSelect(null)}
    >
      <rect x={0} y={0} width={W} height={L} className="arena-planner-room" />
      {gridX.map(x => (
        <line key={`gx${x}`} x1={x} y1={0} x2={x} y2={L} className="arena-planner-grid" />
      ))}
      {gridY.map(y => (
        <line key={`gy${y}`} x1={0} y1={y} x2={W} y2={y} className="arena-planner-grid" />
      ))}
      <text x={W / 2} y={-0.7} className="arena-planner-dim" textAnchor="middle">
        {`${fmt(W)} m`}
      </text>
      <text
        x={-0.7}
        y={L / 2}
        className="arena-planner-dim"
        textAnchor="middle"
        transform={`rotate(-90 ${-0.7} ${L / 2})`}
      >
        {`${fmt(L)} m`}
      </text>

      {geos.map((g, i) => (
        <g key={`arena${i}`} className="arena-planner-arena">
          <circle
            cx={g.center.x}
            cy={g.center.y}
            r={ARENA_SAFETY_RADIUS_M}
            className="arena-planner-safety"
          />
          <circle
            cx={g.center.x}
            cy={g.center.y}
            r={ARENA_ZONE_RADIUS_M}
            className="arena-planner-zone"
          />
          <line
            x1={g.center.x + g.guardLines.red}
            y1={g.center.y - 0.6}
            x2={g.center.x + g.guardLines.red}
            y2={g.center.y + 0.6}
            className="arena-planner-guard-red"
          />
          <line
            x1={g.center.x + g.guardLines.green}
            y1={g.center.y - 0.6}
            x2={g.center.x + g.guardLines.green}
            y2={g.center.y + 0.6}
            className="arena-planner-guard-green"
          />
          {g.roles.map(r => (
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
        </g>
      ))}

      {items.map(item => {
        const conflict = conflictIds.has(item.id);
        const selected = item.id === selectedId;
        const classes = [
          'arena-planner-item',
          ITEM_CLASS[item.kind],
          selected ? 'arena-planner-item-selected' : '',
          conflict ? 'arena-planner-item-conflict' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <g
            key={item.id}
            role="button"
            tabIndex={0}
            aria-label={`${item.label}, x ${fmt(item.x)} m, y ${fmt(item.y)} m`}
            aria-pressed={selected}
            className="arena-planner-item-group"
            onPointerDown={e => onItemPointerDown(e, item)}
            onKeyDown={e => onItemKeyDown(e, item)}
            onFocus={() => onSelect(item.id)}
          >
            <rect
              x={item.x}
              y={item.y}
              width={item.widthM}
              height={item.heightM}
              className={classes}
            />
            <text
              x={item.x + item.widthM / 2}
              y={item.y + item.heightM / 2 + 0.15}
              className="arena-planner-item-label"
              textAnchor="middle"
              pointerEvents="none"
            >
              {item.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

export default ArenaPlanCanvas;
