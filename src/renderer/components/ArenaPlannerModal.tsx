/**
 * BellePoule Modern - Planificateur de placement d'arène Sabre Laser (#2075)
 * Outil à côté du QR Wi-Fi et de la télécommande TV : dimensions de la salle,
 * arènes (grille automatique ou maximum trouvé par « Optimiser »), tables,
 * prises, accessoires, issues de secours et zones bloquées à placer à la souris,
 * export PDF et PNG. La géométrie vient de shared/domain/arena.
 * Licensed under GPL-3.0
 */

import React, { useMemo, useRef, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import Modal from './common/Modal';
import { Button } from './common/Button';
import { logger, LogCategory } from '@shared/services/logger';
import {
  alignArenaCenters,
  checkRoomItems,
  createRoomItem,
  moveArenaWithPush,
  moveRoomItem,
  resizeRoomItemAroundCenter,
  rotateRoomItem,
  optimizeArenaLayout,
  resizeRoomItem,
  spreadArenaCenters,
  type ArenaAlign,
  type ArenaSpacing,
  type OptimizedLayout,
  type Point,
  type RoomItem,
} from '@shared/domain/arena/arenaPlanner';
import { ArenaPlanCanvas } from './arenaPlanner/ArenaPlanCanvas';
import { ArenaPlanHelp } from './arenaPlanner/ArenaPlanHelp';

interface ArenaPlannerModalProps {
  onClose: () => void;
}

type ItemKind = RoomItem['kind'];

const TOOL_KINDS: ItemKind[] = ['table', 'outlet', 'accessory', 'exit', 'blocked'];

const TOOL_LABEL_KEY: Record<ItemKind, string> = {
  table: 'arenaPlanner.add_table',
  outlet: 'arenaPlanner.add_outlet',
  accessory: 'arenaPlanner.add_accessory',
  exit: 'arenaPlanner.add_exit',
  blocked: 'arenaPlanner.add_blocked',
};

const KIND_LABEL_KEY: Record<ItemKind, string> = {
  table: 'arenaPlanner.kind_table',
  outlet: 'arenaPlanner.kind_outlet',
  accessory: 'arenaPlanner.kind_accessory',
  exit: 'arenaPlanner.kind_exit',
  blocked: 'arenaPlanner.kind_blocked',
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
  /** Collées (pas minimal) ou espacées (occupation maximale de la salle) */
  const [spacing, setSpacing] = useState<ArenaSpacing>('packed');
  /** Centrage horizontal du bloc d'arènes */
  const [align, setAlign] = useState<ArenaAlign>('left');
  const [items, setItems] = useState<RoomItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snap, setSnap] = useState(true);
  const [showDims, setShowDims] = useState(false);
  /** Positions des arènes après un glisser à la souris ; null = positions calculées */
  const [manual, setManual] = useState<{ key: string; centers: Point[] } | null>(null);
  /** Les positions glissées ne valent que pour les dimensions et le nombre d'arènes qui les ont produites */
  const dimsKey = [width, length, arenas, margin, spacing, align].join('|');
  const manualCenters = manual && manual.key === dimsKey ? manual.centers : null;
  const [exportError, setExportError] = useState('');
  const svgRef = useRef<SVGSVGElement>(null);
  const idCounter = useRef(0);

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

  const room = useMemo(() => (parsed ? { widthM: parsed.w, lengthM: parsed.l } : null), [parsed]);

  const blockedItems = useMemo(() => items.filter(i => i.kind === 'blocked'), [items]);

  /** Maximum d'arènes que la zone peut recevoir (marge et zones bloquées prises en compte). */
  const maxLayout = useMemo<OptimizedLayout | null>(
    () => (room && parsed ? optimizeArenaLayout(room, parsed.m, blockedItems) : null),
    [room, parsed, blockedItems]
  );
  /** Jamais plus d'arènes que le maximum possible. */
  const arenaCount = maxLayout && parsed ? Math.min(parsed.n, maxLayout.count) : 0;
  const clamped = maxLayout !== null && parsed !== null && parsed.n > maxLayout.count;
  const centers: Point[] = useMemo(() => {
    if (manualCenters) return manualCenters;
    if (!maxLayout || !room || !parsed) return [];
    // « Espacées » : répartition sur la salle ; à défaut (salle trop petite, zone bloquée), collées
    const base =
      (spacing === 'spread' && spreadArenaCenters(room, arenaCount, parsed.m, blockedItems)) ||
      maxLayout.centers.slice(0, arenaCount);
    return alignArenaCenters(base, room, parsed.m, align, blockedItems);
  }, [manualCenters, maxLayout, arenaCount, room, parsed, spacing, align, blockedItems]);

  const issues = useMemo(() => {
    if (!room) return [];
    return checkRoomItems(room, centers, items);
  }, [room, centers, items]);
  const conflictIds = useMemo(() => new Set(issues.map(i => i.itemId)), [issues]);
  const selectedItem = useMemo(
    () => items.find(i => i.id === selectedId) ?? null,
    [items, selectedId]
  );

  /** « Optimiser » règle le nombre d'arènes sur le maximum possible. */
  const optimize = () => {
    if (!maxLayout) return;
    setArenas(String(Math.max(1, maxLayout.count)));
  };

  const addItem = (kind: ItemKind) => {
    if (!room) return;
    idCounter.current += 1;
    const id = `item-${idCounter.current}`;
    const count = items.filter(i => i.kind === kind).length + 1;
    const label = `${t(KIND_LABEL_KEY[kind])} ${count}`;
    setItems(prev => [...prev, createRoomItem(kind, id, label, room)]);
    setSelectedId(id);
  };

  const resizeItem = (id: string, w: number, h: number) => {
    if (!room) return;
    setItems(prev => prev.map(i => (i.id === id ? resizeRoomItemAroundCenter(i, w, h, room) : i)));
  };

  const rotateItem = (id: string, deg: number) => {
    if (!room) return;
    setItems(prev => prev.map(i => (i.id === id ? rotateRoomItem(i, deg, room) : i)));
  };

  const rotateSelected = (raw: string) => {
    const value = parseNumber(raw);
    if (value === null || !selectedItem) return;
    rotateItem(selectedItem.id, value);
  };

  const removeItem = (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
    setSelectedId(current => (current === id ? null : current));
  };

  /** Glisser une arène : les arènes voisines et les éléments qui touchent son cercle sont repoussés. */
  const moveArena = (index: number, x: number, y: number) => {
    if (!room || !parsed) return;
    const result = moveArenaWithPush(centers, index, { x, y }, room, parsed.m, items);
    setManual({ key: dimsKey, centers: result.centers });
    setItems(result.items);
  };

  const moveItem = (id: string, x: number, y: number) => {
    if (!room) return;
    setItems(prev => prev.map(i => (i.id === id ? moveRoomItem(i, x, y, room) : i)));
  };

  /** Modification manuelle des champs de l'inspecteur. */
  const editSelected = (field: 'x' | 'y' | 'w' | 'h', raw: string) => {
    const value = parseNumber(raw);
    if (value === null || !room || !selectedItem) return;
    setItems(prev =>
      prev.map(i => {
        if (i.id !== selectedItem.id) return i;
        if (field === 'x') return moveRoomItem(i, value, i.y, room);
        if (field === 'y') return moveRoomItem(i, i.x, value, room);
        if (field === 'w') return resizeRoomItem(i, value, i.heightM, room);
        return resizeRoomItem(i, i.widthM, value, room);
      })
    );
  };

  /** Maximum possible et disposition retenue pour ce maximum. */
  const maxText = (): string => {
    if (!maxLayout) return '';
    return t('arenaPlanner.optimize_result', {
      count: maxLayout.count,
      lattice: t(
        maxLayout.lattice === 'hex' ? 'arenaPlanner.lattice_hex' : 'arenaPlanner.lattice_square'
      ),
    });
  };

  const exportText = () => {
    if (!parsed || !maxLayout || !room) return null;
    return {
      title: t('arenaPlanner.title'),
      summary: [
        t('arenaPlanner.summary_room', { width: fmt(parsed.w), length: fmt(parsed.l) }),
        t('arenaPlanner.summary_arenas_max', { count: centers.length, max: maxLayout.count }),
        maxText(),
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
      const exporter = await import('./arenaPlanner/arenaPlanExport');
      if (kind === 'pdf') {
        await exporter.exportArenaPlanPdf(svgRef.current, text, 'plan-arenes.pdf');
      } else {
        await exporter.exportArenaPlanPng(svgRef.current, 'plan-arenes.png');
      }
    } catch (error) {
      logger.error(LogCategory.BUSINESS, "Export du plan d'arène impossible", error as Error);
      setExportError(t('arenaPlanner.export_error'));
    }
  };

  const selectedAlerts = {
    exit: issues.some(i => i.type === 'exitNotOnWall'),
    blockedArena: issues.some(i => i.type === 'arenaBlocked'),
    blockedOverlap: issues.some(i => i.type === 'overlapsBlocked'),
  };

  return (
    <Modal
      title={t('arenaPlanner.title')}
      onClose={onClose}
      size="xl"
      scroll
      closeOnOverlay={false}
    >
      <p className="arena-planner-lead">{t('arenaPlanner.hint')}</p>

      {!parsed || !maxLayout || !room ? <p role="alert">{t('arenaPlanner.invalid')}</p> : null}

      <div className="arena-planner-layout">
        <aside className="arena-planner-sidebar" aria-label={t('arenaPlanner.title')}>
          <div className="arena-planner-field">
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
            <p className="arena-planner-hint">{t('arenaPlanner.hint_width')}</p>
          </div>
          <div className="arena-planner-field">
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
            <p className="arena-planner-hint">{t('arenaPlanner.hint_length')}</p>
          </div>
          <div className="arena-planner-field">
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
            <p className="arena-planner-hint">{t('arenaPlanner.hint_arenas')}</p>
          </div>
          <div className="arena-planner-field">
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
            <p className="arena-planner-hint">{t('arenaPlanner.hint_margin')}</p>
          </div>
          <div className="arena-planner-field">
            <label className="form-label" htmlFor="arena-spacing">
              {t('arenaPlanner.spacing')}
            </label>
            <select
              id="arena-spacing"
              className="form-input"
              value={spacing}
              onChange={e => setSpacing(e.target.value as ArenaSpacing)}
            >
              <option value="packed">{t('arenaPlanner.spacing_packed')}</option>
              <option value="spread">{t('arenaPlanner.spacing_spread')}</option>
            </select>
            <p className="arena-planner-hint">{t('arenaPlanner.hint_spacing')}</p>
          </div>
          <div className="arena-planner-field">
            <label className="form-label" htmlFor="arena-align">
              {t('arenaPlanner.align')}
            </label>
            <select
              id="arena-align"
              className="form-input"
              value={align}
              onChange={e => setAlign(e.target.value as ArenaAlign)}
            >
              <option value="left">{t('arenaPlanner.align_left')}</option>
              <option value="center">{t('arenaPlanner.align_center')}</option>
              <option value="right">{t('arenaPlanner.align_right')}</option>
            </select>
            <p className="arena-planner-hint">{t('arenaPlanner.hint_align')}</p>
          </div>

          <div className="arena-planner-actions">
            <Button
              type="button"
              variant="primary"
              onClick={optimize}
              disabled={!parsed}
              title={t('arenaPlanner.optimize_hint')}
            >
              {t('arenaPlanner.optimize')}
            </Button>
          </div>

          <label className="arena-planner-check">
            <input type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)} />
            {t('arenaPlanner.snap')}
          </label>
          <p className="arena-planner-hint">{t('arenaPlanner.snap_hint')}</p>

          <ArenaPlanHelp />
        </aside>

        <div className="arena-planner-main">
          {parsed && maxLayout && room ? (
            <>
              <p role="status" className="arena-planner-status">
                {maxText()}
              </p>
              {clamped && maxLayout.count > 0 ? (
                <p role="alert">
                  {t('arenaPlanner.too_many', { requested: parsed.n, max: maxLayout.count })}
                </p>
              ) : null}
              {maxLayout.count === 0 ? <p role="alert">{t('arenaPlanner.nofit')}</p> : null}

              <div
                className="arena-planner-toolbar"
                role="toolbar"
                aria-label={t('arenaPlanner.tools_hint')}
              >
                {TOOL_KINDS.map(kind => (
                  <Button key={kind} type="button" size="sm" onClick={() => addItem(kind)}>
                    {t(TOOL_LABEL_KEY[kind])}
                  </Button>
                ))}
                <Button
                  type="button"
                  size="sm"
                  onClick={() => selectedId && removeItem(selectedId)}
                  disabled={!selectedId}
                >
                  {t('arenaPlanner.remove')}
                </Button>
              </div>
              <p className="arena-planner-hint">{t('arenaPlanner.tools_hint')}</p>

              <ArenaPlanCanvas
                room={room}
                centers={centers}
                items={items}
                selectedId={selectedId}
                conflictIds={conflictIds}
                snap={snap}
                showDims={showDims}
                svgRef={svgRef}
                onSelect={setSelectedId}
                onMove={moveItem}
                onMoveArena={moveArena}
                onResize={resizeItem}
                onRotate={rotateItem}
                onDelete={removeItem}
              />
              <p className="arena-planner-hint">{t('arenaPlanner.drag_hint')}</p>
              <p className="arena-planner-hint">{t('arenaPlanner.handles_hint')}</p>

              {conflictIds.size > 0 && <p role="alert">{t('arenaPlanner.conflict')}</p>}
              {selectedAlerts.exit && <p role="alert">{t('arenaPlanner.exit_wall')}</p>}
              {selectedAlerts.blockedArena && <p role="alert">{t('arenaPlanner.blocked_arena')}</p>}
              {selectedAlerts.blockedOverlap && (
                <p role="alert">{t('arenaPlanner.blocked_overlap')}</p>
              )}

              <section className="arena-planner-inspector" aria-labelledby="arena-inspector-title">
                <h3 id="arena-inspector-title">{t('arenaPlanner.inspector_title')}</h3>
                {selectedItem ? (
                  <div className="arena-planner-fields">
                    <span>{selectedItem.label}</span>
                    <label className="form-label">
                      {t('arenaPlanner.pos_x')}
                      <input
                        className="form-input"
                        type="text"
                        inputMode="decimal"
                        value={fmt(selectedItem.x)}
                        onChange={e => editSelected('x', e.target.value)}
                      />
                    </label>
                    <label className="form-label">
                      {t('arenaPlanner.pos_y')}
                      <input
                        className="form-input"
                        type="text"
                        inputMode="decimal"
                        value={fmt(selectedItem.y)}
                        onChange={e => editSelected('y', e.target.value)}
                      />
                    </label>
                    <label className="form-label">
                      {t('arenaPlanner.size_w')}
                      <input
                        className="form-input"
                        type="text"
                        inputMode="decimal"
                        value={fmt(selectedItem.widthM)}
                        onChange={e => editSelected('w', e.target.value)}
                      />
                    </label>
                    <label className="form-label">
                      {t('arenaPlanner.rotate_label')}
                      <input
                        className="form-input"
                        type="text"
                        inputMode="decimal"
                        value={fmt(selectedItem.rotationDeg ?? 0)}
                        onChange={e => rotateSelected(e.target.value)}
                      />
                    </label>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() =>
                        rotateItem(selectedItem.id, (selectedItem.rotationDeg ?? 0) + 90)
                      }
                    >
                      {t('arenaPlanner.rotate_90')}
                    </Button>
                    <label className="form-label">
                      {t('arenaPlanner.size_h')}
                      <input
                        className="form-input"
                        type="text"
                        inputMode="decimal"
                        value={fmt(selectedItem.heightM)}
                        onChange={e => editSelected('h', e.target.value)}
                      />
                    </label>
                  </div>
                ) : (
                  <p className="arena-planner-hint">{t('arenaPlanner.inspector_none')}</p>
                )}
              </section>

              <ul className="arena-planner-legend">
                <li>{t('arenaPlanner.legend_zone')}</li>
                <li>{t('arenaPlanner.legend_safety')}</li>
                <li>{t('arenaPlanner.legend_guard')}</li>
                <li>{t('arenaPlanner.legend_roles')}</li>
              </ul>
              <p className="arena-planner-hint">{t('arenaPlanner.note')}</p>

              <label className="arena-planner-check">
                <input
                  type="checkbox"
                  checked={showDims}
                  onChange={e => setShowDims(e.target.checked)}
                />
                {t('arenaPlanner.dims_option')}
              </label>
              <p className="arena-planner-hint">{t('arenaPlanner.dims_hint')}</p>
              <div className="arena-planner-actions">
                <Button type="button" variant="primary" onClick={() => runExport('pdf')}>
                  {t('arenaPlanner.export_pdf')}
                </Button>
                <Button type="button" onClick={() => runExport('png')}>
                  {t('arenaPlanner.export_png')}
                </Button>
              </div>
              {exportError && <p role="alert">{exportError}</p>}
            </>
          ) : null}
        </div>
      </div>
    </Modal>
  );
};

export default ArenaPlannerModal;
