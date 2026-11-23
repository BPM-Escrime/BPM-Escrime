/**
 * BPM - Escrime - Inspecteur de l'élément sélectionné du planificateur d'arène (#2075)
 * Texte, couleur, position, taille et rotation de l'élément.
 * Licensed under GPL-3.0
 */

import React from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { Button } from '../common/Button';
import type { RoomItem } from '@shared/domain/arena/arenaPlanner';
import { ItemColorField } from './ItemColorField';

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

export interface ItemInspectorProps {
  item: RoomItem | null;
  onLabel: (value: string) => void;
  onColor: (color?: string) => void;
  onField: (field: 'x' | 'y' | 'w' | 'h', raw: string) => void;
  onRotate: (raw: string) => void;
  onRotate90: () => void;
}

export const ItemInspector: React.FC<ItemInspectorProps> = ({
  item,
  onLabel,
  onColor,
  onField,
  onRotate,
  onRotate90,
}) => {
  const { t } = useTranslation();
  return (
    <section className="arena-planner-inspector" aria-labelledby="arena-inspector-title">
      <h3 id="arena-inspector-title">{t('arenaPlanner.inspector_title')}</h3>
      {item ? (
        <div className="arena-planner-fields">
          <label className="form-label arena-planner-text-field">
            {t('arenaPlanner.item_text')}
            <textarea
              className="form-input"
              rows={2}
              value={item.label}
              onChange={e => onLabel(e.target.value)}
            />
          </label>
          <ItemColorField item={item} onChange={onColor} />
          <label className="form-label">
            {t('arenaPlanner.pos_x')}
            <input
              className="form-input"
              type="text"
              inputMode="decimal"
              value={fmt(item.x)}
              onChange={e => onField('x', e.target.value)}
            />
          </label>
          <label className="form-label">
            {t('arenaPlanner.pos_y')}
            <input
              className="form-input"
              type="text"
              inputMode="decimal"
              value={fmt(item.y)}
              onChange={e => onField('y', e.target.value)}
            />
          </label>
          <label className="form-label">
            {t('arenaPlanner.size_w')}
            <input
              className="form-input"
              type="text"
              inputMode="decimal"
              value={fmt(item.widthM)}
              onChange={e => onField('w', e.target.value)}
            />
          </label>
          <label className="form-label">
            {t('arenaPlanner.rotate_label')}
            <input
              className="form-input"
              type="text"
              inputMode="decimal"
              value={fmt(item.rotationDeg ?? 0)}
              onChange={e => onRotate(e.target.value)}
            />
          </label>
          <Button type="button" size="sm" onClick={onRotate90}>
            {t('arenaPlanner.rotate_90')}
          </Button>
          <label className="form-label">
            {t('arenaPlanner.size_h')}
            <input
              className="form-input"
              type="text"
              inputMode="decimal"
              value={fmt(item.heightM)}
              onChange={e => onField('h', e.target.value)}
            />
          </label>
        </div>
      ) : (
        <p className="arena-planner-hint">{t('arenaPlanner.inspector_none')}</p>
      )}
    </section>
  );
};
