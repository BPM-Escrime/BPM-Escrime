/**
 * BPM - Escrime - Fencer Management Hook
 * Gestion des tireurs (CRUD, check-in, import)
 * Licensed under GPL-3.0
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Competition, Fencer, FencerStatus } from '../../shared/types';
import { logger, LogCategory, toError } from '@shared/services/logger';
import { useToast } from '../components/Toast';
import { importRankingFromFFF, RankingImportResult } from '../../shared/utils/fileParser';
import { useTranslation } from './useTranslation';
import { useCompetitionEvent } from './useCompetitionEvent';
import { useBpmClient } from '../api/BpmClientContext';
import { canToggleCheckIn } from '../../shared/domain/fencers/fencerStatus';
import {
  FENCER_DETAIL_KEYS,
  detailsInput,
  fencerFromDTO,
  registerInput,
} from '../api/fencerMapping';

interface UseFencerManagementProps {
  competition: Competition;
  onUpdate: (competition: Competition) => void;
}

export const useFencerManagement = ({ competition, onUpdate }: UseFencerManagementProps) => {
  const { showToast } = useToast();
  const { t } = useTranslation();
  const [fencers, setFencers] = useState<Fencer[]>(competition.fencers || []);
  const competitionRef = useRef(competition);
  const onUpdateRef = useRef(onUpdate);
  competitionRef.current = competition;
  onUpdateRef.current = onUpdate;
  // Inscription par les commandes du contrat (docs/adr/0018)
  const client = useBpmClient();

  // Synchroniser avec la compétition parente
  useEffect(() => {
    setFencers(competition.fencers || []);
  }, [competition.fencers]);

  // Charger les tireurs depuis la base de données
  const loadFencers = useCallback(async () => {
    const comp = competitionRef.current;
    let data: Fencer[];
    try {
      data = (await client.query('listFencers', { competitionId: comp.id })).map(fencerFromDTO);
    } catch {
      return; // API indisponible (hors Electron)
    }
    try {
      setFencers(data);
      onUpdateRef.current({ ...comp, fencers: data });
    } catch (error) {
      logger.error(LogCategory.UI, 'Failed to load fencers', error as Error);
      showToast('Erreur lors du chargement des tireurs', 'error');
    }
  }, [client, showToast]);

  // Rechargement push (inscription distante, import…) : remplace tout poll (#1298).
  // Regroupe les rafales d'événements (import en masse) en un seul rechargement.
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useCompetitionEvent('fencers:changed', competition.id, () => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = setTimeout(() => void loadFencers(), 200);
  });
  useEffect(
    () => () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    },
    []
  );

  // Ajouter un tireur
  const addFencer = useCallback(
    async (fencerData: Omit<Fencer, 'id' | 'createdAt' | 'updatedAt'>) => {
      logger.debug(LogCategory.UI, 'addFencer called', { fencerData });

      try {
        const r = await client.call('registerFencers', {
          competitionId: competition.id,
          fencers: [registerInput(fencerData)],
        });
        const newFencer = fencerFromDTO(r.fencers[0]);

        const updatedFencers = [...fencers, newFencer];
        setFencers(updatedFencers);
        onUpdate({ ...competition, fencers: updatedFencers });
        showToast('Tireur ajouté avec succès', 'success');
        return newFencer;
      } catch (error) {
        logger.error(LogCategory.UI, 'Failed to add fencer', error as Error);
        showToast(
          "Erreur lors de l'ajout du tireur: " +
            (error instanceof Error ? error.message : 'Erreur inconnue'),
          'error'
        );
        throw error;
      }
    },
    [client, fencers, competition, onUpdate, showToast]
  );

  /**
   * Écriture d'une mise à jour : identité par updateFencerDetails, classement d'entrée par
   * setFencerRankings (docs/adr/0018). Statut et motif restent écrits directement : ils
   * viennent des chemins locaux des formats que le moteur ne pilote pas (exceptions de #1980).
   */
  const persistFencerUpdate = useCallback(
    async (fencerId: string, updates: Partial<Fencer>) => {
      const competitionId = competition.id;
      const details = detailsInput(updates);
      if (Object.keys(details).length > 0) {
        await client.call('updateFencerDetails', { competitionId, fencerId, details });
      }
      if ('ranking' in updates) {
        const ranking =
          typeof updates.ranking === 'number' && updates.ranking >= 1 ? updates.ranking : null;
        await client.call('setFencerRankings', {
          competitionId,
          rankings: [{ fencerId, ranking }],
        });
      }
      const rest = Object.fromEntries(
        Object.entries(updates).filter(
          ([k]) => k !== 'ranking' && !(FENCER_DETAIL_KEYS as readonly string[]).includes(k)
        )
      ) as Partial<Fencer>;
      if (Object.keys(rest).length > 0) await window.electronAPI?.db?.updateFencer(fencerId, rest);
    },
    [client, competition.id]
  );

  // Mettre à jour un tireur
  const updateFencer = useCallback(
    async (fencerId: string, updates: Partial<Fencer>) => {
      try {
        await persistFencerUpdate(fencerId, updates);
        const updatedFencers = fencers.map(f =>
          f.id === fencerId ? { ...f, ...updates, updatedAt: new Date() } : f
        );
        setFencers(updatedFencers);
        onUpdate({ ...competition, fencers: updatedFencers });
        showToast('Tireur mis à jour', 'success');
      } catch (error) {
        logger.error(LogCategory.UI, 'Failed to update fencer', error as Error);
        showToast(t('fencerList.update_failed', { message: toError(error).message }), 'error');
        throw error;
      }
    },
    [fencers, competition, onUpdate, showToast, persistFencerUpdate, t]
  );

  // Mettre à jour plusieurs tireurs en une seule mise à jour d'état
  // (updateFencer en boucle écrase les MAJ : closure sur `fencers` périmée)
  const updateFencers = useCallback(
    async (updates: Record<string, Partial<Fencer>>) => {
      const ids = Object.keys(updates);
      if (ids.length === 0) return;
      const now = new Date();
      const updatedFencers = fencers.map(f =>
        updates[f.id] ? { ...f, ...updates[f.id], updatedAt: now } : f
      );
      setFencers(updatedFencers);
      onUpdate({ ...competition, fencers: updatedFencers });
      await Promise.allSettled(
        ids.map(id =>
          window.electronAPI?.db
            ?.updateFencer?.(id, updates[id])
            .catch(err =>
              logger.error(LogCategory.UI, `Failed to update fencer ${id}`, err as Error)
            )
        )
      );
    },
    [fencers, competition, onUpdate]
  );

  // Changer le statut de plusieurs tireurs
  const setFencersStatus = useCallback(
    (fencerIds: string[], status: FencerStatus) =>
      updateFencers(Object.fromEntries(fencerIds.map(id => [id, { status }]))),
    [updateFencers]
  );

  // Annulation d'une suppression : ré-ajoute le tireur (nouvel id). Lu au clic, donc toujours à jour.
  const restoreFencerRef = useRef<(f: Fencer) => void>(() => {});
  restoreFencerRef.current = ({ id: _id, createdAt: _c, updatedAt: _u, ...data }) => {
    void addFencer(data);
  };

  // Supprimer un tireur (annulable 5 s, sans confirmation modale : #1535)
  const deleteFencer = useCallback(
    async (fencerId: string) => {
      try {
        const removed = fencers.find(f => f.id === fencerId);
        await client.call('unregisterFencers', {
          competitionId: competition.id,
          fencerIds: [fencerId],
        });
        const updatedFencers = fencers.filter(f => f.id !== fencerId);
        setFencers(updatedFencers);
        onUpdate({ ...competition, fencers: updatedFencers });
        showToast(
          t('fencerList.deleted', {
            name: removed ? `${removed.lastName} ${removed.firstName}` : '',
          }),
          'info',
          {
            duration: 5000,
            action: {
              label: t('fencerList.undo'),
              onClick: () => removed && restoreFencerRef.current(removed),
            },
            undo: true, // Ctrl+Z (#1535)
          }
        );
      } catch (error) {
        logger.error(LogCategory.UI, 'Failed to delete fencer', error as Error);
        showToast(t('fencerList.delete_failed', { message: toError(error).message }), 'error');
        throw error;
      }
    },
    [client, fencers, competition, onUpdate, showToast, t]
  );

  // Supprimer tous les tireurs
  const deleteAllFencers = useCallback(async () => {
    try {
      await client.call('unregisterFencers', { competitionId: competition.id, all: true });
      setFencers([]);
      onUpdate({ ...competition, fencers: [] });
      showToast('Tous les tireurs ont été supprimés', 'success');
    } catch (error) {
      logger.error(LogCategory.UI, 'Failed to delete all fencers', error as Error);
      showToast(t('fencerList.delete_failed', { message: toError(error).message }), 'error');
      throw error;
    }
  }, [client, competition, onUpdate, showToast, t]);

  // Pointage : un seul chemin, la commande checkIn du contrat (#1980, docs/adr/0005).
  // Lots de 1000 (limite du contrat) ; une erreur remonte : pas de succès affiché.
  const setPresence = useCallback(
    async (ids: string[], present: boolean): Promise<number> => {
      let updated = 0;
      for (let i = 0; i < ids.length; i += 1000) {
        const r = await client.call('checkIn', {
          competitionId: competition.id,
          fencers: ids.slice(i, i + 1000),
          present,
        });
        updated += r.updated;
      }
      return updated;
    },
    [client, competition.id]
  );

  /** État local après une commande réussie : même règle que le moteur (canToggleCheckIn) */
  const applyPresenceLocally = useCallback(
    (ids: string[], present: boolean) => {
      const set = new Set(ids);
      const status = present ? FencerStatus.CHECKED_IN : FencerStatus.NOT_CHECKED_IN;
      const updatedFencers = fencers.map(f =>
        set.has(f.id) && canToggleCheckIn(f) ? { ...f, status, updatedAt: new Date() } : f
      );
      setFencers(updatedFencers);
      onUpdate({ ...competition, fencers: updatedFencers });
    },
    [fencers, competition, onUpdate]
  );

  const presenceFailed = useCallback(
    (err: unknown) => {
      logger.error(LogCategory.UI, 'Failed to update check-in', toError(err));
      showToast(t('fencerList.checkin_failed', { message: toError(err).message }), 'error');
    },
    [showToast, t]
  );

  // Pointer / dépointer un tireur (bouton de la liste)
  const toggleCheckIn = useCallback(
    async (fencerId: string) => {
      const fencer = fencers.find(f => f.id === fencerId);
      if (!fencer) return;
      if (!canToggleCheckIn(fencer)) {
        // Abandon, forfait, exclusion : se restaure, ne se pointe pas
        showToast(t('fencerList.checkin_special_status'), 'warning');
        return;
      }
      const present = fencer.status !== FencerStatus.CHECKED_IN;
      try {
        await setPresence([fencerId], present);
        applyPresenceLocally([fencerId], present);
      } catch (err) {
        presenceFailed(err);
      }
    },
    [fencers, setPresence, applyPresenceLocally, presenceFailed, showToast, t]
  );

  // Pointer tous les tireurs
  const checkInAll = useCallback(async () => {
    const notCheckedIn = fencers.filter(f => f.status === FencerStatus.NOT_CHECKED_IN);
    if (notCheckedIn.length === 0) {
      showToast('Tous les tireurs sont déjà pointés', 'info');
      return;
    }
    const ids = notCheckedIn.map(f => f.id);
    try {
      await setPresence(ids, true);
      applyPresenceLocally(ids, true);
      showToast(t('plural.fencers_checked_in', { count: notCheckedIn.length }), 'success');
    } catch (err) {
      presenceFailed(err);
    }
  }, [fencers, showToast, t, setPresence, applyPresenceLocally, presenceFailed]);

  // Dépointer tous les tireurs
  const uncheckAll = useCallback(async () => {
    const checkedIn = fencers.filter(f => f.status === FencerStatus.CHECKED_IN);
    if (checkedIn.length === 0) {
      showToast("Aucun tireur n'est pointé", 'info');
      return;
    }
    const ids = checkedIn.map(f => f.id);
    try {
      await setPresence(ids, false);
      applyPresenceLocally(ids, false);
      showToast(t('plural.fencers_checked_out', { count: checkedIn.length }), 'success');
    } catch (err) {
      presenceFailed(err);
    }
  }, [fencers, showToast, t, setPresence, applyPresenceLocally, presenceFailed]);

  // Obtenir les tireurs pointés
  const getCheckedInFencers = useCallback(() => {
    return fencers.filter(f => f.status === FencerStatus.CHECKED_IN);
  }, [fencers]);

  // Importer plusieurs tireurs en une seule opération (évite N re-renders)
  const bulkAddFencers = useCallback(
    async (fencersData: Omit<Fencer, 'id' | 'createdAt' | 'updatedAt'>[]) => {
      const added: Fencer[] = [];
      for (let i = 0; i < fencersData.length; i += 2000) {
        const r = await client.call('registerFencers', {
          competitionId: competition.id,
          fencers: fencersData.slice(i, i + 2000).map(registerInput),
        });
        added.push(...r.fencers.map(fencerFromDTO));
      }

      const updatedFencers = [...fencers, ...added];
      setFencers(updatedFencers);
      onUpdate({ ...competition, fencers: updatedFencers });
      showToast(
        `${added.length} tireur${added.length !== 1 ? 's' : ''} importé${added.length !== 1 ? 's' : ''}`,
        'success'
      );
      return added;
    },
    [client, fencers, competition, onUpdate, showToast]
  );

  // Importer un classement depuis un fichier FFF
  const importRanking = useCallback(
    async (fileContent: string): Promise<RankingImportResult> => {
      try {
        // Importer le classement uniquement pour les tireurs existants
        const result = importRankingFromFFF(fileContent, fencers);

        if (result.updated === 0 && result.notFound > 0) {
          showToast(
            `Aucun tireur trouvé dans la liste d'appel (${result.notFound} non trouvés)`,
            'warning'
          );
          return result;
        }

        // Classement d'entrée par le moteur (setFencerRankings) ; refusé après le tirage
        const rankings = result.details
          .filter(d => d.matched && d.fencerId)
          .map(d => ({
            fencerId: d.fencerId!,
            ranking: typeof d.ranking === 'number' && d.ranking >= 1 ? d.ranking : null,
          }));
        if (rankings.length > 0) {
          await client.call('setFencerRankings', { competitionId: competition.id, rankings });
        }

        // Mettre à jour l'état local
        const updatedFencers = fencers.map(f => {
          const detail = result.details.find(d => d.fencerId === f.id);
          if (detail) {
            return { ...f, ranking: detail.ranking, updatedAt: new Date() };
          }
          return f;
        });

        setFencers(updatedFencers);
        onUpdate({ ...competition, fencers: updatedFencers });

        // Message détaillé avec tous les compteurs
        let message = `Classement: ${result.updated}/${result.totalFencers} mis à jour`;
        if (result.notInFile > 0) {
          message += `, ${result.notInFile} sans classement`;
        }
        if (result.notFound > 0) {
          message += `, ${result.notFound} du fichier non trouvés`;
        }
        if (result.skipped > 0) {
          message += `, ${result.skipped} lignes ignorées`;
        }

        showToast(
          message,
          result.notInFile > 0 || result.notFound > 0 || result.errors.length > 0
            ? 'warning'
            : 'success'
        );

        return result;
      } catch (error) {
        logger.error(LogCategory.UI, 'Failed to import ranking', error as Error);
        showToast(
          t('fencerList.ranking_import_failed', { message: toError(error).message }),
          'error'
        );
        throw error;
      }
    },
    [client, fencers, competition, onUpdate, showToast, t]
  );

  return {
    fencers,
    setFencers,
    loadFencers,
    addFencer,
    bulkAddFencers,
    updateFencer,
    updateFencers,
    setFencersStatus,
    deleteFencer,
    deleteAllFencers,
    toggleCheckIn,
    checkInAll,
    uncheckAll,
    getCheckedInFencers,
    importRanking,
  };
};

export default useFencerManagement;
