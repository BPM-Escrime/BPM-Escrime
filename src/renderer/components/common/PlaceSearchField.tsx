/**
 * BPM - Escrime - Champ « Lieu » avec recherche sur Internet (docs/adr/0026)
 * Saisie libre ; après 3 caractères et une pause, suggestions trouvées par le poste
 * (Photon / OpenStreetMap, Géoplateforme de l'IGN). Sans poste ni réseau : simple champ.
 * Licensed under GPL-3.0
 */
import React, { useEffect, useId, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import {
  normalizePlaceQuery,
  placeLabel,
  type PlaceSuggestion,
} from '@shared/domain/places/placeSearch';
import { useTranslation } from '../../hooks/useTranslation';
import { stationAvailable, useStationApi } from '../../api/stationApi';
import { logger, LogCategory, toError } from '@shared/services/logger';

const DEBOUNCE_MS = 400;

interface PlaceSearchFieldProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  /** Suggestion choisie ; le champ prend déjà « nom, commune » */
  onPick?: (place: PlaceSuggestion) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
}

export const PlaceSearchField: React.FC<PlaceSearchFieldProps> = ({
  id,
  value,
  onChange,
  onPick,
  className,
  placeholder,
  disabled,
  ariaLabel,
}) => {
  const { t, language } = useTranslation();
  const station = useStationApi();
  const listId = useId();
  const [items, setItems] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState<'idle' | 'loading' | 'empty' | 'offline'>('idle');
  // Recherche lancée par la frappe seulement (pas à l'ouverture ni après un choix)
  const typed = useRef(false);
  const seq = useRef(0);
  const enabled = stationAvailable();

  useEffect(() => {
    if (!enabled || !typed.current) return;
    const q = normalizePlaceQuery(value);
    if (!q) return;
    const n = ++seq.current;
    const timer = setTimeout(() => {
      setStatus('loading');
      station.settings
        .searchPlaces(q, language)
        .then(r => {
          if (n !== seq.current) return;
          setItems(r.suggestions);
          setActive(-1);
          setStatus(r.unavailable ? 'offline' : r.suggestions.length ? 'idle' : 'empty');
        })
        .catch((e: unknown) => {
          if (n !== seq.current) return;
          logger.warn(LogCategory.SYSTEM, 'Recherche de lieu impossible', toError(e));
          setItems([]);
          setStatus('offline');
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, language, enabled, station]);

  const pick = (p: PlaceSuggestion) => {
    typed.current = false;
    seq.current++;
    onChange(placeLabel(p));
    onPick?.(p);
    setOpen(false);
    setItems([]);
    setStatus('idle');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || items.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(a => (a + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(a => (a <= 0 ? items.length - 1 : a - 1));
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      pick(items[active]);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      setOpen(false);
    }
  };

  const showList = open && enabled && (items.length > 0 || status !== 'idle');

  return (
    <div className="place-search">
      <input
        id={id}
        type="text"
        className={className}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        role={enabled ? 'combobox' : undefined}
        aria-autocomplete={enabled ? 'list' : undefined}
        aria-expanded={enabled ? showList : undefined}
        aria-controls={enabled ? listId : undefined}
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        onChange={e => {
          typed.current = true;
          setOpen(true);
          if (!normalizePlaceQuery(e.target.value)) {
            seq.current++;
            setItems([]);
            setStatus('idle');
          }
          onChange(e.target.value);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => setOpen(true)}
        // Laisse le clic sur une suggestion aboutir avant de fermer
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {showList && (
        <ul id={listId} className="place-search-list" role="listbox">
          {items.map((p, i) => (
            <li
              key={`${p.name}-${p.lat}-${p.lon}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'is-active' : ''}
              onMouseDown={e => e.preventDefault()}
              onClick={() => pick(p)}
            >
              <MapPin size={14} aria-hidden />
              <span className="place-search-text">
                <strong>{p.name}</strong>
                {p.address && <small>{p.address}</small>}
              </span>
            </li>
          ))}
          {items.length === 0 && status !== 'idle' && (
            <li className="place-search-status" role="presentation">
              {t(`placeSearch.${status}`)}
            </li>
          )}
          {items.length > 0 && (
            <li className="place-search-credit" role="presentation">
              {t('placeSearch.credit')}
            </li>
          )}
        </ul>
      )}
    </div>
  );
};

export default PlaceSearchField;
