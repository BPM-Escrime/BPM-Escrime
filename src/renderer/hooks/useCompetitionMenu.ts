/**
 * BellePoule Modern - Actions du menu natif pour la vue compétition (extrait de CompetitionView, #1599)
 * Licensed under GPL-3.0
 */
import type { Dispatch, SetStateAction } from 'react';
import type { Fencer, PoolRanking } from '../../shared/types';
import type { FinalResult } from '../../shared/domain/tableau/tableauTypes';
import { useOperation } from '../components/common/OperationProgress';
import { useToast } from '../components/Toast';
import type { ImportData } from './useCompetitionImport';
import type { Phase } from './useCompetitionSession';
import type { useExport } from './useExport';
import { useMenuEvents } from './useMenuEvents';
import { useTranslation } from './useTranslation';
import { DATA_FILE_FILTERS, openDataFile, saveDataFile, useFilesApi } from '../api/filesApi';
import { usePlatform } from '../platform/PlatformContext';

interface UseCompetitionMenuParams {
  competitionId: string;
  currentPhase: Phase;
  fencers: Fencer[];
  hasPools: boolean;
  overallRanking: PoolRanking[];
  finalResults: FinalResult[];
  isLaserSabre: boolean;
  exports: ReturnType<typeof useExport>;
  loadFencers: () => void;
  setImportData: Dispatch<SetStateAction<ImportData | null>>;
  setShowPropertiesModal: Dispatch<SetStateAction<boolean>>;
  setShowAddFencerModal: Dispatch<SetStateAction<boolean>>;
}

/** Branche les commandes du menu natif (propriétés, exports, imports) sur la compétition. */
export function useCompetitionMenu({
  competitionId,
  currentPhase,
  fencers,
  hasPools,
  overallRanking,
  finalResults,
  isLaserSabre,
  exports,
  loadFencers,
  setImportData,
  setShowPropertiesModal,
  setShowAddFencerModal,
}: UseCompetitionMenuParams) {
  const { showToast, showActionableError } = useToast();
  const { runOperation } = useOperation();
  const { t } = useTranslation();
  const files = useFilesApi();
  const platform = usePlatform();
  const { exportFencersList, exportRanking, exportResults } = exports;

  useMenuEvents({
    currentPhase,
    onShowProperties: () => setShowPropertiesModal(true),
    onShowAddFencer: () => setShowAddFencerModal(true),
    onExportFencers: format => exportFencersList(fencers, format),
    // Fichiers de données : contenu par le contrat, dialogue par la plateforme (ADR-0021)
    onExportFencersBpf: async () => {
      const file = await runOperation('export', () => files.fencersArchive(competitionId));
      const saved = await saveDataFile(platform, file, {
        title: t('dialogs.exportFencersArchive'),
        filters: DATA_FILE_FILTERS.bpf,
      });
      if (!saved) return;
      const { count } = file;
      showToast(
        `${count} tireur${count !== 1 ? 's' : ''} exporté${count !== 1 ? 's' : ''} (.bpf)`,
        'success'
      );
    },
    onExportPhotos: async () => {
      const file = await runOperation('export', () => files.photosArchive(competitionId));
      const saved = await saveDataFile(platform, file, {
        title: t('dialogs.exportPhotos'),
        filters: DATA_FILE_FILTERS.zip,
      });
      if (!saved) return;
      const { count } = file;
      showToast(
        `${count} photo${count !== 1 ? 's' : ''} exportée${count !== 1 ? 's' : ''}`,
        'success'
      );
    },
    onExportRanking: format => exportRanking(overallRanking, format, isLaserSabre),
    onExportResults: format => exportResults(finalResults, format),
    onImport: async (format, filepath, content) => {
      if (format === 'fencers-bpf') {
        // Le menu ne lit plus l'archive : l'écran la choisit et l'importe par le contrat
        try {
          const picked = await openDataFile(platform, {
            title: t('fencerList.import_bpf'),
            filters: DATA_FILE_FILTERS.bpf,
          });
          if (!picked) return;
          await runOperation('import', () =>
            files.importFencersArchive(competitionId, picked.content)
          );
          loadFencers();
        } catch (err) {
          showActionableError('messages.import_archive_failed', err);
        }
        return;
      }
      setImportData({ format, filepath, content });
    },
    onNextPhase: () => {},
    loadFencers,
    hasPools,
    overallRanking,
    finalResults,
    isLaserSabre,
  });
}
