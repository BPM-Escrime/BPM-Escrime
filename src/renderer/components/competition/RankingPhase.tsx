/**
 * BPM - Escrime - Phase « Classement » de la compétition (extrait de CompetitionView, #1599)
 * Licensed under GPL-3.0
 */
import React from 'react';
import type { Fencer, Pool, PoolRanking, Weapon } from '../../../shared/types';
import TeamRankingPanel from '../../../features/teamEntry/TeamRankingPanel';
import type { TeamRankingStats } from '../../../features/teamEntry/TeamRankingPanel';
import type { RankingFilterKey } from '../../../shared/domain/ranking/rankingFilters';
import { poolNumbersOf } from '../../../shared/domain/pools/poolNumbers';
import PoolRankingView from '../PoolRankingView';

type RankingViewProps = React.ComponentProps<typeof PoolRankingView>;

interface RankingPhaseProps {
  poolRoundSelector: React.ReactNode;
  /** Tour terminé consulté (lecture seule) ; null = tour courant */
  viewedPoolRound: number | null;
  viewedRoundPools: Pool[] | null;
  computeOverallRanking: (pools: Pool[]) => PoolRanking[];
  pools: Pool[];
  overallRanking: PoolRanking[];
  weapon: Weapon;
  competitionTitle: string;
  hasDirectElimination: boolean;
  skipPoolPhase: boolean;
  poolWinnersOnly: boolean;
  postPoolSplitCriteria: RankingViewProps['splitCriteria'];
  splitOffCompetitionIds: RankingViewProps['splitOffGroups'];
  onGoToTableau: RankingViewProps['onGoToTableau'];
  onGoToResults: () => void;
  onPoolsChange: RankingViewProps['onPoolsChange'];
  onRankingChange: (ranking: PoolRanking[]) => void;
  onSplitOff: RankingViewProps['onSplitOff'];
  nextRoundAction: RankingViewProps['nextRoundAction'];
  /** Bouton tableau déplacé dans la barre du haut (#2008) */
  tableauActionInNav?: boolean;
  /** Tableau tiré : classement figé (#1996) */
  rankingFrozen?: boolean;
  /** Entrée en équipes (binômes) : classement des équipes avec filtres (docs/adr/0043) */
  isTeamEntry: boolean;
  launchedWave: number;
  /** Équipes : tireurs de l'épreuve, membres, niveau, HANDI portés par le tireur */
  teamFencers: Fencer[];
  teamStats: Map<string, TeamRankingStats>;
  /** Libellés des niveaux de la formule (`entry.levels`) */
  teamLevels?: readonly string[];
  /** Filtres du classement de la formule (docs/adr/0043, F4d) */
  rankingFilters: RankingFilterKey[];
}

const RankingPhase: React.FC<RankingPhaseProps> = ({
  poolRoundSelector,
  viewedPoolRound,
  viewedRoundPools,
  computeOverallRanking,
  pools,
  overallRanking,
  weapon,
  competitionTitle,
  hasDirectElimination,
  skipPoolPhase,
  poolWinnersOnly,
  postPoolSplitCriteria,
  splitOffCompetitionIds,
  onGoToTableau,
  onGoToResults,
  onPoolsChange,
  onRankingChange,
  onSplitOff,
  nextRoundAction,
  tableauActionInNav,
  rankingFrozen,
  isTeamEntry,
  launchedWave,
  teamFencers,
  teamStats,
  teamLevels,
  rankingFilters,
}) => (
  <>
    {poolRoundSelector}
    {viewedRoundPools && (
      <PoolRankingView
        key={`round-${viewedPoolRound}`}
        pools={viewedRoundPools}
        ranking={computeOverallRanking(viewedRoundPools)}
        weapon={weapon}
        hasDirectElimination={hasDirectElimination}
        teamEntry={isTeamEntry}
      />
    )}
    {!viewedRoundPools && (
      <PoolRankingView
        pools={pools}
        ranking={overallRanking}
        weapon={weapon}
        hasDirectElimination={hasDirectElimination}
        isInitialRanking={skipPoolPhase}
        teamEntry={isTeamEntry}
        onGoToTableau={onGoToTableau}
        onGoToResults={onGoToResults}
        onPoolsChange={onPoolsChange}
        onRankingChange={onRankingChange}
        poolWinnersOnly={poolWinnersOnly}
        splitCriteria={postPoolSplitCriteria}
        splitOffGroups={splitOffCompetitionIds}
        onSplitOff={onSplitOff}
        nextRoundAction={nextRoundAction}
        tableauActionInNav={tableauActionInNav}
        rankingFrozen={rankingFrozen}
      />
    )}
    {isTeamEntry && !viewedRoundPools && (
      <TeamRankingPanel
        competitionTitle={competitionTitle}
        wave={launchedWave}
        ranked={overallRanking.map(r => ({ teamId: r.fencer.id, rank: r.rank }))}
        fencers={teamFencers}
        stats={teamStats}
        poolOf={poolNumbersOf(pools)}
        filterKeys={rankingFilters}
        levels={teamLevels}
      />
    )}
  </>
);

export default React.memo(RankingPhase);
