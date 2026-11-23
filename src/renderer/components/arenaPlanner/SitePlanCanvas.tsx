/**
 * BPM - Escrime - Vue d'ensemble des salles du planificateur d'arène (#2075)
 * Toutes les salles à l'échelle, chacune déplaçable à la souris (aimantation
 * 0,5 m) ou au clavier (flèches, Maj = 1 m) ; double-clic ou Entrée ouvre la
 * salle. Zoom et déplacement de la vue comme le plan d'une salle.
 * Licensed under GPL-3.0
 */

import React, { useRef, useState } from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import {
  ARENA_SAFETY_RADIUS_M,
  ARENA_ZONE_RADIUS_M,
  snapToStep,
  type Point,
  type RoomItem,
} from '@shared/domain/arena/arenaPlanner';
import { itemClass } from './ArenaPlanCanvas';
import { PlanZoomBar, usePlanZoom, type PlanBox } from './planZoom';

const VIEW_PAD_M = 3;
const NUDGE_M = 0.1;
const NUDGE_BIG_M = 1;

export interface SiteRoom {
  id: string;
  name: string;
  x: number;
  y: number;
  widthM: number;
  lengthM: number;
  centers: Point[];
  items: RoomItem[];
}

export interface SitePlanCanvasProps {
  rooms: SiteRoom[];
  activeId: string;
  snap: boolean;
  svgRef: React.RefObject<SVGSVGElement | null>;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onOpen: (id: string) => void;
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

/** Emprise de toutes les salles, avec une marge. */
const siteBox = (rooms: SiteRoom[]): PlanBox => {
  const minX = Math.min(...rooms.map(r => r.x));
  const minY = Math.min(...rooms.map(r => r.y));
  const maxX = Math.max(...rooms.map(r => r.x + r.widthM));
  const maxY = Math.max(...rooms.map(r => r.y + r.lengthM));
  return {
    x: minX - VIEW_PAD_M,
    y: minY - VIEW_PAD_M,
    w: maxX - minX + 2 * VIEW_PAD_M,
    h: maxY - minY + 2 * VIEW_PAD_M,
  };
};

export const SitePlanCanvas: React.FC<SitePlanCanvasProps> = ({
  rooms,
  activeId,
  snap,
  svgRef,
  onSelect,
  onMove,
  onOpen,
}) => {
  const { t } = useTranslation();
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  /** Emprise figée pendant un glisser : la vue ne bouge pas sous la souris. */
  const [frozen, setFrozen] = useState<PlanBox | null>(null);
  const box = frozen ?? siteBox(rooms);
  const zoom = usePlanZoom(svgRef, box);

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

  const onRoomPointerDown = (e: React.PointerEvent<SVGGElement>, room: SiteRoom) => {
    e.stopPropagation();
    onSelect(room.id);
    const p = toMetres(e.clientX, e.clientY);
    if (!p) return;
    dragRef.current = { id: room.id, dx: p.x - room.x, dy: p.y - room.y };
    setFrozen(box);
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (zoom.movePan(e)) return;
    const drag = dragRef.current;
    if (!drag) return;
    const p = toMetres(e.clientX, e.clientY);
    if (!p) return;
    const x = p.x - drag.dx;
    const y = p.y - drag.dy;
    onMove(drag.id, snap ? snapToStep(x) : x, snap ? snapToStep(y) : y);
  };

  const endDrag = () => {
    dragRef.current = null;
    setFrozen(null);
    zoom.endPan();
  };

  const onRoomKeyDown = (e: React.KeyboardEvent<SVGGElement>, room: SiteRoom) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onOpen(room.id);
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
    onMove(room.id, room.x + delta[0], room.y + delta[1]);
  };

  return (
    <>
      <PlanZoomBar zoom={zoom} />
      <svg
        ref={svgRef}
        className={`arena-planner-svg${zoom.zoom > 1 ? ' arena-planner-svg-zoomed' : ''}`}
        viewBox={zoom.viewBox}
        data-full-viewbox={zoom.fullViewBox}
        role="img"
        aria-label={t('arenaPlanner.overview')}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerDown={e => zoom.startPan(e)}
      >
        {rooms.map(room => {
          const active = room.id === activeId;
          return (
            <g
              key={room.id}
              role="button"
              tabIndex={0}
              aria-label={`${room.name}, x ${fmt(room.x)} m, y ${fmt(room.y)} m`}
              aria-pressed={active}
              className="arena-planner-site-room"
              transform={`translate(${room.x} ${room.y})`}
              onPointerDown={e => onRoomPointerDown(e, room)}
              onDoubleClick={() => onOpen(room.id)}
              onKeyDown={e => onRoomKeyDown(e, room)}
              onFocus={() => onSelect(room.id)}
            >
              <rect
                x={0}
                y={0}
                width={room.widthM}
                height={room.lengthM}
                className={`arena-planner-room${active ? ' arena-planner-site-active' : ''}`}
              />
              {room.centers.map((c, i) => (
                <g key={`a${i}`} pointerEvents="none">
                  <circle
                    cx={c.x}
                    cy={c.y}
                    r={ARENA_SAFETY_RADIUS_M}
                    className="arena-planner-safety"
                  />
                  <circle
                    cx={c.x}
                    cy={c.y}
                    r={ARENA_ZONE_RADIUS_M}
                    className="arena-planner-zone"
                  />
                </g>
              ))}
              {room.items.map(item => {
                const cx = item.x + item.widthM / 2;
                const cy = item.y + item.heightM / 2;
                const rot = item.rotationDeg ?? 0;
                return (
                  <rect
                    key={item.id}
                    x={item.x}
                    y={item.y}
                    width={item.widthM}
                    height={item.heightM}
                    pointerEvents="none"
                    className={`arena-planner-item ${itemClass(item)}`}
                    transform={rot ? `rotate(${rot} ${cx} ${cy})` : undefined}
                  />
                );
              })}
              <text
                x={room.widthM / 2}
                y={-0.7}
                className="arena-planner-dim"
                textAnchor="middle"
                pointerEvents="none"
              >
                {`${room.name} — ${fmt(room.widthM)} × ${fmt(room.lengthM)} m`}
              </text>
            </g>
          );
        })}
      </svg>
    </>
  );
};

export default SitePlanCanvas;
