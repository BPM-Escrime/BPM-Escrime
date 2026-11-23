/**
 * BPM - Escrime - Saisie d'heure au format choisi dans les réglages : 24 h ou AM/PM.
 * Remplace <input type="time">, dont le format suit la langue du système.
 * Valeur toujours "HH:MM" (24 h) ou "" (non renseignée).
 * Licensed under GPL-3.0
 */
import React from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { useTimeFormat } from '../../services/timeFormat';

interface TimeInputProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  /** Style des listes (écrans sans classes CSS) */
  selectStyle?: React.CSSProperties;
}

type Period = 'AM' | 'PM';

const pad = (n: number) => String(n).padStart(2, '0');
const HOURS_24 = Array.from({ length: 24 }, (_, i) => pad(i));
const HOURS_12 = Array.from({ length: 12 }, (_, i) => pad(i === 0 ? 12 : i));
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

/** "13" → ["01", "PM"] ; "00" → ["12", "AM"] */
export function to12h(hh: string): [string, Period] {
  const h = Number(hh);
  return [pad(h % 12 === 0 ? 12 : h % 12), h < 12 ? 'AM' : 'PM'];
}

/** ["12", "AM"] → "00" ; ["01", "PM"] → "13" */
export function from12h(h12: string, period: Period): string {
  const h = Number(h12) % 12;
  return pad(period === 'PM' ? h + 12 : h);
}

export const TimeInput: React.FC<TimeInputProps> = ({
  value,
  onChange,
  id,
  disabled,
  className = 'form-input form-select',
  style,
  selectStyle,
}) => {
  const { t } = useTranslation();
  const format = useTimeFormat();
  const [hh, mm] = splitTime(value);
  const [h12, period] = hh ? to12h(hh) : ['', 'AM' as Period];

  const update = (h: string, m: string) => {
    if (!h) onChange('');
    else onChange(`${h}:${m || '00'}`);
  };

  return (
    <div className="time-input" style={style}>
      {format === '24h' ? (
        <select
          id={id}
          className={className}
          value={hh}
          disabled={disabled}
          aria-label={t('time.hours')}
          style={selectStyle}
          onChange={e => update(e.target.value, mm)}
        >
          <option value="">--</option>
          {HOURS_24.map(h => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
      ) : (
        <select
          id={id}
          className={className}
          value={h12}
          disabled={disabled}
          aria-label={t('time.hours')}
          style={selectStyle}
          onChange={e => update(e.target.value ? from12h(e.target.value, period) : '', mm)}
        >
          <option value="">--</option>
          {HOURS_12.map(h => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
      )}
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
      {format === '12h' && (
        <select
          className={className}
          value={period}
          disabled={disabled || !hh}
          aria-label={t('time.period')}
          style={selectStyle}
          onChange={e => update(from12h(h12, e.target.value as Period), mm)}
        >
          <option value="AM">{t('time.am')}</option>
          <option value="PM">{t('time.pm')}</option>
        </select>
      )}
    </div>
  );
};

export default TimeInput;
