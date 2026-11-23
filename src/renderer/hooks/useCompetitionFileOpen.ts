/**
 * BellePoule Modern - Ouverture d'une sauvegarde .bpm par l'écran (#1981, ADR-0021)
 * Fichier choisi par la plateforme, fusion par le contrat (openCompetitionFile). Archive
 * chiffrée (password_required) : le contenu reste en mémoire le temps de la saisie du mot de
 * passe (EncryptedBpmPrompt), puis l'ouverture est renvoyée avec lui. Même invite pour une
 * archive choisie par Fichier → Ouvrir (menu natif, `requestPassword`).
 * Licensed under GPL-3.0
 */

import { useCallback, useState } from 'react';
import { ApiError } from '../../shared/api/client';
import { openDataFile, useFilesApi } from '../api/filesApi';
import { usePlatform } from '../platform/PlatformContext';

export interface PendingEncryptedFile {
  fileName: string;
  content: string;
}

/** Sauvegardes ouvertes par l'accueil (.cotcot : par Fichier → Importer) */
export const OPEN_FILE_FILTERS = [{ name: 'BellePoule', extensions: ['bpm', 'db'] }];

export function useCompetitionFileOpen(onOpened: (competitionIds: string[]) => unknown) {
  const files = useFilesApi();
  const platform = usePlatform();
  const [pending, setPending] = useState<PendingEncryptedFile | null>(null);

  /** Ouvre un contenu ; archive chiffrée → invite du mot de passe. Autre refus : ApiError */
  const openContent = useCallback(
    async (fileName: string, content: string) => {
      try {
        const { competitionIds } = await files.openCompetitionFile(content);
        await onOpened(competitionIds);
      } catch (e) {
        if (e instanceof ApiError && e.code === 'password_required') {
          setPending({ fileName, content });
          return;
        }
        throw e;
      }
    },
    [files, onOpened]
  );

  /** Bouton « Ouvrir » de l'accueil */
  const openFile = useCallback(async () => {
    const picked = await openDataFile(platform, { filters: OPEN_FILE_FILTERS });
    if (picked) await openContent(picked.name, picked.content);
  }, [platform, openContent]);

  /** Mot de passe saisi ; lève ApiError (wrong_password…) pour l'invite */
  const submitPassword = useCallback(
    async (password: string) => {
      if (!pending) return;
      const { competitionIds } = await files.openCompetitionFile(pending.content, password);
      setPending(null);
      await onOpened(competitionIds);
    },
    [files, pending, onOpened]
  );

  const requestPassword = useCallback(
    (fileName: string, content: string) => setPending({ fileName, content }),
    []
  );
  const cancel = useCallback(() => setPending(null), []);

  return { pending, openFile, openContent, submitPassword, requestPassword, cancel };
}
