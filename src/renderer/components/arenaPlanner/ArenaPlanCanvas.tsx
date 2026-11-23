/**
 * BPM - Escrime - Plan de salle interactif du planificateur d'arène (#2075)
 * Dessin SVG à l'échelle : grille de 1 m, cotes de la salle, arènes et éléments
 * déplaçables, redimensionnables (poignée de coin) et tournables (poignée
 * ronde) à la souris, aimantation 0,5 m (15° pour la rotation), ou au clavier.
 * Zoom (boutons, Ctrl + molette ou pincement) et déplacement de la vue en
 * glissant le fond du plan ; l'export garde la salle entière (data-full-viewbox).
 * Licensed under GPL-3.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { Button } from '../common/Button';
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
const NUDGE_M = 0.1;
const NUDGE_BIG_M = 1;
const ROTATE_STEP_DEG = 15;
const HANDLE_M = 0.35;
const ROTATE_HANDLE_OFFSET_M = 0.9;
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 8;
const ZOOM_STEP = 1.25;
const LABEL_LINE_M = 0.42;

const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

export const ITEM_CLASS: Record<RoomItem['kind'], string> = {
  table: 'arena-planner-item-table',
  outlet: 'arena-planner-item-outlet',
  accessory: 'arena-planner-item-accessory',
  exit: 'arena-planner-item-exit',
  blocked: 'arena-planner-item-blocked',
};

export const KIND_LABEL_KEY: Record<RoomItem['kind'], string> = {
  table: 'arenaPlanner.kind_table',
  outlet: 'arenaPlanner.kind_outlet',
  accessory: 'arenaPlanner.kind_accessory',
  exit: 'arenaPlanner.kind_exit',
  blocked: 'arenaPlanner.kind_blocked',
};

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

type DragState =
  | { mode: 'move'; id: string; dx: number; dy: number }
  | { mode: 'arena'; index: number; dx: number; dy: number }
  | { mode: 'resize'; id: string; cx: number; cy: number; rot: number }
  | { mode: 'rotate'; id: string; cx: number; cy: number }
  | { mode: 'pan'; clientX: number; clientY: number; mPerPx: number; from: Point };

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
  const [zoom, setZoom] = useState(1);
  /** Centre de la vue, en mètres ; null = centre de la salle */
  const [view, setView] = useState<Point | null>(null);

  const W = room.widthM;
  const L = room.lengthM;
  const fullW = W + 2 * VIEW_PAD_M;
  const fullH = L + 2 * VIEW_PAD_M;
  const fullViewBox = `${-VIEW_PAD_M} ${-VIEW_PAD_M} ${fullW} ${fullH}`;
  const vbW = fullW / zoom;
  const vbH = fullH / zoom;
  /** Garde la fenêtre zoomée dans la salle (marge comprise). */
  const clampView = (c: Point, z: number): Point => {
    const hw = fullW / z / 2;
    const hh = fullH / z / 2;
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    return {
      x: clamp(c.x, -VIEW_PAD_M + hw, -VIEW_PAD_M + fullW - hw),
      y: clamp(c.y, -VIEW_PAD_M + hh, -VIEW_PAD_M + fullH - hh),
    };
  };
  const centre = clampView(view ?? { x: W / 2, y: L / 2 }, zoom);
  const viewBox =
    zoom === 1 ? fullViewBox : `${centre.x - vbW / 2} ${centre.y - vbH / 2} ${vbW} ${vbH}`;

  /** Zoom autour d'un point (pointeur) ; sans point, autour du centre de la vue. */
  const zoomTo = (next: number, at?: Point) => {
    const z = clampZoom(next);
    const anchor = at ?? centre;
    const k = zoom / z;
    setView(
      clampView(
        { x: anchor.x + (centre.x - anchor.x) * k, y: anchor.y + (centre.y - anchor.y) * k },
        z
      )
    );
    setZoom(z);
  };

  // Ctrl + molette (et pincement du pavé tactile) : écouteur non passif pour bloquer le zoom de la page
  const zoomRef = useRef((factor: number, at?: Point) => zoomTo(zoom * factor, at));
  useEffect(() => {
    zoomRef.current = (factor: number, at?: Point) => zoomTo(zoom * factor, at);
  });
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const ctm = svg.getScreenCTM();
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const at = ctm ? pt.matrixTransform(ctm.inverse()) : undefined;
      zoomRef.current(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, at && { x: at.x, y: at.y });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [svgRef]);

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
      setView(
        clampView(
          {
            x: drag.from.x - (e.clientX - drag.clientX) * drag.mPerPx,
            y: drag.from.y - (e.clientY - drag.clientY) * drag.mPerPx,
          },
          zoom
        )
      );
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

  const endDrag = () => {
    dragRef.current = null;
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

  /** Fond du plan : désélectionne ; zoomé, glisser déplace la vue. */
  const onBackgroundPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    onSelect(null);
    if (zoom === 1) return;
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm || !ctm.a) return;
    dragRef.current = {
      mode: 'pan',
      clientX: e.clientX,
      clientY: e.clientY,
      mPerPx: 1 / ctm.a,
      from: centre,
    };
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  const gridX = Array.from({ length: Math.floor(W) + 1 }, (_, i) => i);
  const gridY = Array.from({ length: Math.floor(L) + 1 }, (_, i) => i);
  const geos = centers.map(c => computeArenaGeometry(c));
  const dims = useMemo(
    () => (showDims ? technicalDimensions(room, centers, items) : null),
    [showDims, room, centers, items]
  );

  return (
    <>
      <div className="arena-planner-zoom" role="group" aria-label={t('arenaPlanner.zoom_hint')}>
        <Button
          type="button"
          size="sm"
          onClick={() => zoomTo(zoom / ZOOM_STEP)}
          disabled={zoom <= ZOOM_MIN}
          aria-label={t('arenaPlanner.zoom_out')}
          title={t('arenaPlanner.zoom_out')}
        >
          −
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            setZoom(1);
            setView(null);
          }}
          title={t('arenaPlanner.zoom_reset')}
        >
          {`${Math.round(zoom * 100)} %`}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => zoomTo(zoom * ZOOM_STEP)}
          disabled={zoom >= ZOOM_MAX}
          aria-label={t('arenaPlanner.zoom_in')}
          title={t('arenaPlanner.zoom_in')}
        >
          +
        </Button>
        <span className="arena-planner-hint">{t('arenaPlanner.zoom_hint')}</span>
      </div>
      <svg
        ref={svgRef}
        className={`arena-planner-svg${zoom > 1 ? ' arena-planner-svg-zoomed' : ''}`}
        viewBox={viewBox}
        data-full-viewbox={fullViewBox}
        role="img"
        aria-label={t('arenaPlanner.title')}
        onPointerMove={onSvgPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerDown={onBackgroundPointerDown}
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
              aria-label={`${item.label.replace(/\n/g, ' ') || t(KIND_LABEL_KEY[item.kind])}, x ${fmt(item.x)} m, y ${fmt(item.y)} m, ${fmt(rot)}°`}
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
              <ItemLabel text={item.label} cx={cx} cy={cy} />
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
    </>
  );
};

/** Texte de l'élément, une ligne par retour à la ligne, centré sur l'élément. */
const ItemLabel: React.FC<{ text: string; cx: number; cy: number }> = ({ text, cx, cy }) => {
  const lines = text.split('\n');
  const top = cy + 0.15 - ((lines.length - 1) * LABEL_LINE_M) / 2;
  return (
    <text className="arena-planner-item-label" textAnchor="middle" pointerEvents="none">
      {lines.map((line, i) => (
        <tspan key={i} x={cx} y={top + i * LABEL_LINE_M}>
          {line}
        </tspan>
      ))}
    </text>
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
