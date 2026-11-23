/**
 * BPM - Escrime - Feuille de route : sections (tableau ou texte), lignes,
 * ordre (flèches ou glisser-déposer par la poignée), bibliothèque de lignes et de sections toutes prêtes.
 * Licensed under GPL-3.0
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  GripVertical,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  moveItem,
  nextId,
  rowIds,
  type RoadmapRow,
  type RoadmapSection,
} from '@shared/domain/roadmap/roadmap';
import {
  SUGGESTED_ROWS,
  SUGGESTED_SECTIONS,
  sectionFromSeed,
} from '@shared/domain/roadmap/presets';
import { useTranslation } from '../../hooks/useTranslation';
import { useConfirm } from '../ConfirmDialog';
import { Button } from '../common/Button';
import { TextField } from './roadmapFields';

interface RoadmapSectionsEditorProps {
  sections: RoadmapSection[];
  onChange: (sections: RoadmapSection[]) => void;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  /** Section à faire défiler jusqu'à l'écran (clic dans l'aperçu) */
  focusId: string | null;
}

const IconButton: React.FC<{
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}> = ({ label, onClick, disabled, children }) => (
  <Button
    type="button"
    size="sm"
    variant="ghost"
    className="roadmap-icon-btn"
    title={label}
    aria-label={label}
    disabled={disabled}
    onClick={onClick}
  >
    {children}
  </Button>
);

