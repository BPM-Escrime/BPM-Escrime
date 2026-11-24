/**
 * BPM - Escrime - Export Hook
 * Gestion des exports de données
 * Licensed under GPL-3.0
 */

import { useCallback } from 'react';
import { Competition, Fencer, Pool, PoolRanking, FencerStatus, Referee } from '../../shared/types';
import { logger, LogCategory } from '@shared/services/logger';
import { FinalResult } from '../../shared/domain/tableau/tableauTypes';
import { exportFencersToTXT, exportFencersToFFF } from '../../shared/utils/fencerExport';
import { usePdfTemplateStore } from '../../features/pdfTemplates/hooks/usePdfTemplateStore';
import { useToast } from '../components/Toast';
import { usePlatform } from '../platform/PlatformContext';
import { formatQuestPerMatch } from '../../shared/utils/poolCalculations';
import {
  exportResultsHTML,
  exportRankingCSV,
  exportResultsXMLFFE,
  exportDetailedStatsCSV,
  type TableauMatchForXML,
} from '../../shared/utils/multiFormatExport';

import { computePoolStrips } from '../../shared/utils/poolStrips';
import { useStripAvailability } from './useStripAvailability';
import { useBpmClient } from '../api/BpmClientContext';
import type { PoolStripQr } from '../../shared/utils/pdfExport';
import { withMatchCards } from '../services/poolCards';

/** Saisie distante active : URL du serveur et nombre de pistes (QR sur les feuilles) */
export interface PoolsRemoteInfo {
  serverUrl: string;
  arenaCount: number;
  /** Première piste de l'intervalle (1 par défaut) */
  stripStart?: number;
}

export function buildStripQrs(
  pools: Pool[],
  remote?: PoolsRemoteInfo
): Record<string, PoolStripQr> | undefined {
  if (!remote?.serverUrl) {
    // Saisie distante inactive : seul le numéro de piste assigné à la poule est imprimé (#1653)
    const assigned: Record<string, PoolStripQr> = {};
    for (const pool of pools) {
      if (pool.strip != null) assigned[pool.id] = { strip: pool.strip };
    }
    return Object.keys(assigned).length > 0 ? assigned : undefined;
  }
  const strips = computePoolStrips(
    pools,
    remote.arenaCount,
    remote.stripStart,
    useStripAvailability.getState().unavailable
  );
  const out: Record<string, PoolStripQr> = {};
  for (const [poolId, strip] of strips) {
    out[poolId] = { strip, url: `${remote.serverUrl}/arene${strip}/arbitre` };
  }
  return out;
}

/** Coordonnées du dépôt FTP saisies dans le centre d'export (#1331) */
export interface FtpPublishConfig {
  url: string;
  user: string;
  password: string;
}

/** Destination du XML de résultats : fichier local, GREG, ou serveur FTP */
/** 'greg-auto' : publication GREG périodique (#1328), sans toast de succès */
export type XmlExportTarget = 'file' | 'greg' | 'greg-auto' | { ftp: FtpPublishConfig };

interface UseExportProps {
  competition: Competition;
  showToast: ReturnType<typeof useToast>['showToast'];
  /** Matchs du tableau, joints au XML (phase de tableaux, #1328) */
  tableauMatches?: TableauMatchForXML[];
  /** Tireurs courants : statut / carton noir à jour pour le classement du XML (#1418) */
  fencers?: Fencer[];
  /** Arbitres courants : liste + affectations publiées sur GREG (#1328) */
  referees?: Referee[];
}

