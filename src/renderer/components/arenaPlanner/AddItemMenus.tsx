/**
 * BPM - Escrime - Menus d'ajout du planificateur d'arène : « Équipement » (table, prise,
 * accessoire, issue de secours puis catalogue) et « Zone » (bloquée, combattants, public, DT)
 * Licensed under GPL-3.0
 */

import React from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { KIND_LABEL_KEY } from './ArenaPlanCanvas';
import { ROOM_EQUIPMENT, ROOM_ZONES, type RoomItem } from '@shared/domain/arena/arenaPlanner';

/** Valeur d'option désignant un élément de base (et non un équipement du catalogue) */
export const KIND_OPTION_PREFIX = 'kind:';

const EQUIPMENT_KINDS: RoomItem['kind'][] = ['table', 'outlet', 'accessory', 'exit'];

export interface AddItemMenusProps {
  disabled: boolean;
  /** Valeur choisie : `kind:<type>` ou identifiant du catalogue ; zone = menu « Zone » */
  onPick: (value: string, zone: boolean) => void;
}

export const AddItemMenus: React.FC<AddItemMenusProps> = ({ disabled, onPick }) => {
  const { t } = useTranslation();
  return (
    <>
      <select
        className="form-input arena-planner-equipment"
        aria-label={t('arenaPlanner.add_equipment')}
        value=""
        disabled={disabled}
        onChange={e => onPick(e.target.value, false)}
      >
        <option value="">{t('arenaPlanner.add_equipment')}</option>
        {EQUIPMENT_KINDS.map(kind => (
          <option key={kind} value={`${KIND_OPTION_PREFIX}${kind}`}>
            {t(KIND_LABEL_KEY[kind])}
          </option>
        ))}
        {ROOM_EQUIPMENT.map(e => (
          <option key={e.id} value={e.id}>
            {t(`arenaPlanner.equipment_${e.id}`)}
          </option>
        ))}
      </select>
      <select
        className="form-input arena-planner-equipment"
        aria-label={t('arenaPlanner.add_zone')}
        value=""
        disabled={disabled}
        onChange={e => onPick(e.target.value, true)}
      >
        <option value="">{t('arenaPlanner.add_zone')}</option>
        <option value={`${KIND_OPTION_PREFIX}blocked`}>{t(KIND_LABEL_KEY.blocked)}</option>
        {ROOM_ZONES.map(z => (
          <option key={z.id} value={z.id}>
            {t(`arenaPlanner.zone_${z.id}`)}
          </option>
        ))}
      </select>
    </>
  );
};
