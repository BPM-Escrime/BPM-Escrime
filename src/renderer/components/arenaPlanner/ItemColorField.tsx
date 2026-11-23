/**
 * BPM - Escrime - Couleur d'un élément du plan (zone, table…) : choix libre ou couleur par défaut
 * Licensed under GPL-3.0
 */

import React from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { Button } from '../common/Button';
import { defaultItemColor } from './ArenaPlanCanvas';
import type { RoomItem } from '@shared/domain/arena/arenaPlanner';

/** Élément avec la couleur choisie ; undefined retire la couleur (retour au défaut) */
export const withColor = (item: RoomItem, color?: string): RoomItem => {
  const { color: _previous, ...rest } = item;
  return color ? { ...rest, color } : rest;
};

export interface ItemColorFieldProps {
  item: RoomItem;
  /** undefined = revenir à la couleur du type ou de la zone */
  onChange: (color: string | undefined) => void;
}

export const ItemColorField: React.FC<ItemColorFieldProps> = ({ item, onChange }) => {
  const { t } = useTranslation();
  return (
    <div className="arena-planner-color-field">
      <label className="form-label">
        {t('arenaPlanner.item_color')}
        <input
          className="arena-planner-color-input"
          type="color"
          value={item.color ?? defaultItemColor(item)}
          onChange={e => onChange(e.target.value)}
        />
      </label>
      <Button type="button" size="sm" onClick={() => onChange(undefined)} disabled={!item.color}>
        {t('arenaPlanner.item_color_reset')}
      </Button>
    </div>
  );
};
