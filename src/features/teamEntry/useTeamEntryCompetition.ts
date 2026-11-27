/**
 * BPM - Escrime - Entrée en équipes : statistiques d'équipe et migration de l'ancien état v1
 * du Tournoi des rapières (extrait de CompetitionView, #1599, docs/adr/0043).
 * Licensed under GPL-3.0
 */
import { useEffect, useMemo, useRef } from 'react';
import { FencerStatus, Gender } from '../../shared/types';
import type { Fencer, PoolRanking } from '../../shared/types';
import { logger, LogCategory } from '@shared/services/logger';
import type { useFencerManagement } from '../../renderer/hooks/useFencerManagement';
import { createRapieresSession } from '../../shared/domain/rapieres/rapieres.types';
import type { RapieresTeamInfo } from '../../shared/domain/rapieres/rapieres.types';
import type { TeamRankingStats } from './TeamRankingPanel';
import type { useWavesSessionState } from '../poolWaves/useWavesSessionState';
import type { useTeamImport } from './useTeamImport';

type SessionState = ReturnType<typeof useWavesSessionState>;

interface UseTeamEntryCompetitionParams {
  /** Épreuve en équipes (binômes) : la migration de l'ancien état ne la concerne que si elle existe */
  isTeamEntry: boolean;
  isLoaded: boolean;
  fencers: Fencer[];
  overallRanking: PoolRanking[];
  rapieresState: SessionState['rapieresState'];
  setRapieresState: SessionState['setRapieresState'];
  bulkAddFencers: ReturnType<typeof useFencerManagement>['bulkAddFencers'];
  teamFencerFields: ReturnType<typeof useTeamImport>['teamFencerFields'];
}

/** Statistiques d'équipe et migration de l'ancien état v1 (vue dédiée du Tournoi des rapières). */
export function useTeamEntryCompetition({
  isTeamEntry,
  isLoaded,
  fencers,
  overallRanking,
  rapieresState,
  setRapieresState,
  bulkAddFencers,
  teamFencerFields,
}: UseTeamEntryCompetitionParams) {
  // Migration de la première version (vue dédiée) : équipes recréées comme tireurs
  const migrating = useRef(false);
  useEffect(() => {
    if (!isTeamEntry || !isLoaded || rapieresState?.version !== 1 || migrating.current) return;
    migrating.current = true;
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
                ...teamFencerFields({
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
      migrating.current = false;
      logger.error(
        LogCategory.UI,
        'Équipes : migration de l’ancien état impossible',
        error as Error
      );
    });
  }, [isTeamEntry, isLoaded, rapieresState, fencers.length]);

  // Statistiques de poule par équipe (classements d'équipes)
  const teamStats = useMemo(
    () =>
      new Map<string, TeamRankingStats>(
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

  return { teamStats };
}