export const useExport = ({
  competition,
  showToast,
  tableauMatches,
  fencers,
  referees,
}: UseExportProps) => {
  const poolTemplate = usePdfTemplateStore(s => s.templates.pool);
  const platform = usePlatform();
  const client = useBpmClient();

  // Helper pour télécharger un fichier
  const downloadFile = useCallback((content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, []);

  // Export liste de tireurs (TXT ou FFF)
  const exportFencersList = useCallback(
    async (fencers: Fencer[], format: 'txt' | 'fff') => {
      try {
        const isFFF = format === 'fff';
        const extension = isFFF ? 'fff' : 'txt';
        const filterName = isFFF ? 'Fichier FFE' : 'Fichier texte';

        const content = isFFF
          ? exportFencersToFFF(competition, fencers)
          : exportFencersToTXT(fencers, competition.title);
        const saved = await platform.saveFile({
          title: `Exporter les tireurs (.${extension})`,
          suggestedName: `tireurs_${competition.title.replace(/[^a-z0-9]/gi, '_')}.${extension}`,
          filters: [
            { name: filterName, extensions: [extension] },
            { name: 'Tous les fichiers', extensions: ['*'] },
          ],
          content,
        });
        if (saved) showToast(`Export ${extension.toUpperCase()} des tireurs réussi`, 'success');
      } catch (error) {
        logger.error(LogCategory.UI, 'Export fencers failed', error as Error);
        showToast('Export des tireurs échoué', 'error');
      }
    },
    [competition, platform, showToast]
  );

  // Export classement (CSV ou JSON)
  const exportRanking = useCallback(
    (ranking: PoolRanking[], format: 'csv' | 'json', isLaserSabre: boolean) => {
      try {
        let content = '';
        let filename = '';
        let mimeType = '';

        switch (format) {
          case 'csv': {
            const headers = [
              'Rg',
              'Nom',
              'Prénom',
              'Club',
              'V',
              'M',
              'V/M',
              'TD',
              'TR',
              'Statut',
              'Indice',
            ];
            if (isLaserSabre) headers.push('Quest', 'Q/M');

            const getStatusLabel = (status: FencerStatus) => {
              switch (status) {
                case FencerStatus.ABANDONED:
                  return 'MED';
                case FencerStatus.FORFAIT:
                  return 'F';
                case FencerStatus.EXCLUDED:
                  return 'X';
                default:
                  return '';
              }
            };

            const rows = ranking.map(r => [
              r.rank,
              r.fencer.lastName,
              r.fencer.firstName,
              r.fencer.club || '',
              r.victories,
              r.victories + r.defeats,
              ((r.victories / (r.victories + r.defeats)) * 100).toFixed(1) + '%',
              r.touchesScored,
              r.touchesReceived,
              getStatusLabel(r.fencer.status),
              r.index,
              ...(isLaserSabre ? [r.questPoints || '', formatQuestPerMatch(r)] : []),
            ]);

            content = [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
            filename = `classement_${competition.title.replace(/[^a-z0-9]/gi, '_')}.csv`;
            mimeType = 'text/csv';
            break;
          }
          case 'json':
            content = JSON.stringify(
              {
                competition: competition.title,
                date: competition.date,
                ranking,
              },
              null,
              2
            );
            filename = `classement_${competition.title.replace(/[^a-z0-9]/gi, '_')}.json`;
            mimeType = 'application/json';
            break;
          default:
            showToast(`Format ${format} non supporté`, 'error');
            return;
        }

        downloadFile(content, filename, mimeType);
        showToast(`Export ${format.toUpperCase()} du classement réussi`, 'success');
      } catch (error) {
        logger.error(LogCategory.UI, 'Export ranking failed', error as Error);
        showToast(`Export ${format.toUpperCase()} échoué`, 'error');
      }
    },
    [competition.title, competition.date, downloadFile, showToast]
  );

  // Export résultats finaux (CSV ou JSON)
  const exportResults = useCallback(
    (finalResults: FinalResult[], format: 'csv' | 'json') => {
      try {
        let content = '';
        let filename = '';
        let mimeType = '';

        switch (format) {
          case 'csv': {
            const headers = ['Rang', 'Nom', 'Prénom', 'Club', 'Éliminé à'];
            const rows = finalResults.map(r => [
              r.rank,
              r.fencer.lastName,
              r.fencer.firstName,
              r.fencer.club || '',
              r.eliminatedAt || '',
            ]);

            content = [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
            filename = `resultats_${competition.title.replace(/[^a-z0-9]/gi, '_')}.csv`;
            mimeType = 'text/csv';
            break;
          }
          case 'json':
            content = JSON.stringify(
              {
                competition: competition.title,
                date: competition.date,
                results: finalResults,
              },
              null,
              2
            );
            filename = `resultats_${competition.title.replace(/[^a-z0-9]/gi, '_')}.json`;
            mimeType = 'application/json';
            break;
          default:
            showToast(`Format ${format} non supporté`, 'error');
            return;
        }

        downloadFile(content, filename, mimeType);
        showToast(`Export ${format.toUpperCase()} des résultats réussi`, 'success');
      } catch (error) {
        logger.error(LogCategory.UI, 'Export results failed', error as Error);
        showToast(`Export ${format.toUpperCase()} échoué`, 'error');
      }
    },
    [competition.title, competition.date, downloadFile, showToast]
  );

  // Export PDF de toutes les poules — jsPDF chargé à la demande
  const exportPoolsPDF = useCallback(
    async (pools: Pool[], currentPoolRound: number, remote?: PoolsRemoteInfo) => {
      try {
        const { exportMultiplePoolsToPDF } = await import('../../shared/utils/pdfExport');
        const logo = localStorage.getItem('bellepoule-logo') ?? undefined;
        await exportMultiplePoolsToPDF(
          await withMatchCards(pools),
          `${competition.title} - Tour ${currentPoolRound}`,
          logo,
          poolTemplate,
          competition.title,
          buildStripQrs(pools, remote)
        );
        showToast(`Export PDF de ${pools.length} poules généré avec succès`, 'success');
      } catch (error) {
        logger.error(LogCategory.UI, "Erreur lors de l'export PDF des poules", error as Error);
        showToast(
          `Erreur lors de la génération du PDF: ${error instanceof Error ? error.message : 'Erreur inconnue'}`,
          'error'
        );
      }
    },
    [competition.title, showToast, poolTemplate]
  );

  // Impression PDF de toutes les poules — dialogue d'impression natif
  const printPoolsPDF = useCallback(
    async (pools: Pool[], currentPoolRound: number, remote?: PoolsRemoteInfo) => {
      try {
        const { printMultiplePoolsHTML } = await import('../../shared/utils/pdfExport');
        const logo = localStorage.getItem('bellepoule-logo') ?? undefined;
        await printMultiplePoolsHTML(
          await withMatchCards(pools),
          `${competition.title} - Tour ${currentPoolRound}`,
          logo,
          poolTemplate,
          competition.title,
          buildStripQrs(pools, remote)
        );
      } catch (error) {
        logger.error(LogCategory.UI, "Erreur lors de l'impression des poules", error as Error);
        showToast(
          `Erreur lors de l'impression: ${error instanceof Error ? error.message : 'Erreur inconnue'}`,
          'error'
        );
      }
    },
    [competition.title, showToast, poolTemplate]
  );

  // Export HTML des résultats
  const exportResultsHTMLFormat = useCallback(
    (poolRanking: PoolRanking[], finalResults: FinalResult[]) => {
      try {
        const content = exportResultsHTML(competition, poolRanking, finalResults);
        const filename = `resultats_${competition.title.replace(/[^a-z0-9]/gi, '_')}.html`;
        downloadFile(content, filename, 'text/html');
        showToast('Export HTML des résultats réussi', 'success');
      } catch (error) {
        logger.error(LogCategory.UI, 'Export HTML failed', error as Error);
        showToast('Export HTML échoué', 'error');
      }
    },
    [competition, downloadFile, showToast]
  );

  // Export CSV Excel avec formules
  const exportRankingExcelCSV = useCallback(
    (poolRanking: PoolRanking[]) => {
      try {
        const content = exportRankingCSV(poolRanking, true);
        const filename = `classement_${competition.title.replace(/[^a-z0-9]/gi, '_')}_excel.csv`;
        downloadFile(content, filename, 'text/csv');
        showToast('Export CSV Excel réussi', 'success');
      } catch (error) {
        logger.error(LogCategory.UI, 'Export CSV Excel failed', error as Error);
        showToast('Export CSV Excel échoué', 'error');
      }
    },
    [competition.title, downloadFile, showToast]
  );

  // Export XML FFE (fichier) ; publication sur GREG (#1328) ou un serveur distant (#1331) par le
  // contrat : le moteur construit le XML depuis la base et l'envoie (publishResults, ADR-0022)
  const exportResultsXML = useCallback(
    async (
      poolRanking: PoolRanking[],
      finalResults: FinalResult[],
      pools?: Pool[],
      target: XmlExportTarget = 'file'
    ) => {
      if (target !== 'file') {
        try {
          const result = await client.call('publishResults', {
            competitionId: competition.id,
            target: typeof target === 'object' ? { ftp: target.ftp } : 'greg',
          });
          if (result.target === 'ftp') showToast('Résultats envoyés sur le serveur FTP', 'success');
          else if (target !== 'greg-auto') showToast('Résultats envoyés à GREG', 'success');
        } catch (error) {
          logger.error(LogCategory.UI, 'Publication des résultats échouée', error as Error);
          showToast(error instanceof Error ? error.message : 'Publication échouée', 'error');
        }
        return;
      }
      try {
        const xml = exportResultsXMLFFE(
          competition,
          poolRanking,
          finalResults,
          pools,
          tableauMatches,
          fencers,
          referees
        );
        const filename = `resultats_${competition.title.replace(/[^a-z0-9]/gi, '_')}.xml`;
        downloadFile(xml, filename, 'application/xml');
        showToast('Export XML FFE réussi', 'success');
      } catch (error) {
        logger.error(LogCategory.UI, 'Export XML failed', error as Error);
        showToast('Export XML échoué', 'error');
      }
    },
    [client, competition, downloadFile, showToast, tableauMatches, fencers, referees]
  );

  // Export statistiques détaillées CSV
  const exportDetailedStats = useCallback(
    (pools: Pool[], poolRanking: PoolRanking[]) => {
      try {
        const content = exportDetailedStatsCSV(competition, pools, poolRanking);
        const filename = `stats_${competition.title.replace(/[^a-z0-9]/gi, '_')}.csv`;
        downloadFile(content, filename, 'text/csv');
        showToast('Export statistiques détaillées réussi', 'success');
      } catch (error) {
        logger.error(LogCategory.UI, 'Export stats failed', error as Error);
        showToast('Export statistiques échoué', 'error');
      }
    },
    [competition, downloadFile, showToast]
  );

  return {
    exportFencersList,
    exportRanking,
    exportResults,
    exportPoolsPDF,
    printPoolsPDF,
    downloadFile,
    exportResultsHTML: exportResultsHTMLFormat,
    exportRankingExcelCSV,
    exportResultsXML,
    exportDetailedStats,
  };
};

export default useExport;
