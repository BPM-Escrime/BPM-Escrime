/**
 * BPM - Escrime - Saisie d'heure toujours en 24 h (HH:MM).
 * Remplace <input type="time">, dont le format (AM/PM ou 24 h) suit la langue du système.
 * Valeur : "HH:MM" ou "" (non renseignée).
 * Licensed under GPL-3.0
 */
import React from 'react';
import { useTranslation } from '../../hooks/useTranslation';

interface TimeInput24Props {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  /** Style des deux listes (écrans sans classes CSS) */
  selectStyle?: React.CSSProperties;
}

const pad = (n: number) => String(n).padStart(2, '0');
const HOURS = Array.from({ length: 24 }, (_, i) => pad(i));
const MINUTES = Array.from({ length: 60 }, (_, i) => pad(i));

/** Découpe "HH:MM" ; valeur invalide → vide. */
export function splitTime(value: string): [string, string] {
  const m = /^(\d{1,2}):(\d{2})/.exec(value ?? '');
  if (!m) return ['', ''];
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return ['', ''];
  return [pad(h), pad(min)];
}

export const TimeInput24: React.FC<TimeInput24Props> = ({
  value,
  onChange,
  id,
  disabled,
  className = 'form-input form-select',
  style,
  selectStyle,
}) => {
  const { t } = useTranslation();
  const [hh, mm] = splitTime(value);

  const update = (h: string, m: string) => {
    if (!h && !m) onChange('');
    else onChange(`${h || '00'}:${m || '00'}`);
  };

  return (
    <div className="time-input-24" style={style}>
      <select
        id={id}
        className={className}
        value={hh}
        disabled={disabled}
        aria-label={t('time.hours')}
        style={selectStyle}
        onChange={e => update(e.target.value, e.target.value ? mm : '')}
      >
        <option value="">--</option>
        {HOURS.map(h => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span aria-hidden="true">:</span>
      <select
        className={className}
        value={mm}
        disabled={disabled || !hh}
        aria-label={t('time.minutes')}
        style={selectStyle}
        onChange={e => update(hh, e.target.value)}
      >
        <option value="">--</option>
        {MINUTES.map(m => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </div>
  );
};

export default TimeInput24;
