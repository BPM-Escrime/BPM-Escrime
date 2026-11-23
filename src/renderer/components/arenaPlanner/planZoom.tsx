/**
 * BPM - Escrime - Zoom et déplacement de la vue d'un plan SVG (#2075)
 * Partagé par le plan d'une salle et la vue d'ensemble des salles : boutons
 * −/100 %/+, Ctrl + molette (ou pincement) vers le pointeur, vue zoomée
 * déplacée en glissant le fond. `data-full-viewbox` garde l'emprise entière
 * pour l'export PDF/PNG.
 * Licensed under GPL-3.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { Button } from '../common/Button';
import type { Point } from '@shared/domain/arena/arenaPlanner';

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 8;
const ZOOM_STEP = 1.25;

const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Emprise complète du plan, en mètres. */
export interface PlanBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PanState {
  clientX: number;
  clientY: number;
  mPerPx: number;
  from: Point;
}

export interface PlanZoom {
  zoom: number;
  viewBox: string;
  fullViewBox: string;
  zoomBy: (factor: number) => void;
  reset: () => void;
  /** Début d'un glisser du fond : vrai si la vue est zoomée (déplacement engagé). */
  startPan: (e: React.PointerEvent<SVGSVGElement>) => boolean;
  /** Vrai si l'évènement a servi à déplacer la vue. */
  movePan: (e: React.PointerEvent<SVGSVGElement>) => boolean;
  endPan: () => void;
}

export function usePlanZoom(svgRef: React.RefObject<SVGSVGElement | null>, box: PlanBox): PlanZoom {
  const [zoom, setZoom] = useState(1);
  /** Centre de la vue, en mètres ; null = centre de l'emprise */
  const [view, setView] = useState<Point | null>(null);
  const panRef = useRef<PanState | null>(null);

  const fullViewBox = `${box.x} ${box.y} ${box.w} ${box.h}`;
  /** Garde la fenêtre zoomée dans l'emprise. */
  const clampView = (c: Point, z: number): Point => {
    const hw = box.w / z / 2;
    const hh = box.h / z / 2;
    return {
      x: clamp(c.x, box.x + hw, box.x + box.w - hw),
      y: clamp(c.y, box.y + hh, box.y + box.h - hh),
    };
  };
  const centre = clampView(view ?? { x: box.x + box.w / 2, y: box.y + box.h / 2 }, zoom);
  const vbW = box.w / zoom;
  const vbH = box.h / zoom;
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
  const wheelRef = useRef((factor: number, at?: Point) => zoomTo(zoom * factor, at));
  useEffect(() => {
    wheelRef.current = (factor: number, at?: Point) => zoomTo(zoom * factor, at);
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
      wheelRef.current(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, at && { x: at.x, y: at.y });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [svgRef]);

  return {
    zoom,
    viewBox,
    fullViewBox,
    zoomBy: factor => zoomTo(zoom * factor),
    reset: () => {
      setZoom(1);
      setView(null);
    },
    startPan: e => {
      if (zoom === 1) return false;
      const ctm = svgRef.current?.getScreenCTM();
      if (!ctm || !ctm.a) return false;
      panRef.current = { clientX: e.clientX, clientY: e.clientY, mPerPx: 1 / ctm.a, from: centre };
      svgRef.current?.setPointerCapture(e.pointerId);
      return true;
    },
    movePan: e => {
      const pan = panRef.current;
      if (!pan) return false;
      setView(
        clampView(
          {
            x: pan.from.x - (e.clientX - pan.clientX) * pan.mPerPx,
            y: pan.from.y - (e.clientY - pan.clientY) * pan.mPerPx,
          },
          zoom
        )
      );
      return true;
    },
    endPan: () => {
      panRef.current = null;
    },
  };
}

/** Barre de zoom : −, niveau (retour à 100 %), +. */
export const PlanZoomBar: React.FC<{ zoom: PlanZoom }> = ({ zoom }) => {
  const { t } = useTranslation();
  return (
    <div className="arena-planner-zoom" role="group" aria-label={t('arenaPlanner.zoom_hint')}>
      <Button
        type="button"
        size="sm"
        onClick={() => zoom.zoomBy(1 / ZOOM_STEP)}
        disabled={zoom.zoom <= ZOOM_MIN}
        aria-label={t('arenaPlanner.zoom_out')}
        title={t('arenaPlanner.zoom_out')}
      >
        −
      </Button>
      <Button type="button" size="sm" onClick={zoom.reset} title={t('arenaPlanner.zoom_reset')}>
        {`${Math.round(zoom.zoom * 100)} %`}
      </Button>
      <Button
        type="button"
        size="sm"
        onClick={() => zoom.zoomBy(ZOOM_STEP)}
        disabled={zoom.zoom >= ZOOM_MAX}
        aria-label={t('arenaPlanner.zoom_in')}
        title={t('arenaPlanner.zoom_in')}
      >
        +
      </Button>
      <span className="arena-planner-hint">{t('arenaPlanner.zoom_hint')}</span>
    </div>
  );
};
