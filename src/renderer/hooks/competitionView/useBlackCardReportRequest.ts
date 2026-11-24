/**
 * BPM - Escrime - Rapport de carton noir demandé depuis l'appel DT (#2190) : l'épreuve affichée
 * produit le PDF pré-rempli (annexe 14 FFE) du tireur exclu, ou de tous les exclus.
 * Licensed under GPL-3.0
 */

import { useEffect, useRef } from 'react';
import type { Competition, Fencer, Pool } from '../../../shared/types';
import type { TableauMatch } from '../../../shared/domain/tableau/tableauTypes';
import { DT_BLACK_CARD_REPORT_EVENT } from '../../services/dtCallEvents';
import type { DtBlackCardReportDetail } from '../../services/dtCallEvents';
import { exportBlackCardReport } from '../../services/blackCardReport';
import { logger, LogCategory } from '@shared/services/logger';

export function useBlackCardReportRequest(
  competition: Competition,
  fencers: Fencer[],
  pools: Pool[],
  tableauMatches: TableauMatch[]
): void {
  const data = useRef({ competition, fencers, pools, tableauMatches });
  useEffect(() => {
    data.current = { competition, fencers, pools, tableauMatches };
  });

  useEffect(() => {
    const onRequest = (e: Event) => {
      const detail = (e as CustomEvent<DtBlackCardReportDetail>).detail;
      const d = data.current;
      if (!detail || (detail.competitionId && detail.competitionId !== d.competition.id)) return;
      detail.handled = true;
      void exportBlackCardReport(
        d.competition,
        d.fencers,
        d.pools,
        d.tableauMatches,
        detail.fencerId ? [detail.fencerId] : undefined
      ).catch(err =>
        logger.error(LogCategory.UI, '[BlackCardReport] export impossible', err as Error)
      );
    };
    window.addEventListener(DT_BLACK_CARD_REPORT_EVENT, onRequest);
    return () => window.removeEventListener(DT_BLACK_CARD_REPORT_EVENT, onRequest);
  }, []);
}
