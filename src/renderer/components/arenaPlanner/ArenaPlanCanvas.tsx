/**
 * BellePoule Modern - Plan de salle interactif du planificateur d'arène (#2075)
 * Dessin SVG à l'échelle : grille de 1 m, cotes de la salle, arènes et éléments
 * déplaçables, redimensionnables (poignée de coin) et tournables (poignée
 * ronde) à la souris, aimantation 0,5 m (15° pour la rotation), ou au clavier.
 * Licensed under GPL-3.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../common/Button';
import { useTranslation } from '../../hooks/useTranslation';
import { technicalDimensions, type DimensionLine } from '@shared/domain/arena/arenaDimensions';
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
const ZOOM_MIN = 1;
const ZOOM_MAX = 8;
const ZOOM_STEP = 1.25;
const PAN_CLICK_PX = 4;
const NUDGE_M = 0.1;
const NUDGE_BIG_M = 1;
const ROTATE_STEP_DEG = 15;
const HANDLE_M = 0.35;
const ROTATE_HANDLE_OFFSET_M = 0.9;

export const ITEM_CLASS: Record<RoomItem['kind'], string> = {
  table: 'arena-planner-item-table',
  outlet: 'arena-planner-item-outlet',
  accessory: 'arena-planner-item-accessory',
  exit: 'arena-planner-item-exit',
  blocked: 'arena-planner-item-blocked',
};

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

type DragState =
  | { mode: 'move'; id: string; dx: number; dy: number }
  | { mode: 'arena'; index: number; dx: number; dy: number }
  | { mode: 'pan'; startX: number; startY: number; c0: Point; moved: boolean }
  | { mode: 'resize'; id: string; cx: number; cy: number; rot: number }
  | { mode: 'rotate'; id: string; cx: number; cy: number };

export interface ArenaPlanCanvasProps {
  room: RoomSize;
  centers: Point[];
  items: RoomItem[];
  selectedId: string | null;
  conflictIds: Set<string>;
  snap: boolean;
  showDims: boolean;
  svgRef: React.RefObject<SVGSVGElement | null>;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
  onMoveArena: (index: number, x: number, y: number) => void;
  onResize: (id: string, widthM: number, heightM: number) => void;
  onRotate: (id: string, deg: number) => void;
  onDelete: (id: string) => void;
}

export const ArenaPlanCanvas: React.FC<ArenaPlanCanvasProps> = ({
  room,
  centers,
  items,
  selectedId,
  conflictIds,
  snap,
  showDims,
  svgRef,
  onSelect,
  onMove,
  onMoveArena,
  onResize,
  onRotate,
  onDelete,
}) => {
  const { t } = useTranslation();
  const dragRef = useRef<DragState | null>(null);
  /** Zoom (1 = plan entier) et centre de la vue, en mètres */
  const [zoom, setZoom] = useState(ZOOM_MIN);
  const [viewCenter, setViewCenter] = useState<Point>({ x: room.widthM / 2, y: room.lengthM / 2 });
  const defaultCenter = { x: room.widthM / 2, y: room.lengthM / 2 };
  const center = zoom === ZOOM_MIN ? defaultCenter : viewCenter;

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

  const startDrag = (e: React.PointerEvent<SVGElement>, state: DragState) => {
    e.stopPropagation();
    dragRef.current = state;
    if ('id' in state) onSelect(state.id);
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  const onItemPointerDown = (e: React.PointerEvent<SVGGElement>, item: RoomItem) => {
    const p = toMetres(e.clientX, e.clientY);
    if (!p) return;
    startDrag(e, { mode: 'move', id: item.id, dx: p.x - item.x, dy: p.y - item.y });
  };

  const onResizePointerDown = (e: React.PointerEvent<SVGElement>, item: RoomItem) => {
    startDrag(e, {
      mode: 'resize',
      id: item.id,
      cx: item.x + item.widthM / 2,
      cy: item.y + item.heightM / 2,
      rot: item.rotationDeg ?? 0,
    });
  };

  const onRotatePointerDown = (e: React.PointerEvent<SVGElement>, item: RoomItem) => {
    startDrag(e, {
      mode: 'rotate',
      id: item.id,
      cx: item.x + item.widthM / 2,
      cy: item.y + item.heightM / 2,
    });
  };

  const onSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.mode === 'pan') {
      const ctm = svgRef.current?.getScreenCTM();
      if (!ctm) return;
      const dpx = e.clientX - drag.startX;
      const dpy = e.clientY - drag.startY;
      if (Math.abs(dpx) + Math.abs(dpy) > PAN_CLICK_PX) drag.moved = true;
      if (drag.moved && zoom > ZOOM_MIN) {
        setViewCenter({ x: drag.c0.x - dpx / ctm.a, y: drag.c0.y - dpy / ctm.d });
      }
      return;
    }
    const p = toMetres(e.clientX, e.clientY);
    if (!p) return;
    if (drag.mode === 'arena') {
      const rawX = p.x - drag.dx;
      const rawY = p.y - drag.dy;
      onMoveArena(drag.index, snap ? snapToStep(rawX) : rawX, snap ? snapToStep(rawY) : rawY);
      return;
    }
    if (drag.mode === 'move') {
      const rawX = p.x - drag.dx;
      const rawY = p.y - drag.dy;
      onMove(drag.id, snap ? snapToStep(rawX) : rawX, snap ? snapToStep(rawY) : rawY);
      return;
    }
    if (drag.mode === 'resize') {
      // Point du pointeur dans le repère de l'élément (tourné), centre fixe
      const rad = (-drag.rot * Math.PI) / 180;
      const vx = p.x - drag.cx;
      const vy = p.y - drag.cy;
      const lx = vx * Math.cos(rad) - vy * Math.sin(rad);
      const ly = vx * Math.sin(rad) + vy * Math.cos(rad);
      const w = Math.max(0.2, 2 * Math.abs(lx));
      const h = Math.max(0.2, 2 * Math.abs(ly));
      onResize(drag.id, snap ? snapToStep(w) : w, snap ? snapToStep(h) : h);
      return;
    }
    // Rotation : 0° vers le haut, sens horaire
    const deg = (Math.atan2(p.x - drag.cx, -(p.y - drag.cy)) * 180) / Math.PI;
    const snapped = snap ? Math.round(deg / ROTATE_STEP_DEG) * ROTATE_STEP_DEG : deg;
    onRotate(drag.id, snapped);
  };

  /** Zoom autour d'un point (le point reste sous le curseur) */
  const applyZoom = (factor: number, anchor: Point | null) => {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * factor));
    if (next === ZOOM_MIN) {
      setZoom(ZOOM_MIN);
      return;
    }
    const ratio = zoom / next;
    const a = anchor ?? center;
    setZoom(next);
    setViewCenter({
      x: a.x + (center.x - a.x) * ratio,
      y: a.y + (center.y - a.y) * ratio,
    });
  };

  // Gestionnaires lus par le listener de molette (attaché une seule fois, non passif)
  const handlersRef = useRef({ applyZoom, toMetres });
  useEffect(() => {
    handlersRef.current = { applyZoom, toMetres };
  });
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const anchor = handlersRef.current.toMetres(ev.clientX, ev.clientY);
      handlersRef.current.applyZoom(ev.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, anchor);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [svgRef]);

  const onSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    dragRef.current = {
      mode: 'pan',
      startX: e.clientX,
      startY: e.clientY,
      c0: center,
      moved: false,
    };
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  const endDrag = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag && drag.mode === 'pan' && !drag.moved) onSelect(null);
  };

  const onItemKeyDown = (e: React.KeyboardEvent<SVGGElement>, item: RoomItem) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onDelete(item.id);
      return;
    }
    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      onRotate(item.id, (item.rotationDeg ?? 0) + 90);
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
  const dims = useMemo(
    () => (showDims ? technicalDimensions(room, centers, items) : null),
    [showDims, room, centers, items]
  );

  const fullW = W + 2 * VIEW_PAD_M;
  const fullH = L + 2 * VIEW_PAD_M;
  const viewW = fullW / zoom;
  const viewH = fullH / zoom;
  const viewBox = `${center.x - viewW / 2} ${center.y - viewH / 2} ${viewW} ${viewH}`;
  const fullViewBox = `${-VIEW_PAD_M} ${-VIEW_PAD_M} ${fullW} ${fullH}`;

  return (
    <div className="arena-planner-canvas-wrap">
      <div
        className="arena-planner-zoombar"
        role="toolbar"
        aria-label={t('arenaPlanner.view_hint')}
      >
        <Button
          type="button"
          size="sm"
          onClick={() => applyZoom(ZOOM_STEP, null)}
          disabled={zoom >= ZOOM_MAX}
          title={t('arenaPlanner.zoom_in')}
          aria-label={t('arenaPlanner.zoom_in')}
        >
          +
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => applyZoom(1 / ZOOM_STEP, null)}
          disabled={zoom <= ZOOM_MIN}
          title={t('arenaPlanner.zoom_out')}
          aria-label={t('arenaPlanner.zoom_out')}
        >
          −
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => setZoom(ZOOM_MIN)}
          disabled={zoom === ZOOM_MIN}
          title={t('arenaPlanner.zoom_fit')}
        >
          {t('arenaPlanner.zoom_fit')}
        </Button>
        <span className="arena-planner-hint">{t('arenaPlanner.view_hint')}</span>
      </div>
      <svg
        ref={svgRef}
        className="arena-planner-svg"
        viewBox={viewBox}
        data-full-viewbox={fullViewBox}
        role="img"
        aria-label={t('arenaPlanner.title')}
        onPointerMove={onSvgPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerDown={onSvgPointerDown}
      >
        <rect x={0} y={0} width={W} height={L} className="arena-planner-room" />
        {gridX.map(x => (
          <line key={`gx${x}`} x1={x} y1={0} x2={x} y2={L} className="arena-planner-grid" />
        ))}
        {gridY.map(y => (
          <line key={`gy${y}`} x1={0} y1={y} x2={W} y2={y} className="arena-planner-grid" />
        ))}
        {dims ? null : (
          <>
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
          </>
        )}
        {dims ? dims.lines.map((l, i) => <DimensionLineView key={`dl${i}`} line={l} />) : null}
        {dims
          ? dims.centers.map((c, i) => (
              <g key={`cc${i}`} className="arena-planner-centre-mark">
                <line x1={c.x - 0.4} y1={c.y} x2={c.x + 0.4} y2={c.y} />
                <line x1={c.x} y1={c.y - 0.4} x2={c.x} y2={c.y + 0.4} />
              </g>
            ))
          : null}
        {dims
          ? dims.texts.map((tx, i) => (
              <text
                key={`dt${i}`}
                x={tx.x}
                y={tx.y}
                className="arena-planner-dimtext"
                textAnchor="middle"
              >
                {tx.label}
              </text>
            ))
          : null}

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
              className="arena-planner-zone arena-planner-arena-grab"
              onPointerDown={e => {
                const p = toMetres(e.clientX, e.clientY);
                if (!p) return;
                startDrag(e, {
                  mode: 'arena',
                  index: i,
                  dx: p.x - g.center.x,
                  dy: p.y - g.center.y,
                });
              }}
            >
              <title>{t('arenaPlanner.handle_arena')}</title>
            </circle>
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
                <circle
                  cx={r.position.x}
                  cy={r.position.y}
                  r={0.35}
                  className="arena-planner-role"
                />
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
          const rot = item.rotationDeg ?? 0;
          const cx = item.x + item.widthM / 2;
          const cy = item.y + item.heightM / 2;
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
              aria-label={`${item.label}, x ${fmt(item.x)} m, y ${fmt(item.y)} m, ${fmt(rot)}°`}
              aria-pressed={selected}
              className="arena-planner-item-group"
              transform={rot ? `rotate(${rot} ${cx} ${cy})` : undefined}
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
                x={cx}
                y={cy + 0.15}
                className="arena-planner-item-label"
                textAnchor="middle"
                pointerEvents="none"
              >
                {item.label}
              </text>
              {selected ? (
                <g>
                  <line
                    x1={cx}
                    y1={item.y}
                    x2={cx}
                    y2={item.y - ROTATE_HANDLE_OFFSET_M}
                    className="arena-planner-handle-stem"
                  />
                  <circle
                    cx={cx}
                    cy={item.y - ROTATE_HANDLE_OFFSET_M}
                    r={HANDLE_M / 2}
                    className="arena-planner-handle arena-planner-handle-rotate"
                    onPointerDown={e => onRotatePointerDown(e, item)}
                  >
                    <title>{t('arenaPlanner.handle_rotate')}</title>
                  </circle>
                  <rect
                    x={item.x + item.widthM - HANDLE_M / 2}
                    y={item.y + item.heightM - HANDLE_M / 2}
                    width={HANDLE_M}
                    height={HANDLE_M}
                    className="arena-planner-handle arena-planner-handle-resize"
                    onPointerDown={e => onResizePointerDown(e, item)}
                  >
                    <title>{t('arenaPlanner.handle_resize')}</title>
                  </rect>
                </g>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
};

const TICK_M = 0.15;

/** Cote technique : ligne, deux traits obliques aux extrémités, valeur au milieu. */
const DimensionLineView: React.FC<{ line: DimensionLine }> = ({ line }) => {
  const { orientation: o, from, to, at, label: text } = line;
  const [x1, y1, x2, y2] = o === 'h' ? [from, at, to, at] : [at, from, at, to];
  const mid = (from + to) / 2;
  const tick = (x: number, y: number) => (
    <line
      x1={x - TICK_M}
      y1={y + TICK_M}
      x2={x + TICK_M}
      y2={y - TICK_M}
      className="arena-planner-dimline"
    />
  );
  return (
    <g className="arena-planner-dim-group">
      <line x1={x1} y1={y1} x2={x2} y2={y2} className="arena-planner-dimline" />
      {tick(x1, y1)}
      {tick(x2, y2)}
      {o === 'h' ? (
        <text x={mid} y={at - 0.25} className="arena-planner-dimtext" textAnchor="middle">
          {text}
        </text>
      ) : (
        <text
          x={at - 0.25}
          y={mid}
          className="arena-planner-dimtext"
          textAnchor="middle"
          transform={`rotate(-90 ${at - 0.25} ${mid})`}
        >
          {text}
        </text>
      )}
    </g>
  );
};

export default ArenaPlanCanvas;
