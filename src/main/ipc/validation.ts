/**
 * BPM - Escrime - Validation des données IPC reçues du renderer (#1774)
 * Sans dépendance Electron : importée par preload.ts, testable unitairement.
 * Licensed under GPL-3.0
 */
import type { MatchCreateData } from '../../shared/types/preload';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const validateUUID = (id: string, label: string): void => {
  if (!id || !UUID_RE.test(id)) throw new Error(`Invalid ${label} format`);
};

export const validateMatchData = (match: MatchCreateData): void => {
  if (typeof match.number !== 'number' || match.number < 0) {
    throw new Error('Match number is required and must be positive');
  }
  if (typeof match.maxScore !== 'number' || match.maxScore < 0) {
    throw new Error('Match max score is required and must be positive');
  }
};
