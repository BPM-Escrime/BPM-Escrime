/**
 * BPM - Escrime - Planificateur de placement d'arène Sabre Laser (#2075)
 * Outil à côté du QR Wi-Fi et de la télécommande TV : dimensions de la salle,
 * arènes (grille automatique ou maximum trouvé par « Optimiser »), tables,
 * prises, accessoires, issues de secours et zones bloquées à placer à la souris,
 * texte libre sur chaque élément, zoom, plusieurs salles déplaçables à la
 * souris sur une vue d'ensemble, export PDF et PNG. La géométrie vient de
 * shared/domain/arena.
 * Licensed under GPL-3.0
 */

import React, { useMemo, useRef, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import Modal from './common/Modal';
import { Button } from './common/Button';
import { logger, LogCategory } from '@shared/services/logger';
import {
  checkRoomItems,
  createEquipmentItem,
  createRoomItem,
  moveArenaWithPush,
  moveRoomItem,
  placeOnFreeSpot,
  resizeRoomItemAroundCenter,
  rotateRoomItem,
  resizeRoomItem,
  ROOM_EQUIPMENT,
  ROOM_ZONES,
  type ArenaAlign,
  type ArenaSpacing,
  type RoomItem,
} from '@shared/domain/arena/arenaPlanner';
import { ArenaPlanCanvas, KIND_LABEL_KEY } from './arenaPlanner/ArenaPlanCanvas';
import { ArenaPlanHelp } from './arenaPlanner/ArenaPlanHelp';
import { AddItemMenus, KIND_OPTION_PREFIX } from './arenaPlanner/AddItemMenus';
import { ArenaNamesFields } from './arenaPlanner/ArenaNamesFields';
import { withColor } from './arenaPlanner/ItemColorField';
import { ItemInspector } from './arenaPlanner/ItemInspector';
import { DisciplineField, disciplineKey } from './arenaPlanner/DisciplineField';
import { arenaFootprint } from '@shared/domain/arena/arenaDisciplines';
import { SitePlanCanvas, type SiteRoom } from './arenaPlanner/SitePlanCanvas';
import {
  computeRoomLayout,
  newRoomPlan,
  nextRoomPosition,
  parseNumber,
  roomDimsKey,
  type RoomPlan,
} from './arenaPlanner/roomPlans';
import {
  ArenaPlanLegendControls,
  buildLegendEntries,
  useLegendOptions,
} from './arenaPlanner/planLegend';
import { maxIdSuffix, useArenaPlanPersistence } from './arenaPlanner/useArenaPlanPersistence';

interface ArenaPlannerModalProps {
  onClose: () => void;
  /** Épreuve ouverte : plan chargé et enregistré sur elle (docs/adr/0025) */
  competitionId?: string | null;
}

type ItemKind = RoomItem['kind'];

type Updater<T> = T | ((prev: T) => T);

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

export const ArenaPlannerModal: React.FC<ArenaPlannerModalProps> = ({ onClose, competitionId }) => {
  const { t } = useTranslation();
  const [rooms, setRooms] = useState<RoomPlan[]>(() => [
    newRoomPlan('room-1', `${t('arenaPlanner.room_default')} 1`),
  ]);
  const [activeId, setActiveId] = useState('room-1');
  const roomCounter = useRef(1);
  const plan = rooms.find(r => r.id === activeId) ?? rooms[0];
  /** Modifie un champ de la salle active (valeur ou fonction de la valeur précédente). */
  const setField =
    <K extends keyof RoomPlan>(key: K) =>
    (value: Updater<RoomPlan[K]>) =>
      setRooms(prev =>
        prev.map(r =>
          r.id === plan.id
            ? {
                ...r,
                [key]:
                  typeof value === 'function'
                    ? (value as (p: RoomPlan[K]) => RoomPlan[K])(r[key])
                    : value,
              }
            : r
        )
      );
  const { width, length, arenas, margin, spacing, align, items } = plan;
  const setWidth = setField('width');
  const setLength = setField('length');
  const setArenas = setField('arenas');
  const setMargin = setField('margin');
  const setSpacing = setField('spacing');
  const setAlign = setField('align');
  const setItems = setField('items');
  const setManual = setField('manual');
  const setRoomName = setField('name');
  const discipline = plan.discipline ?? 'laser';
  const fp = useMemo(() => arenaFootprint(discipline), [discipline]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snap, setSnap] = useState(true);
  const [showDims, setShowDims] = useState(false);
  const legendOptions = useLegendOptions();
  /** Vue d'ensemble : toutes les salles, déplaçables à la souris */
  const [overview, setOverview] = useState(false);
  /** Les positions glissées ne valent que pour les dimensions et le nombre d'arènes qui les ont produites */
  const dimsKey = roomDimsKey(plan);
  const [exportError, setExportError] = useState('');
  const svgRef = useRef<SVGSVGElement>(null);
  const idCounter = useRef(0);

  useArenaPlanPersistence({
    competitionId,
    rooms,
    activeId,
    onLoad: saved => {
      setRooms(saved.rooms);
      const active = saved.rooms.find(r => r.id === saved.activeRoomId) ?? saved.rooms[0];
      setActiveId(active.id);
      setSelectedId(null);
      roomCounter.current = Math.max(
        saved.rooms.length,
        maxIdSuffix(
          saved.rooms.map(r => r.id),
          'room'
        )
      );
      idCounter.current = maxIdSuffix(
        saved.rooms.flatMap(r => r.items.map(i => i.id)),
        'item'
      );
    },
  });

  const layout = useMemo(() => computeRoomLayout(plan), [plan]);
  const parsed = layout?.parsed ?? null;
  const room = layout?.room ?? null;
  const maxLayout = layout?.maxLayout ?? null;
  const clamped = layout?.clamped ?? false;
  const centers = useMemo(() => layout?.centers ?? [], [layout]);

  /** Salles de la vue d'ensemble (calculées seulement quand elle est affichée). */
  const siteRooms = useMemo<SiteRoom[]>(() => {
    if (!overview) return [];
    return rooms.flatMap(r => {
      const l = r.id === plan.id ? layout : computeRoomLayout(r);
      if (!l) return [];
      return [
        {
          id: r.id,
          name: r.name || t('arenaPlanner.room_default'),
          x: r.x,
          y: r.y,
          widthM: l.room.widthM,
          lengthM: l.room.lengthM,
          centers: l.centers,
          items: r.items,
          discipline: r.discipline,
        },
      ];
    });
  }, [overview, rooms, plan.id, layout, t]);

  const moveRoom = (id: string, x: number, y: number) =>
    setRooms(prev => prev.map(r => (r.id === id ? { ...r, x, y } : r)));

  const openRoom = (id: string) => {
    selectRoom(id);
    setOverview(false);
  };

  const issues = useMemo(() => {
    if (!room) return [];
    return checkRoomItems(room, centers, items, fp);
  }, [room, centers, items, fp]);
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

  /** Nom d'une arène de la salle active, affiché sur le plan */
  const setArenaName = (index: number, name: string) =>
    setField('arenaNames')(prev => {
      const next = [...(prev ?? [])];
      next[index] = name;
      return Array.from(next, n => n ?? '');
    });

  /** Menus « Équipement » / « Zone » : élément de base (table, zone bloquée…) ou du catalogue */
  const addFromMenu = (value: string, zone = false) => {
    if (value.startsWith(KIND_OPTION_PREFIX))
      return addItem(value.slice(KIND_OPTION_PREFIX.length) as ItemKind);
    const equipment = (zone ? ROOM_ZONES : ROOM_EQUIPMENT).find(e => e.id === value);
    if (!room || !equipment) return;
    idCounter.current += 1;
    const id = `item-${idCounter.current}`;
    const name = t(`arenaPlanner.${zone ? 'zone' : 'equipment'}_${equipment.id}`);
    const count = items.filter(i => i.label === name || i.label.startsWith(`${name} `)).length;
    const label = count ? `${name} ${count + 1}` : name;
    const item = placeOnFreeSpot(
      createEquipmentItem(equipment, id, label, room),
      items,
      room,
      centers,
      0.5,
      fp
    );
    setItems(prev => [...prev, item]);
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

  const addRoom = () => {
    roomCounter.current += 1;
    const id = `room-${roomCounter.current}`;
    setRooms(prev => {
      const pos = nextRoomPosition(prev);
      return [
        ...prev,
        newRoomPlan(id, `${t('arenaPlanner.room_default')} ${prev.length + 1}`, pos.x, pos.y),
      ];
    });
    setActiveId(id);
    setSelectedId(null);
  };

  const removeRoom = () => {
    if (rooms.length < 2) return;
    const index = rooms.findIndex(r => r.id === plan.id);
    const rest = rooms.filter(r => r.id !== plan.id);
    setRooms(rest);
    setActiveId(rest[Math.max(0, index - 1)].id);
    setSelectedId(null);
  };

  const selectRoom = (id: string) => {
    setActiveId(id);
    setSelectedId(null);
  };

  /** Texte affiché sur l'élément (table, zone…) ; retours à la ligne permis. */
  const editLabel = (value: string) => {
    if (!selectedItem) return;
    setItems(prev => prev.map(i => (i.id === selectedItem.id ? { ...i, label: value } : i)));
  };

  /** Couleur de l'élément sélectionné ; undefined = couleur par défaut */
  const setItemColor = (color?: string) =>
    selectedItem &&
    setItems(prev => prev.map(i => (i.id === selectedItem.id ? withColor(i, color) : i)));

  const removeItem = (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
    setSelectedId(current => (current === id ? null : current));
  };

  /** Glisser une arène : les arènes voisines et les éléments qui touchent son cercle sont repoussés. */
  const moveArena = (index: number, x: number, y: number) => {
    if (!room || !parsed) return;
    const result = moveArenaWithPush(centers, index, { x, y }, room, parsed.m, items, fp);
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

  /** Légende de la vue affichée : salle active, ou toutes les salles en vue d'ensemble */
  const legendEntries = overview
    ? buildLegendEntries(
        siteRooms.flatMap(r => r.items),
        t,
        siteRooms.map(r => r.discipline ?? 'laser')
      )
    : buildLegendEntries(items, t, [discipline]);
  const legend = () => (legendOptions.inPdf ? legendEntries : null);

  const legendControls = <ArenaPlanLegendControls entries={legendEntries} {...legendOptions} />;

  /** Texte de l'export de la vue d'ensemble : une ligne par salle. */
  const siteExportText = () => ({
    title: `${t('arenaPlanner.title')} — ${t('arenaPlanner.overview')}`,
    summary: siteRooms.map(r =>
      t('arenaPlanner.overview_room_line', {
        name: r.name,
        width: fmt(r.widthM),
        length: fmt(r.lengthM),
        count: r.centers.length,
      })
    ),
    legendTitle: t('arenaPlanner.legend_title'),
    legend: legend(),
    itemsTitle: t('arenaPlanner.items_title'),
    items: siteRooms.flatMap(r =>
      r.items.map(i => `${r.name} — ${i.label.replace(/\n/g, ' ') || t(KIND_LABEL_KEY[i.kind])}`)
    ),
    note: t(disciplineKey('note', discipline)),
  });

  const exportText = () => {
    if (overview) return siteExportText();
    if (!parsed || !maxLayout || !room) return null;
    return {
      title: `${t('arenaPlanner.title')} — ${plan.name}`,
      summary: [
        t('arenaPlanner.summary_room', { width: fmt(parsed.w), length: fmt(parsed.l) }),
        t('arenaPlanner.summary_arenas_max', { count: centers.length, max: maxLayout.count }),
        maxText(),
      ],
      legendTitle: t('arenaPlanner.legend_title'),
      legend: legend(),
      itemsTitle: t('arenaPlanner.items_title'),
      items: items.map(i =>
        t('arenaPlanner.item_line', {
          label: i.label.replace(/\n/g, ' ') || t(KIND_LABEL_KEY[i.kind]),
          x: fmt(i.x),
          y: fmt(i.y),
          width: fmt(i.widthM),
          height: fmt(i.heightM),
        })
      ),
      note: t(disciplineKey('note', discipline)),
    };
  };

  const runExport = async (kind: 'pdf' | 'png') => {
    const text = exportText();
    if (!svgRef.current || !text) return;
    setExportError('');
    // Nom de fichier : salle active, caractères sûrs seulement
    const slug = plan.name
      .normalize('NFD')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
    const base = overview
      ? 'plan-salles'
      : rooms.length > 1 && slug
        ? `plan-arenes-${slug}`
        : 'plan-arenes';
    try {
      const exporter = await import('./arenaPlanner/arenaPlanExport');
      if (kind === 'pdf') {
        await exporter.exportArenaPlanPdf(svgRef.current, text, `${base}.pdf`);
      } else {
        await exporter.exportArenaPlanPng(svgRef.current, `${base}.png`);
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
      <p className="arena-planner-lead">{t(disciplineKey('hint', discipline))}</p>

      <div className="arena-planner-rooms" role="group" aria-label={t('arenaPlanner.rooms_title')}>
        <span className="form-label">{t('arenaPlanner.rooms_title')}</span>
        {rooms.map(r => (
          <Button
            key={r.id}
            type="button"
            size="sm"
            variant={r.id === plan.id ? 'primary' : 'secondary'}
            aria-pressed={r.id === plan.id}
            onClick={() => selectRoom(r.id)}
          >
            {r.name || t('arenaPlanner.room_default')}
          </Button>
        ))}
        <Button type="button" size="sm" onClick={addRoom}>
          {t('arenaPlanner.add_room')}
        </Button>
        <Button type="button" size="sm" onClick={removeRoom} disabled={rooms.length < 2}>
          {t('arenaPlanner.remove_room')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={overview ? 'primary' : 'secondary'}
          aria-pressed={overview}
          onClick={() => {
            setOverview(v => !v);
            setSelectedId(null);
          }}
        >
          {t('arenaPlanner.overview')}
        </Button>
      </div>

      {!parsed || !maxLayout || !room ? <p role="alert">{t('arenaPlanner.invalid')}</p> : null}

      <div className="arena-planner-layout">
        <aside className="arena-planner-sidebar" aria-label={t('arenaPlanner.title')}>
          <details className="arena-planner-props" open>
            <summary className="arena-planner-props-summary">
              <span className="arena-planner-props-title">{t('arenaPlanner.props_title')}</span>
              <span className="arena-planner-props-chip">
                {parsed
                  ? t('arenaPlanner.props_summary', {
                      width: fmt(parsed.w),
                      length: fmt(parsed.l),
                      count: layout?.arenaCount ?? 0,
                    })
                  : t('arenaPlanner.invalid')}
              </span>
            </summary>
            <div className="arena-planner-props-body">
              <div className="arena-planner-field">
                <label className="form-label" htmlFor="arena-room-name">
                  {t('arenaPlanner.room_name')}
                </label>
                <input
                  id="arena-room-name"
                  className="form-input"
                  type="text"
                  value={plan.name}
                  onChange={e => setRoomName(e.target.value)}
                />
              </div>
              <fieldset className="arena-planner-group">
                <legend>{t('arenaPlanner.group_dimensions')}</legend>
                <div className="arena-planner-row">
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
                  </div>
                </div>
                <p className="arena-planner-hint arena-planner-row-hint">
                  {t('arenaPlanner.hint_width')}
                </p>
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
              </fieldset>
              <fieldset className="arena-planner-group">
                <legend>{t('arenaPlanner.group_arenas')}</legend>
                <DisciplineField value={discipline} onChange={setField('discipline')} />
                <div className="arena-planner-field">
                  <label className="form-label" htmlFor="arena-count">
                    {t(disciplineKey('arenas', discipline))}
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
                <ArenaNamesFields
                  count={centers.length}
                  names={plan.arenaNames ?? []}
                  onChange={setArenaName}
                />
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
              </fieldset>
            </div>
          </details>

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
          {overview ? (
            <>
              <p className="arena-planner-hint">{t('arenaPlanner.overview_hint')}</p>
              <SitePlanCanvas
                rooms={siteRooms}
                activeId={plan.id}
                snap={snap}
                svgRef={svgRef}
                onSelect={selectRoom}
                onMove={moveRoom}
                onOpen={openRoom}
              />
              {legendControls}
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
          ) : parsed && maxLayout && room ? (
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
                <AddItemMenus disabled={!room} onPick={addFromMenu} />
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
                key={plan.id}
                room={room}
                discipline={discipline}
                centers={centers}
                arenaNames={plan.arenaNames}
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

              <ItemInspector
                item={selectedItem}
                onLabel={editLabel}
                onColor={setItemColor}
                onField={editSelected}
                onRotate={rotateSelected}
                onRotate90={() =>
                  selectedItem && rotateItem(selectedItem.id, (selectedItem.rotationDeg ?? 0) + 90)
                }
              />

              {legendControls}
              <p className="arena-planner-hint">{t(disciplineKey('note', discipline))}</p>

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