export const RoadmapSectionsEditor: React.FC<RoadmapSectionsEditorProps> = ({
  sections,
  onChange,
  expanded,
  onToggle,
  focusId,
}) => {
  const { t } = useTranslation();
  const { confirm } = useConfirm();
  const refs = useRef(new Map<string, HTMLDivElement>());
  // Glisser-déposer : section saisie par la poignée, section survolée
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const endDrag = () => {
    setDragId(null);
    setOverId(null);
  };
  const dropOn = (targetId: string) => {
    if (dragId && dragId !== targetId) {
      const from = sections.findIndex(x => x.id === dragId);
      const to = sections.findIndex(x => x.id === targetId);
      if (from >= 0 && to >= 0) onChange(moveItem(sections, dragId, to - from));
    }
    endDrag();
  };

  useEffect(() => {
    if (focusId) refs.current.get(focusId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focusId]);

  const patch = (id: string, p: Partial<RoadmapSection>) =>
    onChange(sections.map(s => (s.id === id ? { ...s, ...p } : s)));
  const patchRows = (id: string, fn: (rows: RoadmapRow[]) => RoadmapRow[]) =>
    onChange(sections.map(s => (s.id === id ? { ...s, rows: fn(s.rows) } : s)));
  const newRowId = () => nextId('row', rowIds(sections));

  const addRow = (id: string, label = '', value = '') =>
    patchRows(id, rows => [...rows, { id: newRowId(), label, value }]);

  const addSection = (seedIndex: number | null) => {
    const sectionId = nextId(
      'sec',
      sections.map(s => s.id)
    );
    const used = rowIds(sections);
    const nextRow = () => {
      const id = nextId('row', used);
      used.push(id);
      return id;
    };
    const section =
      seedIndex === null
        ? sectionFromSeed(
            { title: t('roadmap.new_section_title'), layout: 'table', rows: [['', '']] },
            sectionId,
            nextRow
          )
        : sectionFromSeed(SUGGESTED_SECTIONS[seedIndex], sectionId, nextRow);
    onChange([...sections, section]);
    if (!expanded.has(sectionId)) onToggle(sectionId);
  };

  const removeSection = async (s: RoadmapSection) => {
    const ok = await confirm({
      message: t('roadmap.delete_section_confirm', { title: s.title }),
      confirmLabel: t('actions.delete'),
    });
    if (ok) onChange(sections.filter(x => x.id !== s.id));
  };

  return (
    <div className="roadmap-sections">
      <p className="roadmap-muted">{t('roadmap.text_hint')}</p>
      {sections.map((s, si) => {
        const open = expanded.has(s.id);
        return (
          <div
            key={s.id}
            ref={el => {
              if (el) refs.current.set(s.id, el);
              else refs.current.delete(s.id);
            }}
            className={`roadmap-section-card${s.enabled ? '' : ' is-disabled'}${focusId === s.id ? ' is-focused' : ''}${dragId === s.id ? ' is-dragging' : ''}${overId === s.id && dragId !== s.id ? ' is-drop-target' : ''}`}
            onDragOver={e => {
              if (!dragId) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (overId !== s.id) setOverId(s.id);
            }}
            onDrop={e => {
              e.preventDefault();
              dropOn(s.id);
            }}
          >
            <div className="roadmap-section-head">
              <span
                className="roadmap-drag-handle"
                draggable
                role="img"
                title={t('roadmap.drag_section')}
                aria-label={t('roadmap.drag_section')}
                onDragStart={e => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', s.id);
                  const card = refs.current.get(s.id);
                  if (card) e.dataTransfer.setDragImage(card, 16, 16);
                  setDragId(s.id);
                }}
                onDragEnd={endDrag}
              >
                <GripVertical size={15} />
              </span>
              <IconButton
                label={open ? t('roadmap.collapse') : t('roadmap.expand')}
                onClick={() => onToggle(s.id)}
              >
                {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              </IconButton>
              <input
                type="checkbox"
                checked={s.enabled}
                title={t('roadmap.section_enabled')}
                aria-label={t('roadmap.section_enabled')}
                onChange={e => patch(s.id, { enabled: e.target.checked })}
              />
              <TextField
                ariaLabel={t('roadmap.section_title')}
                className="roadmap-grow"
                value={s.title}
                onChange={v => patch(s.id, { title: v })}
              />
              <IconButton
                label={t('roadmap.move_up')}
                disabled={si === 0}
                onClick={() => onChange(moveItem(sections, s.id, -1))}
              >
                <ArrowUp size={14} />
              </IconButton>
              <IconButton
                label={t('roadmap.move_down')}
                disabled={si === sections.length - 1}
                onClick={() => onChange(moveItem(sections, s.id, 1))}
              >
                <ArrowDown size={14} />
              </IconButton>
              <IconButton label={t('roadmap.delete_section')} onClick={() => void removeSection(s)}>
                <Trash2 size={14} />
              </IconButton>
            </div>
            {open && (
              <div className="roadmap-section-body">
                <div className="roadmap-segmented" role="group" aria-label={t('roadmap.layout')}>
                  {(['table', 'text'] as const).map(layout => (
                    <button
                      key={layout}
                      type="button"
                      className={s.layout === layout ? 'is-active' : ''}
                      aria-pressed={s.layout === layout}
                      onClick={() => patch(s.id, { layout })}
                    >
                      {t(`roadmap.layout_${layout}`)}
                    </button>
                  ))}
                </div>
                {s.layout === 'text' ? (
                  <TextField
                    ariaLabel={t('roadmap.row_value')}
                    multiline
                    rows={4}
                    value={s.text}
                    onChange={v => patch(s.id, { text: v })}
                  />
                ) : (
                  <>
                    {s.rows.map((r, ri) => (
                      <div key={r.id} className="roadmap-row">
                        <TextField
                          ariaLabel={t('roadmap.row_label')}
                          placeholder={t('roadmap.row_label')}
                          className="roadmap-row-label"
                          value={r.label}
                          onChange={v =>
                            patchRows(s.id, rows =>
                              rows.map(x => (x.id === r.id ? { ...x, label: v } : x))
                            )
                          }
                        />
                        <TextField
                          ariaLabel={t('roadmap.row_value')}
                          placeholder={t('roadmap.row_value')}
                          multiline
                          rows={1}
                          value={r.value}
                          onChange={v =>
                            patchRows(s.id, rows =>
                              rows.map(x => (x.id === r.id ? { ...x, value: v } : x))
                            )
                          }
                        />
                        <div className="roadmap-row-tools">
                          <IconButton
                            label={t('roadmap.move_up')}
                            disabled={ri === 0}
                            onClick={() => patchRows(s.id, rows => moveItem(rows, r.id, -1))}
                          >
                            <ArrowUp size={13} />
                          </IconButton>
                          <IconButton
                            label={t('roadmap.move_down')}
                            disabled={ri === s.rows.length - 1}
                            onClick={() => patchRows(s.id, rows => moveItem(rows, r.id, 1))}
                          >
                            <ArrowDown size={13} />
                          </IconButton>
                          <IconButton
                            label={t('roadmap.delete_row')}
                            onClick={() => patchRows(s.id, rows => rows.filter(x => x.id !== r.id))}
                          >
                            <Trash2 size={13} />
                          </IconButton>
                        </div>
                      </div>
                    ))}
                    <div className="roadmap-inline">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => addRow(s.id)}
                      >
                        <Plus size={14} /> {t('roadmap.add_row')}
                      </Button>
                      <select
                        className="roadmap-input roadmap-select"
                        value=""
                        aria-label={t('roadmap.add_suggested_row')}
                        onChange={e => {
                          const seed = SUGGESTED_ROWS[Number(e.target.value)];
                          if (seed) addRow(s.id, seed[0], seed[1]);
                        }}
                      >
                        <option value="">{t('roadmap.add_suggested_row')}</option>
                        {SUGGESTED_ROWS.map(([label], i) => (
                          <option key={i} value={i}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
      <div className="roadmap-inline roadmap-add-section">
        <Button type="button" size="sm" variant="secondary" onClick={() => addSection(null)}>
          <Plus size={14} /> {t('roadmap.add_section')}
        </Button>
        <select
          className="roadmap-input roadmap-select"
          value=""
          aria-label={t('roadmap.add_suggested_section')}
          onChange={e => {
            if (e.target.value !== '') addSection(Number(e.target.value));
          }}
        >
          <option value="">{t('roadmap.add_suggested_section')}</option>
          {SUGGESTED_SECTIONS.map((seed, i) => (
            <option key={i} value={i}>
              {seed.title}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};
