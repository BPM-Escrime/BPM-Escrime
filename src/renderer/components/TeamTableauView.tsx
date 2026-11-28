/**
 * BPM - Escrime - Tableau équipes (élimination directe)
 * Composant présentationnel : reconstruit l'arbre à partir de round/position
 * (pas d'arbre séparé à persister) et réutilise TeamPoolView pour la saisie
 * de score de chaque match réel (mêmes règles arme-aware : cible progressive,
 * touche double épée, zones Sabre Laser, cartons). Rencontres tirées et avancées par le
 * moteur (generateTeamTableau, recordRelayScore) : le tableau se tire par le bouton, jamais à
 * l'ouverture (docs/adr/0024, lot E3) ; exempts et cases en attente affichés d'après le
 * placement du classement de poule. Petite finale (case round 1, position 1, docs/adr/0044)
 * affichée après la finale.
 * Licensed under GPL-3.0
 */

import React from 'react';
import { CardReason } from '../../shared/types';
import { TeamRow, TeamMatchRow, TeamBoutRow } from '../../shared/domain/teams/team.types';
import {
  TeamTargetRule,
  calculateTableSize,
  placeRankedTeamsInTable,
  resolveTeamTableauSlot,
} from '../../shared/domain/teams/teamCalculations';
import { LaserArenaBoutCap } from '../../shared/domain/teams/laserArenaCalculations';
import TeamPoolView, { CardHandlers, CardTarget, RelayHandlers } from './TeamPoolView';
import type {
  PassivityCardDTO,
  RelayCardDTO,
  TeamCardDTO,
  TeamWithdrawalDTO,
} from '../hooks/useTeamCompetition';
import { useTranslation } from '../contexts/TranslationContext';

interface Props {
  teams: TeamRow[];
  rankedTeams: TeamRow[]; // placement du tableau (rankTeamsForTableau, comme le moteur)
  tableauMatches: TeamMatchRow[];
  weapon: string;
  targetRule: TeamTargetRule;
  isEpee: boolean;
  isLaserPoints: boolean;
  fencerName: (id: string) => string;
  scoringMatchId: string | null;
  onToggleScoring: (matchId: string) => void;
  onScoreBout: (bout: TeamBoutRow, side: 'A' | 'B' | 'double', points?: number) => void;
  relay: RelayHandlers;
  boutCards: Record<string, RelayCardDTO[]>;
  cardTarget: CardTarget | null;
  onSetCardTarget: (target: CardTarget | null) => void;
  selectedReason: CardReason | '';
  onSelectReason: (reason: CardReason | '') => void;
  onAddCard: (matchId: string) => void;
  onGenerate: () => void;
  isLaserArena?: boolean;
  boutCap?: LaserArenaBoutCap;
  matchCards?: Record<string, TeamCardDTO[]>;
  passivityCards?: Record<string, PassivityCardDTO[]>;
  cards?: CardHandlers;
  withdrawn?: Record<string, TeamWithdrawalDTO>;
  onAssignArena?: (matchId: string, arenaId: string) => void;
}

const ROUND_LABEL_KEYS: Record<number, string> = {
  1: 'tableau.round_final',
  2: 'tableau.round_semifinals',
  4: 'teams.roundQuarterfinals',
  8: 'teams.roundOf16',
  16: 'teams.roundOf32',
  32: 'teams.roundOf64',
};

const TeamTableauView: React.FC<Props> = ({
  teams,
  rankedTeams,
  tableauMatches,
  weapon,
  targetRule,
  isEpee,
  isLaserPoints,
  fencerName,
  scoringMatchId,
  onToggleScoring,
  onScoreBout,
  relay,
  boutCards,
  cardTarget,
  onSetCardTarget,
  selectedReason,
  onSelectReason,
  onAddCard,
  onGenerate,
  isLaserArena,
  boutCap,
  matchCards,
  passivityCards,
  cards,
  withdrawn,
  onAssignArena,
}) => {
  const { t } = useTranslation();

  if (rankedTeams.length < 2) {
    return <div className="text-center text-gray-400 py-10">{t('teams.tableauNeedTwo')}</div>;
  }

  if (tableauMatches.length === 0) {
    return (
      <div className="text-center py-10">
        <p className="text-gray-400 mb-4">{t('teams.tableauNone')}</p>
        <button
          onClick={onGenerate}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
        >
          {t('teams.tableauGenerate', { count: rankedTeams.length })}
        </button>
      </div>
    );
  }

  const tableSize = calculateTableSize(rankedTeams.length);
  const placements = placeRankedTeamsInTable(rankedTeams, tableSize);
  const teamById = new Map(teams.map(team => [team.id, team]));
  const matchesByKey = new Map(tableauMatches.map(m => [`${m.round}-${m.position}`, m]));

  const rounds: number[] = [];
  for (let r = tableSize / 2; r >= 1; r /= 2) rounds.push(r);

  /** Rencontre réelle du tableau : saisie par la vue des rencontres (TeamPoolView) */
  const renderMatch = (match: TeamMatchRow) => (
    <TeamPoolView
      key={match.id}
      teams={teams}
      matches={[match]}
      weapon={weapon}
      targetRule={targetRule}
      isEpee={isEpee}
      isLaserPoints={isLaserPoints}
      fencerName={fencerName}
      scoringMatchId={scoringMatchId}
      onToggleScoring={onToggleScoring}
      onScoreBout={onScoreBout}
      relay={relay}
      boutCards={boutCards}
      cardTarget={cardTarget}
      onSetCardTarget={onSetCardTarget}
      selectedReason={selectedReason}
      onSelectReason={onSelectReason}
      onAddCard={onAddCard}
      emptyLabel=""
      isLaserArena={isLaserArena}
      boutCap={boutCap}
      matchCards={matchCards}
      passivityCards={passivityCards}
      cards={cards}
      withdrawn={withdrawn}
      onAssignArena={onAssignArena}
    />
  );
  // Petite finale (docs/adr/0044) : case round 1, position 1, tirée par le moteur
  const thirdPlace = matchesByKey.get('1-1');

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          onClick={onGenerate}
          className="text-xs px-3 py-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-100"
        >
          ↻ {t('teams.tableauRegenerate')}
        </button>
      </div>
      {rounds.map(round => (
        <div key={round}>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">
            {ROUND_LABEL_KEYS[round]
              ? t(ROUND_LABEL_KEYS[round])
              : t('teams.roundGeneric', { count: round })}
          </h3>
          <div className="space-y-3">
            {Array.from({ length: round }, (_, position) => {
              const slot = resolveTeamTableauSlot(
                round,
                position,
                tableSize,
                placements,
                matchesByKey,
                teamById
              );

              if (slot.isBye) {
                return (
                  <div
                    key={position}
                    className="text-xs text-gray-500 px-3 py-2 bg-gray-50 border border-gray-200 rounded"
                  >
                    {t('teams.bye', { team: slot.team?.name ?? '—' })}
                  </div>
                );
              }

              if (!slot.match) {
                return (
                  <div
                    key={position}
                    className="text-xs text-gray-400 italic px-3 py-2 border border-dashed border-gray-200 rounded"
                  >
                    {t('teams.waitingPrevious')}
                  </div>
                );
              }

              return renderMatch(slot.match);
            })}
          </div>
        </div>
      ))}
      {thirdPlace && (
        <div data-testid="team-third-place">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">
            {t('tableau.round_third_place')}
          </h3>
          {renderMatch(thirdPlace)}
        </div>
      )}
    </div>
  );
};

export default TeamTableauView;
