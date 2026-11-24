/**
 * BPM - Escrime - Dossier refusé par une commande du poste (#2260, docs/adr/0030)
 * Après `desktop.pickDirectory`, la commande (setBackupDir, setCompetitionBackupDir,
 * addAgentFolder) peut refuser le dossier : toast d'erreur traduit selon le code, l'état
 * affiché ne change pas. Aucun code d'erreur nouveau : `dir_not_found`, `station_refused`.
 * Licensed under GPL-3.0
 */

import { useCallback } from 'react';
import { ApiError } from '../../shared/api/client';
import { useToast } from '../components/Toast';
import { useTranslation } from './useTranslation';

/** Clé de traduction du message selon l'erreur ; autre code ou panne : message générique */
export function directoryRefusalKey(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'dir_not_found') return 'errors.dir_not_found';
    if (error.code === 'station_refused') return 'errors.dir_not_writable';
  }
  return 'errors.dir_save_failed';
}

/** Rend `refuse(error, path?)` : toast d'erreur, avec le chemin refusé s'il est connu */
export function useDirectoryRefusal(): (error: unknown, path?: string | null) => void {
  const { t } = useTranslation();
  const { showToast } = useToast();
  return useCallback(
    (error, path) => showToast(t(directoryRefusalKey(error), { path: path ?? '' }), 'error'),
    [t, showToast]
  );
}
