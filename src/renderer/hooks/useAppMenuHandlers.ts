/**
 * BPM - Escrime - Événements du menu natif et des fichiers pour l'App (#1897)
 * Extrait d'App.tsx : un seul abonnement au montage, désabonnement ciblé (#1894).
 * Les handlers sont lus via une ref : toujours la dernière version, sans réabonnement.
 * Menu et fichiers par `usePlatform().desktop` (ADR-0030) : rien hors application de bureau.
 * Licensed under GPL-3.0
 */

import { useEffect, useRef } from 'react';
import { logger, LogCategory } from '@shared/services/logger';
import type { ToastType } from '../components/Toast';
import { usePlatform } from '../platform/PlatformContext';

export interface AppMenuHandlers {
  onNewCompetition: () => void;
  onReportIssue: () => void;
  onAbout: () => void;
  onOpenSettings: () => void;
  /** Recharge la liste des compétitions (après ouverture d'un .bpm) */
  reloadCompetitions: () => Promise<void> | void;
  /** Ouvre une compétition importée avec son état sauvegardé (#1117) */
  openImportedCompetition: (competitionId: string) => Promise<void> | void;
  showToast: (message: string, type?: ToastType) => void;
  /** Fichier → Ouvrir a choisi une archive chiffrée : invite du mot de passe (ADR-0021) */
  onEncryptedFile?: (fileName: string, content: string) => void;
}

/** Après l'ouverture d'un .bpm : liste rechargée, avis, épreuve seule ouverte (#1117) */
export async function announceOpenedCompetitions(
  handlers: Pick<AppMenuHandlers, 'reloadCompetitions' | 'openImportedCompetition' | 'showToast'>,
  competitionIds: string[] | undefined
): Promise<void> {
  await handlers.reloadCompetitions();
  if (competitionIds?.length) {
    handlers.showToast(
      competitionIds.length === 1
        ? 'Compétition importée'
        : `${competitionIds.length} compétitions importées`,
      'success'
    );
  }
  // Une seule compétition : l'ouvrir avec son état sauvegardé (#1117)
  if (competitionIds?.length === 1) await handlers.openImportedCompetition(competitionIds[0]);
}

export function useAppMenuHandlers(handlers: AppMenuHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;
  const desktop = usePlatform().desktop;

  useEffect(() => {
    if (!desktop) return;
    const h = () => ref.current;
    const unsubscribers = [
      desktop.onMenu('newCompetition', () => h().onNewCompetition()),
      desktop.onMenu('reportIssue', () => h().onReportIssue()),
      desktop.onMenu('about', () => h().onAbout()),
      desktop.onCompetitionFileOpened(({ competitionIds }) => {
        logger.debug(LogCategory.UI, 'Fichier .BPM ouvert', { competitionIds });
        void announceOpenedCompetitions(h(), competitionIds);
      }),
      desktop.onEncryptedFileOpened(({ name, content }) => h().onEncryptedFile?.(name, content)),
      desktop.onMenu('save', () => h().showToast('Sauvegarde effectuée', 'success')),
      desktop.onMenu('openSettings', () => h().onOpenSettings()),
      desktop.onAutosave(({ ok }) => {
        if (ok) logger.debug(LogCategory.UI, 'Autosave OK');
        else h().showToast('Échec de la sauvegarde automatique', 'error');
      }),
    ];
    return () => {
      for (const off of unsubscribers) off();
    };
  }, [desktop]);
}
