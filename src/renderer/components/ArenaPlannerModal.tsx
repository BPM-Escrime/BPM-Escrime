/**
 * BellePoule Modern - Planificateur de placement d'arène Sabre Laser (#2075)
 * Outil à côté du QR Wi-Fi et de la télécommande TV : dimensions de la salle,
 * nombre d'arènes, aperçu à l'échelle, tables / prises / accessoires à glisser
 * à la souris, export PDF et PNG. La géométrie vient de shared/domain/arena.
 * Licensed under GPL-3.0
 */

import React, { useMemo, useRef, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import Modal from './common/Modal';
import { logger, LogCategory } from '@shared/services/logger';
import {
  ARENA_SAFETY_RADIUS_M,
  ARENA_ZONE_RADIUS_M,
  checkRoomItems,
  computeArenaGeometry,
  createRoomItem,
  moveRoomItem,
  planArenaGrid,
  type Point,
  type RoomItem,
} from '@shared/domain/arena/arenaPlanner';
import { exportArenaPlanPdf, exportArenaPlanPng } from './arenaPlanner/arenaPlanExport';

interface ArenaPlannerModalProps {
  onClose: () => void;
}

const ITEM_FILL: Record<RoomItem['kind'], string> = {
  table: '#93c5fd',
  outlet: '#fbbf24',
  accessory: '#c4b5fd',
  exit: '#86efac',
};

const parseNumber = (value: string): number | null => {
  const n = Number(value.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

export const ArenaPlannerModal: React.FC<ArenaPlannerModalProps> = ({ onClose }) => {
  const { t } = useTranslation();
  const [width, setWidth] = useState('20');
  const [length, setLength] = useState('20');
  const [arenas, setArenas] = useState('1');
  const [margin, setMargin] = useState('1');
  const [items, setItems] = useState<RoomItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const idCounter = useRef(0);
  const [exportError, setExportError] = useState('');

  const parsed = useMemo(() => {
    const w = parseNumber(width);
    const l = parseNumber(length);
    const n = parseNumber(arenas);
    const m = parseNumber(margin);
    if (
      w === null ||
      l === null ||
      n === null ||
      m === null ||
      w <= 0 ||
      l <= 0 ||
      m < 0 ||
      n < 1
    ) {
      return null;
    }
    return { w, l, n: Math.floor(n), m };
  }, [width, length, arenas, margin]);

  const plan = useMemo(
    () =>
      parsed ? planArenaGrid({ widthM: parsed.w, lengthM: parsed.l }, parsed.n, parsed.m) : null,
    [parsed]
  );

  const issues = useMemo(() => {
    if (!parsed || !plan) return [];
    return checkRoomItems({ widthM: parsed.w, lengthM: parsed.l }, plan.centers, items);
  }, [parsed, plan, items]);
  const conflictIds = useMemo(() => new Set(issues.map(i => i.itemId)), [issues]);

  /** Coordonnées souris → mètres dans le repère du SVG. */
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

  const addItem = (kind: RoomItem['kind']) => {
    if (!parsed) return;
    idCounter.current += 1;
    const id = `item-${idCounter.current}`;
    const count = items.filter(i => i.kind === kind).length + 1;
    const label = `${t(`arenaPlanner.kind_${kind}`)} ${count}`;
    const item = createRoomItem(kind, id, label, { widthM: parsed.w, lengthM: parsed.l });
    setItems(prev => [...prev, item]);
    setSelectedId(id);
  };

  const removeSelected = () => {
    if (!selectedId) return;
    setItems(prev => prev.filter(i => i.id !== selectedId));
    setSelectedId(null);
  };

  const onItemPointerDown = (e: React.PointerEvent<SVGGElement>, item: RoomItem) => {
    e.stopPropagation();
    const p = toMetres(e.clientX, e.clientY);
    if (!p) return;
    dragRef.current = { id: item.id, dx: p.x - item.x, dy: p.y - item.y };
    setSelectedId(item.id);
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  const onSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || !parsed) return;
    const p = toMetres(e.clientX, e.clientY);
    if (!p) return;
    setItems(prev =>
      prev.map(it =>
        it.id === drag.id
          ? moveRoomItem(it, p.x - drag.dx, p.y - drag.dy, { widthM: parsed.w, lengthM: parsed.l })
          : it
      )
    );
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const onItemKeyDown = (e: React.KeyboardEvent<SVGGElement>, item: RoomItem) => {
    if (!parsed) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      setItems(prev => prev.filter(i => i.id !== item.id));
      setSelectedId(null);
      return;
    }
    const step = e.shiftKey ? 1 : 0.1;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = moves[e.key];
    if (!delta) return;
    e.preventDefault();
    const room = { widthM: parsed.w, lengthM: parsed.l };
    setItems(prev =>
      prev.map(i => (i.id === item.id ? moveRoomItem(i, i.x + delta[0], i.y + delta[1], room) : i))
    );
  };

  const svg = useMemo(() => {
    if (!parsed || !plan) return null;
    const pad = 1;
    const vbW = parsed.w + 2 * pad;
    const vbH = parsed.l + 2 * pad;
    const geos = plan.centers.map(c => computeArenaGeometry(c));
    return (
      <svg
        ref={svgRef}
        viewBox={`${-pad} ${-pad} ${vbW} ${vbH}`}
        role="img"
        aria-label={t('arenaPlanner.title')}
        style={{ width: '100%', maxHeight: '60vh', background: '#ffffff', touchAction: 'none' }}
        onPointerMove={onSvgPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerDown={() => setSelectedId(null)}
      >
        <rect
          x={0}
          y={0}
          width={parsed.w}
          height={parsed.l}
          fill="none"
          stroke="#555"
          strokeWidth={0.1}
        />
        {geos.map((g, i) => (
          <g key={i}>
            <circle
              cx={g.center.x}
              cy={g.center.y}
              r={ARENA_SAFETY_RADIUS_M}
              fill="none"
              stroke="#2e7d32"
              strokeWidth={0.08}
              strokeDasharray="0.4 0.2"
            />
            <circle
              cx={g.center.x}
              cy={g.center.y}
              r={ARENA_ZONE_RADIUS_M}
              fill="#fde047"
              fillOpacity={0.6}
              stroke="#dc2626"
              strokeWidth={0.08}
            />
            <line
              x1={g.center.x + g.guardLines.red}
              y1={g.center.y - 0.6}
              x2={g.center.x + g.guardLines.red}
              y2={g.center.y + 0.6}
              stroke="#dc2626"
              strokeWidth={0.12}
            />
            <line
              x1={g.center.x + g.guardLines.green}
              y1={g.center.y - 0.6}
              x2={g.center.x + g.guardLines.green}
              y2={g.center.y + 0.6}
              stroke="#2e7d32"
              strokeWidth={0.12}
            />
            {g.roles.map(r => (
              <g key={r.label}>
                <circle cx={r.position.x} cy={r.position.y} r={0.35} fill="#111" />
                <text
                  x={r.position.x}
                  y={r.position.y + 0.15}
                  fontSize={0.45}
                  fill="#fff"
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
          return (
            <g
              key={item.id}
              role="button"
              tabIndex={0}
              aria-label={`${item.label}: ${t('arenaPlanner.drag_hint')}`}
              style={{ cursor: 'grab' }}
              onPointerDown={e => onItemPointerDown(e, item)}
              onKeyDown={e => onItemKeyDown(e, item)}
            >
              <rect
                x={item.x}
                y={item.y}
                width={item.widthM}
                height={item.heightM}
                fill={ITEM_FILL[item.kind]}
                stroke={conflict ? '#dc2626' : selected ? '#2563eb' : '#111'}
                strokeWidth={conflict || selected ? 0.15 : 0.05}
              />
              <text
                x={item.x + item.widthM / 2}
                y={item.y + item.heightM / 2 + 0.15}
                fontSize={0.35}
                fill="#111"
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, plan, items, conflictIds, selectedId, t]);

  const exportText = () => {
    if (!parsed || !plan) return null;
    return {
      title: t('arenaPlanner.title'),
      summary: [
        t('arenaPlanner.summary_room', { width: fmt(parsed.w), length: fmt(parsed.l) }),
        t('arenaPlanner.summary_arenas', {
          count: parsed.n,
          columns: plan.columns,
          rows: plan.rows,
        }),
        plan.fits ? t('arenaPlanner.fits') : t('arenaPlanner.nofit'),
      ],
      legend: [
        t('arenaPlanner.legend_zone'),
        t('arenaPlanner.legend_safety'),
        t('arenaPlanner.legend_guard'),
        t('arenaPlanner.legend_roles'),
      ],
      itemsTitle: t('arenaPlanner.items_title'),
      items: items.map(i =>
        t('arenaPlanner.item_line', {
          label: i.label,
          x: fmt(i.x),
          y: fmt(i.y),
          width: fmt(i.widthM),
          height: fmt(i.heightM),
        })
      ),
      note: t('arenaPlanner.note'),
    };
  };

  const runExport = async (kind: 'pdf' | 'png') => {
    const text = exportText();
    if (!svgRef.current || !text) return;
    setExportError('');
    try {
      if (kind === 'pdf') {
        await exportArenaPlanPdf(svgRef.current, text, 'plan-arenes.pdf');
      } else {
        await exportArenaPlanPng(svgRef.current, 'plan-arenes.png');
      }
    } catch (error) {
      logger.error(LogCategory.BUSINESS, "Export du plan d'arène impossible", error as Error);
      setExportError(t('arenaPlanner.export_error'));
    }
  };

  return (
    <Modal title={t('arenaPlanner.title')} onClose={onClose} size="lg" scroll>
      <p>{t('arenaPlanner.hint')}</p>
      <div className="form-group">
        <label className="form-label" htmlFor="arena-width">
          {t('arenaPlanner.width')}
        </label>
        <input
          id="arena-width"
          className="form-input"
          type="text"
          inputMode="decimal"
          value={width}
          onChange={e => setWidth(e.target.value)}
        />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="arena-length">
          {t('arenaPlanner.length')}
        </label>
        <input
          id="arena-length"
          className="form-input"
          type="text"
          inputMode="decimal"
          value={length}
          onChange={e => setLength(e.target.value)}
        />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="arena-count">
          {t('arenaPlanner.arenas')}
        </label>
        <input
          id="arena-count"
          className="form-input"
          type="text"
          inputMode="numeric"
          value={arenas}
          onChange={e => setArenas(e.target.value)}
        />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="arena-margin">
          {t('arenaPlanner.margin')}
        </label>
        <input
          id="arena-margin"
          className="form-input"
          type="text"
          inputMode="decimal"
          value={margin}
          onChange={e => setMargin(e.target.value)}
        />
      </div>

      {!parsed || !plan ? (
        <p role="alert">{t('arenaPlanner.invalid')}</p>
      ) : (
        <>
          <p role="status">
            {plan.fits ? t('arenaPlanner.fits') : t('arenaPlanner.nofit')}
            {' — '}
            {t('arenaPlanner.grid', { columns: plan.columns, rows: plan.rows })}
          </p>
          <p>
            {t('arenaPlanner.required', {
              width: plan.requiredWidthM,
              length: plan.requiredLengthM,
            })}
          </p>

          <div className="form-group" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button type="button" className="btn" onClick={() => addItem('table')}>
              {t('arenaPlanner.add_table')}
            </button>
            <button type="button" className="btn" onClick={() => addItem('outlet')}>
              {t('arenaPlanner.add_outlet')}
            </button>
            <button type="button" className="btn" onClick={() => addItem('accessory')}>
              {t('arenaPlanner.add_accessory')}
            </button>
            <button type="button" className="btn" onClick={() => addItem('exit')}>
              {t('arenaPlanner.add_exit')}
            </button>
            <button type="button" className="btn" onClick={removeSelected} disabled={!selectedId}>
              {t('arenaPlanner.remove')}
            </button>
          </div>
          <p>{t('arenaPlanner.drag_hint')}</p>

          {svg}

          {conflictIds.size > 0 && <p role="alert">{t('arenaPlanner.conflict')}</p>}
          {issues.some(i => i.type === 'exitNotOnWall') && (
            <p role="alert">{t('arenaPlanner.exit_wall')}</p>
          )}

          <ul>
            <li>{t('arenaPlanner.legend_zone')}</li>
            <li>{t('arenaPlanner.legend_safety')}</li>
            <li>{t('arenaPlanner.legend_guard')}</li>
            <li>{t('arenaPlanner.legend_roles')}</li>
          </ul>
          <p>{t('arenaPlanner.note')}</p>

          <div className="form-group" style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" className="btn btn-primary" onClick={() => runExport('pdf')}>
              {t('arenaPlanner.export_pdf')}
            </button>
            <button type="button" className="btn" onClick={() => runExport('png')}>
              {t('arenaPlanner.export_png')}
            </button>
          </div>
          {exportError && <p role="alert">{exportError}</p>}
        </>
      )}
    </Modal>
  );
};

export default ArenaPlannerModal;
