/**
 * BPM - Escrime - Format de saisie des heures : 24 h ou AM/PM, persisté en local.
 * Lu par TimeInput ; changement immédiat dans tous les champs ouverts.
 * Licensed under GPL-3.0
 */
import { useSyncExternalStore } from 'react';

export const TIME_FORMAT_STORAGE_KEY = 'bellepoule-time-format';
export const TIME_FORMATS = ['24h', '12h'] as const;
export type TimeFormat = (typeof TIME_FORMATS)[number];

export function normalizeTimeFormat(value: unknown): TimeFormat {
  return value === '12h' ? '12h' : '24h';
}

export function loadTimeFormat(): TimeFormat {
  try {
    return normalizeTimeFormat(localStorage.getItem(TIME_FORMAT_STORAGE_KEY));
  } catch {
    return '24h';
  }
}

let current: TimeFormat | null = null;
const listeners = new Set<() => void>();

function getTimeFormat(): TimeFormat {
  if (current === null) current = loadTimeFormat();
  return current;
}

export function saveTimeFormat(format: TimeFormat): void {
  current = format;
  try {
    localStorage.setItem(TIME_FORMAT_STORAGE_KEY, format);
  } catch {
    /* stockage indisponible : réglage limité à la session */
  }
  listeners.forEach(l => l());
}

/** Relit le stockage (import de réglages). */
export function reloadTimeFormat(): void {
  current = loadTimeFormat();
  listeners.forEach(l => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTimeFormat(): TimeFormat {
  return useSyncExternalStore(subscribe, getTimeFormat, () => '24h');
}
