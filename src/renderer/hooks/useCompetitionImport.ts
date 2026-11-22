/**
 * BellePoule Modern - Import de tireurs et de classements (extrait de CompetitionView, #1599)
 * Licensed under GPL-3.0
 */
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { Competition, Fencer, Referee } from '../../shared/types';
import { logger, LogCategory, toError } from '@shared/services/logger';
import type { ImportedReferee, RankingImportResult } from '../../shared/utils/fileParser';
import { importIdentityKeys } from '../../shared/utils/personIdentity';
import { useToast } from '../components/Toast';
import { useTranslation } from './useTranslation';
import type { useFencerManagement } from './useFencerManagement';
import { useBpmClient } from '../api/BpmClientContext';
import { refereeFromDTO, registerRefereeInput } from '../api/refereeMapping';

export interface ImportData {
  format: string;
  filepath: string;
  content: string;
}

interface UseCompetitionImportParams {
  competition: Competition;
  onUpdate: (competition: Competition) => void;
  bulkAddFencers: ReturnType<typeof useFencerManagement>['bulkAddFencers'];
  referees?: Referee[];
  setReferees?: Dispatch<SetStateAction<Referee[]>>;
}

/** Fichier d'import en cours (modale) et gestionnaires d'import (tireurs, classement). */
export function useCompetitionImport({
  competition,
  onUpdate,
  bulkAddFencers,
  referees = [],
  setReferees,
}: UseCompetitionImportParams) {
  const { showToast } = useToast();
  const client = useBpmClient();
  const { t } = useTranslation();
  const [importData, setImportData] = useState<ImportData | null>(null);
  // Compétition à jour pour les traitements asynchrones (import tireurs puis arbitres)
  const latestCompetition = useRef(competition);
  useEffect(() => {
    latestCompetition.current = competition;
  }, [competition]);

  const handleImportFencers = async (importedFencers: Partial<Fencer>[]) => {
    await bulkAddFencers(importedFencers as any);
    setImportData(null);
  };

  /** Arbitres du bloc <Arbitres> d'un XML (#1504) ; doublons nom + prénom ignorés */
  const handleImportReferees = async (imported: ImportedReferee[]) => {
    // Doublon : même licence, ou même nom + prénom (clés partagées avec le MCP, #1880)
    const known = new Set(referees.flatMap(r => importIdentityKeys(r)));
    const fresh: ImportedReferee[] = [];
    for (const ref of imported) {
      const keys = importIdentityKeys(ref);
      if (keys.some(k => known.has(k))) continue;
      keys.forEach(k => known.add(k));
      fresh.push(ref);
    }
    const created: Referee[] = [];
    if (fresh.length > 0) {
      try {
        // Inscription par le moteur (registerReferees, docs/adr/0018)
        const r = await client.call('registerReferees', {
          competitionId: competition.id,
          referees: fresh.map(registerRefereeInput),
        });
        created.push(...r.referees.map(refereeFromDTO));
      } catch (err) {
        logger.error(LogCategory.UI, 'Failed to import referees', err as Error);
      }
    }
    if (created.length > 0) setReferees?.(prev => [...prev, ...created]);
    // Arbitres importés : gestion des arbitres activée d'office (#1504)
    const current = latestCompetition.current;
    if (created.length > 0 && !current.settings?.refereeFeatureEnabled) {
      const updated: Competition = {
        ...current,
        settings: { ...current.settings, refereeFeatureEnabled: true } as Competition['settings'],
      };
      onUpdate(updated);
      try {
        await window.electronAPI.db.updateCompetition?.(current.id, updated);
      } catch (err) {
        logger.error(LogCategory.UI, 'Failed to enable referee feature', err as Error);
      }
    }
    showToast(t('plural.referees_imported', { count: created.length }), 'success');
    setImportData(null);
  };

  const handleOpenImportDialog = async (type: 'xml' | 'fff' | 'ranking' = 'fff') => {
    const configs = {
      xml: {
        title: 'Importer un fichier XML BellePoule',
        filters: [{ name: 'XML BellePoule', extensions: ['xml', 'cotcot'] }],
      },
      fff: {
        title: 'Importer une liste FFE (.fff, .csv, .txt, .xlsx)',
        filters: [
          { name: 'Fichiers FFE / CSV / Excel', extensions: ['fff', 'csv', 'txt', 'xlsx'] },
        ],
      },
      ranking: {
        title: 'Importer un classement (FFF ou CSV : NOM, PRENOM, CLASSEMENT)',
        filters: [{ name: 'Fichier classement', extensions: ['fff', 'csv', 'txt', 'xlsx'] }],
      },
    };
    const cfg = configs[type];
    const result = await window.electronAPI.dialog.openFile({
      title: cfg.title,
      filters: [...cfg.filters, { name: 'Tous les fichiers', extensions: ['*'] }],
      properties: ['openFile'],
    });

    if (result && result.filePath) {
      const filepath = result.filePath;
      const content = result.content || '';
      const extension = filepath.split('.').pop()?.toLowerCase();

      // TXT simple → parseur libre ; CSV/Excel → parseur FFE (modèle d'import : en-tête + colonnes)
      let format: string = type;
      if (type === 'fff' && extension === 'txt') {
        format = 'txt';
      }

      setImportData({ format, filepath, content });
    }
  };

  const handleImportRanking = async (result: RankingImportResult) => {
    try {
      // Classement d'entrée par le moteur (setFencerRankings, docs/adr/0018)
      const rankings = result.details
        .filter(d => d.matched && d.fencerId)
        .map(d => ({
          fencerId: d.fencerId!,
          ranking: typeof d.ranking === 'number' && d.ranking >= 1 ? d.ranking : null,
        }));
      if (rankings.length > 0) {
        await client.call('setFencerRankings', { competitionId: competition.id, rankings });
      }

      onUpdate({
        ...competition,
        fencers: (competition.fencers || []).map(f => {
          const detail = result.details.find(d => d.fencerId === f.id);
          return detail?.matched ? { ...f, ranking: detail.ranking, updatedAt: new Date() } : f;
        }),
      });

      showToast(
        t('plural.ranking_imported', { count: result.updated }),
        result.errors.length > 0 ? 'warning' : 'success'
      );
      setImportData(null);
    } catch (error) {
      logger.error(LogCategory.UI, 'Failed to import ranking', error as Error);
      showToast(
        t('fencerList.ranking_import_failed', { message: toError(error).message }),
        'error'
      );
    }
  };

  return {
    importData,
    setImportData,
    handleImportFencers,
    handleOpenImportDialog,
    handleImportRanking,
    handleImportReferees,
  };
}
