/**
 * BPM - Escrime - Tournoi des rapières : statistiques d'équipe et migration v1 (extrait de
 * CompetitionView, #1599). Les vagues sont celles de tout tour en vagues (usePoolWavesView,
 * docs/adr/0043).
 * Licensed under GPL-3.0
 */
import { useEffect, useMemo, useRef } from 'react';
import { FencerStatus, Gender } from '../../shared/types';
import type { Fencer, PoolRanking } from '../../shared/types';
import { logger, LogCategory } from '@shared/services/logger';
import type { useFencerManagement } from '../../renderer/hooks/useFencerManagement';
import { createRapieresSession } from '../../shared/domain/rapieres/rapieres.types';
import type { RapieresTeamInfo } from '../../shared/domain/rapieres/rapieres.types';
import type { RapieresTeamStats } from './RapieresRankingPanel';
import type { useRapieresSessionState } from './useRapieresSessionState';
import type { useRapieresTeams } from './useRapieresTeams';

type SessionState = ReturnType<typeof useRapieresSessionState>;

interface UseRapieresCompetitionParams {
  isRapieres: boolean;
  isLoaded: boolean;
  fencers: Fencer[];
  overallRanking: PoolRanking[];
  rapieresState: SessionState['rapieresState'];
  setRapieresState: SessionState['setRapieresState'];
  bulkAddFencers: ReturnType<typeof useFencerManagement>['bulkAddFencers'];
  rapieresFencerFields: ReturnType<typeof useRapieresTeams>['rapieresFencerFields'];
}

/** Statistiques d'équipe et migration v1 du tournoi des rapières. */
export function useRapieresCompetition({
  isRapieres,
  isLoaded,
  fencers,
  overallRanking,
  rapieresState,
  setRapieresState,
  bulkAddFencers,
  rapieresFencerFields,
}: UseRapieresCompetitionParams) {
  // Migration de la première version (vue dédiée) : équipes recréées comme tireurs
  const rapieresMigrating = useRef(false);
  useEffect(() => {
    if (!isRapieres || !isLoaded || rapieresState?.version !== 1 || rapieresMigrating.current)
      return;
    rapieresMigrating.current = true;
    const legacy = rapieresState;
    const LEGACY_STATUS: Record<string, FencerStatus> = {
      checked_in: FencerStatus.CHECKED_IN,
      abandoned: FencerStatus.ABANDONED,
      forfait: FencerStatus.FORFAIT,
      excluded: FencerStatus.EXCLUDED,
    };
    (async () => {
      const teams: Record<string, RapieresTeamInfo> = {};
      if (fencers.length === 0 && legacy.teams.length > 0) {
        const added = await bulkAddFencers(
          legacy.teams.map(
            tm =>
              ({
                ...rapieresFencerFields({
                  name: tm.name,
                  info: { level: tm.level, fencers: tm.fencers },
                }),
                gender: Gender.MIXED,
                nationality: 'FRA',
                status: LEGACY_STATUS[tm.status ?? 'checked_in'] ?? FencerStatus.NOT_CHECKED_IN,
              }) as Omit<Fencer, 'id' | 'createdAt' | 'updatedAt'>
          )
        );
        added.forEach((f, i) => {
          teams[f.id] = { level: legacy.teams[i].level, fencers: legacy.teams[i].fencers };
        });
      }
      setRapieresState({ ...createRapieresSession(), teams });
    })().catch(error => {
      rapieresMigrating.current = false;
      logger.error(LogCategory.UI, 'Rapières : migration impossible', error as Error);
    });
  }, [isRapieres, isLoaded, rapieresState, fencers.length]);

  // Statistiques de poule par équipe (classements rapières)
  const rapieresStats = useMemo(
    () =>
      new Map<string, RapieresTeamStats>(
        overallRanking.map(r => [
          r.fencer.id,
          {
            victories: r.victories,
            matches: r.matchesPlayed,
            index: r.index,
            touchesGiven: r.touchesScored,
          },
        ])
      ),
    [overallRanking]
  );

  return { rapieresStats };
}
