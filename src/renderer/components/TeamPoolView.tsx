/**
 * BPM - Escrime - Vue poule équipes
 * Composant présentationnel : l'état (matchs, cartons, sélection) est possédé
 * par le parent (TeamManagerView), suivant le même pattern que PoolView/PoolRankingView.
 * Relais (docs/adr/0024, lot E3) : seul le relais en cours se saisit ; « Terminer » l'envoie au
 * moteur, le dernier relais terminé se rouvre, le remplaçant entre par la commande.
 * Cartons (docs/adr/0028, lot C2) : rendus par le moteur (type, points, exclusion), donnés et
 * annulés par les commandes du parent ; aucun barème ni escalade calculé ici. Équipe retirée :
 * mention « Exclue » / « N'a pas terminé », rencontres de poule annulées, rencontres à tirer
 * non saisissables.
 * Licensed under GPL-3.0
 */

import { TipButton } from './Tooltip';
import React, { useState } from 'react';
import { CardReason, TargetZone, Weapon, ZONE_POINTS } from '../../shared/types';
import { TeamRow, TeamMatchRow, TeamBoutRow } from '../../shared/domain/teams/team.types';
import { TeamTargetRule, getRelayCap } from '../../shared/domain/teams/teamCalculations';
import { LaserArenaBoutCap } from '../../shared/domain/teams/laserArenaCalculations';
import { CARD_REASON_LABELS } from '../../shared/utils/cardSystem';
import { getAvailableReasons } from '../../shared/domain/penalties/cards';
import type { RelayCardDTO, TeamCardDTO, TeamWithdrawalDTO } from '../hooks/useTeamCompetition';
import { useConfirm } from './ConfirmDialog';
import { useTranslation } from '../contexts/TranslationContext';
import { Check, DoorOpen, Flag, Radio, Swords, Undo2, UserRoundCog, X } from 'lucide-react';
import { Icon } from './common/Icon';
import EmptyState from './common/EmptyState';
import { CardIcon } from './common/CardIcon';

const TEAM_CARD_TYPES: Array<'white' | 'yellow' | 'red' | 'black'> = [
  'white',
  'yellow',
  'red',
  'black',
];

export interface CardTarget {
  boutId: string;
  fencerId: string;
}

/** Actions de relais du parent, toutes par le contrat (docs/adr/0024) */
export interface RelayHandlers {
  /** Termine le relais en cours avec le score compté à l'écran (recordRelayScore) */
  onEndRelay: (matchId: string, bout: TeamBoutRow) => void;
  /** Rouvre le dernier relais terminé de la rencontre (reopenRelay) */
  onReopenRelay: (matchId: string) => void;
  /** Rencontre dont le dernier relais finit à égalité au tableau : vainqueur à désigner */
  pendingTieMatchId: string | null;
  onResolveTie: (winner: 'A' | 'B') => void;
  /** Le remplaçant de l'équipe entre à la place du tireur sortant (substituteTeamFencer) */
  onSubstitute: (matchId: string, teamId: string, outFencerId: string) => void;
  /** Équipe incomplète sans remplaçant qui abandonne (withdrawTeam, o.99.7.a) ; relais FIE */
  onWithdrawTeam?: (matchId: string, teamId: string) => void;
}

/** Cartons de l'écran, tous par les commandes du parent (docs/adr/0028) */
export interface CardHandlers {
  /** Carton E ; sans type : celui de l'escalade du moteur */
  onAddTeamCard?: (matchId: string, teamId: string, type?: TeamCardDTO['type']) => void;
  /** Annulation par le Directoire technique (cancelTeamCard / cancelRelayCard) */
  onCancelCard?: (matchId: string, cardId: string, kind: 'team' | 'relay') => void;
}

interface Props {
  teams: TeamRow[];
  matches: TeamMatchRow[];
  weapon: string; // Weapon enum value (competition.weapon)
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
  emptyLabel: string;
  // Format arène Sabre Laser uniquement (`isLaserArena`) : plafond d'assaut fixe
  // (5 touches/3min au lieu de la cible progressive FIE) et cartons d'équipe "E"
  // (retard de désignation), distincts des cartons individuels par tireur.
  isLaserArena?: boolean;
  boutCap?: LaserArenaBoutCap;
  matchCards?: Record<string, TeamCardDTO[]>;
  cards?: CardHandlers;
  /** Équipes retirées ou exclues, par équipe */
  withdrawn?: Record<string, TeamWithdrawalDTO>;
  onAssignArena?: (matchId: string, arenaId: string) => void;
}

const TeamPoolView: React.FC<Props> = ({
  teams,
  matches,
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
  emptyLabel,
  isLaserArena = false,
  boutCap,
  matchCards = {},
  cards = {},
  withdrawn = {},
  onAssignArena,
}) => {
  const { prompt } = useConfirm();
  const { t } = useTranslation();
  const teamById = new Map(teams.map(team => [team.id, team]));
  const { onAddTeamCard, onCancelCard } = cards;
  const withdrawnLabel = (teamId: string) => {
    const w = withdrawn[teamId];
    if (!w) return null;
    return (
      <div className="text-xs font-semibold text-red-600">
        {t(w.reason === 'exclusion' ? 'teams.statusExcluded' : 'teams.statusAbandoned')}
      </div>
    );
  };
  const relayCardBadge = (matchId: string, c: RelayCardDTO) => (
    <RelayCardBadge
      key={c.id}
      card={c}
      onCancel={
        onCancelCard && c.type !== 'BLACK' ? () => onCancelCard(matchId, c.id, 'relay') : undefined
      }
    />
  );

  if (matches.length === 0) {
    return emptyLabel ? <EmptyState icon={<Icon icon={Swords} />} title={emptyLabel} /> : null;
  }

  return (
    <div className="space-y-4">
      {matches.map(m => {
        const ta = teamById.get(m.teamAId);
        const tb = teamById.get(m.teamBId);
        // Équipe retirée (o.99.8) : rencontres de poule annulées, rencontres à tirer refusées
        const involvesWithdrawn = !!(withdrawn[m.teamAId] || withdrawn[m.teamBId]);
        const cancelled = involvesWithdrawn && m.poolNumber != null;
        const refused = involvesWithdrawn && m.status !== 'finished';
        const isScoring = scoringMatchId === m.id && !refused;
        // Relais en cours : le premier non terminé ; seul le dernier terminé se rouvre
        const currentOrder = m.bouts.find(b => b.status !== 'finished')?.boutOrder ?? null;
        const lastFinishedOrder = Math.max(
          0,
          ...m.bouts.filter(b => b.status === 'finished').map(b => b.boutOrder)
        );
        const statusColor =
          m.status === 'finished'
            ? 'bg-green-50 border-green-200'
            : m.status === 'in_progress'
              ? 'bg-yellow-50 border-yellow-200'
              : 'bg-white border-gray-200';

        return (
          <div key={m.id} className={`border rounded-lg overflow-hidden ${statusColor}`}>
            {/* Match header */}
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-4 flex-1">
                <div className="text-center flex-1">
                  <div className="font-bold text-gray-900">{ta?.name ?? '—'}</div>
                  <div className="text-xs text-gray-400">{ta?.club}</div>
                  {withdrawnLabel(m.teamAId)}
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-700">
                    {m.scoreBoutsA} – {m.scoreBoutsB}
                  </div>
                  <div
                    className={`text-xs font-medium ${m.status === 'finished' ? 'text-green-600' : m.status === 'in_progress' ? 'text-yellow-600' : 'text-gray-400'}`}
                  >
                    {m.status === 'finished'
                      ? t('teams.matchWon', {
                          team: (m.winnerId === m.teamAId ? ta?.name : tb?.name) ?? '—',
                        })
                      : m.status === 'in_progress'
                        ? t('teams.matchInProgress')
                        : t('teams.matchNotStarted')}
                  </div>
                  {(cancelled || refused) && (
                    <div className="text-xs font-medium text-red-600">
                      {t(cancelled ? 'teams.matchCancelled' : 'teams.matchRefused')}
                    </div>
                  )}
                </div>
                <div className="text-center flex-1">
                  <div className="font-bold text-gray-900">{tb?.name ?? '—'}</div>
                  <div className="text-xs text-gray-400">{tb?.club}</div>
                  {withdrawnLabel(m.teamBId)}
                </div>
              </div>
              {onAssignArena && !refused && (
                <button
                  onClick={async () => {
                    const arenaId = await prompt({
                      message: t('teams.arenaPrompt'),
                      placeholder: '1',
                    });
                    if (arenaId?.trim()) onAssignArena(m.id, arenaId.trim());
                  }}
                  title={t('teams.arenaTooltip')}
                  className="ml-4 text-xs px-3 py-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                >
                  <Icon icon={Radio} /> {t('teams.arenaButton')}
                </button>
              )}
              <button
                onClick={() => onToggleScoring(m.id)}
                disabled={refused}
                className={`ml-4 text-xs px-3 py-1.5 rounded border disabled:opacity-40 ${isScoring ? 'bg-gray-200 border-gray-300 text-gray-700' : 'bg-blue-600 border-blue-600 text-white hover:bg-blue-700'}`}
              >
                {isScoring ? t('actions.close') : t('teams.score')}
              </button>
            </div>

            {/* Assauts */}
            {isScoring && (
              <div className="border-t border-gray-200 px-4 py-3 space-y-1">
                <div className="grid grid-cols-[1fr_auto_1fr] text-xs text-gray-500 font-medium mb-2">
                  <span>{ta?.name}</span>
                  <span className="text-center w-24">{t('teams.bout')}</span>
                  <span className="text-right">{tb?.name}</span>
                </div>
                {m.bouts.map(bout => {
                  const fa = fencerName(bout.fencerAId);
                  const fb = fencerName(bout.fencerBId);
                  const done = bout.status === 'finished';
                  const current = bout.boutOrder === currentOrder;
                  const locked = done || !current;
                  const cap = isLaserArena
                    ? (boutCap?.maxTouches ?? 5)
                    : Math.min(
                        getRelayCap(bout.boutOrder - 1, targetRule.stepSize),
                        targetRule.target
                      );
                  const cardsA = (boutCards[bout.id] ?? []).filter(
                    c => c.fencerId === bout.fencerAId
                  );
                  const cardsB = (boutCards[bout.id] ?? []).filter(
                    c => c.fencerId === bout.fencerBId
                  );

                  return (
                    <React.Fragment key={bout.id}>
                      <div
                        className={`grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-1.5 px-2 rounded ${done ? 'bg-gray-50 opacity-70' : 'bg-white border border-gray-100'}`}
                      >
                        {/* Côté A */}
                        <div className="flex items-center gap-2">
                          {isLaserPoints ? (
                            <div className="flex gap-0.5">
                              {(
                                [TargetZone.ZONE_A, TargetZone.ZONE_B, TargetZone.ZONE_C] as const
                              ).map(zone => (
                                <TipButton
                                  key={zone}
                                  onClick={() => onScoreBout(bout, 'A', ZONE_POINTS[zone])}
                                  disabled={locked}
                                  tip={t('teams.zoneTooltip', {
                                    zone,
                                    points: ZONE_POINTS[zone],
                                  })}
                                  className="w-6 h-8 text-xs font-bold rounded bg-blue-100 text-blue-800 hover:bg-blue-200 disabled:opacity-40 flex-shrink-0"
                                >
                                  {zone}
                                </TipButton>
                              ))}
                            </div>
                          ) : (
                            <button
                              aria-label={t('actions.add')}
                              onClick={() => onScoreBout(bout, 'A')}
                              disabled={locked}
                              className="w-8 h-8 text-sm font-bold rounded-full bg-blue-100 text-blue-800 hover:bg-blue-200 disabled:opacity-40 flex-shrink-0"
                            >
                              +
                            </button>
                          )}
                          {current && (
                            <button
                              aria-label={t('teams.removeTouch')}
                              onClick={() => onScoreBout(bout, 'A', -1)}
                              className="w-6 h-6 text-xs rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 flex-shrink-0"
                            >
                              −
                            </button>
                          )}
                          <span className="text-sm font-medium truncate">{fa}</span>
                          {cardsA.map(c => relayCardBadge(m.id, c))}
                          <TipButton
                            onClick={() =>
                              onSetCardTarget(
                                cardTarget?.boutId === bout.id &&
                                  cardTarget.fencerId === bout.fencerAId
                                  ? null
                                  : { boutId: bout.id, fencerId: bout.fencerAId }
                              )
                            }
                            tip={t('teams.addCard')}
                            className="text-[10px] text-gray-400 hover:text-gray-600 flex-shrink-0"
                          >
                            <Icon icon={Flag} />
                          </TipButton>
                        </div>
                        {/* Score */}
                        <div className="text-center w-24">
                          <span
                            className={`font-mono text-sm font-bold ${done ? (bout.winnerId === bout.fencerAId ? 'text-green-600' : 'text-red-500') : 'text-gray-700'}`}
                          >
                            {bout.scoreA}
                          </span>
                          <span className="text-gray-400 mx-1">–</span>
                          <span
                            className={`font-mono text-sm font-bold ${done ? (bout.winnerId === bout.fencerBId ? 'text-green-600' : 'text-red-500') : 'text-gray-700'}`}
                          >
                            {bout.scoreB}
                          </span>
                          <div className="text-xs text-gray-400">
                            /{cap} · A{bout.boutOrder}
                          </div>
                          {current && (
                            <button
                              onClick={() => relay.onEndRelay(m.id, bout)}
                              className="mt-0.5 text-[10px] px-1.5 py-0.5 rounded border border-green-200 text-green-700 bg-green-50 hover:bg-gray-100"
                            >
                              <Icon icon={Check} /> {t('teams.endRelay')}
                            </button>
                          )}
                          {isEpee && (
                            <button
                              onClick={() => onScoreBout(bout, 'double')}
                              disabled={locked}
                              title={t('teams.doubleTooltip')}
                              className="mt-0.5 text-[10px] px-1.5 py-0.5 rounded border border-purple-300 text-purple-700 bg-purple-50 hover:bg-purple-100 disabled:opacity-40"
                            >
                              <Icon icon={Swords} /> {t('teams.double')}
                            </button>
                          )}
                        </div>
                        {/* Côté B */}
                        <div className="flex items-center gap-2 justify-end">
                          <TipButton
                            onClick={() =>
                              onSetCardTarget(
                                cardTarget?.boutId === bout.id &&
                                  cardTarget.fencerId === bout.fencerBId
                                  ? null
                                  : { boutId: bout.id, fencerId: bout.fencerBId }
                              )
                            }
                            tip={t('teams.addCard')}
                            className="text-[10px] text-gray-400 hover:text-gray-600 flex-shrink-0"
                          >
                            <Icon icon={Flag} />
                          </TipButton>
                          {cardsB.map(c => relayCardBadge(m.id, c))}
                          <span className="text-sm font-medium truncate text-right">{fb}</span>
                          {current && (
                            <button
                              aria-label={t('teams.removeTouch')}
                              onClick={() => onScoreBout(bout, 'B', -1)}
                              className="w-6 h-6 text-xs rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 flex-shrink-0"
                            >
                              −
                            </button>
                          )}
                          {isLaserPoints ? (
                            <div className="flex gap-0.5">
                              {(
                                [TargetZone.ZONE_A, TargetZone.ZONE_B, TargetZone.ZONE_C] as const
                              ).map(zone => (
                                <TipButton
                                  key={zone}
                                  onClick={() => onScoreBout(bout, 'B', ZONE_POINTS[zone])}
                                  disabled={locked}
                                  tip={t('teams.zoneTooltip', {
                                    zone,
                                    points: ZONE_POINTS[zone],
                                  })}
                                  className="w-6 h-8 text-xs font-bold rounded bg-blue-100 text-blue-800 hover:bg-blue-200 disabled:opacity-40 flex-shrink-0"
                                >
                                  {zone}
                                </TipButton>
                              ))}
                            </div>
                          ) : (
                            <button
                              aria-label={t('actions.add')}
                              onClick={() => onScoreBout(bout, 'B')}
                              disabled={locked}
                              className="w-8 h-8 text-sm font-bold rounded-full bg-blue-100 text-blue-800 hover:bg-blue-200 disabled:opacity-40 flex-shrink-0"
                            >
                              +
                            </button>
                          )}
                          {done && bout.boutOrder === lastFinishedOrder && (
                            <TipButton
                              onClick={() => relay.onReopenRelay(m.id)}
                              className="w-6 h-6 text-xs rounded text-red-400 hover:text-red-600 flex-shrink-0"
                              tip={t('teams.reopenRelay')}
                            >
                              <Icon icon={Undo2} />
                            </TipButton>
                          )}
                        </div>
                      </div>
                      {cardTarget?.boutId === bout.id && (
                        <div className="flex items-center gap-2 px-2 py-1.5 bg-yellow-50 border border-yellow-200 rounded text-xs">
                          <span className="text-gray-600">
                            {t('teams.cardFor', { name: fencerName(cardTarget.fencerId) })}
                          </span>
                          <select
                            aria-label={t('teams.reasonPlaceholder')}
                            value={selectedReason}
                            onChange={e => onSelectReason(e.target.value as CardReason)}
                            className="border border-gray-300 rounded px-1.5 py-1 text-xs"
                          >
                            <option value="">{t('teams.reasonPlaceholder')}</option>
                            {getAvailableReasons(weapon as Weapon).map(reason => (
                              <option key={reason} value={reason}>
                                {CARD_REASON_LABELS[reason]}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => onAddCard(m.id)}
                            disabled={!selectedReason}
                            className="px-2 py-1 bg-yellow-600 text-white rounded disabled:opacity-40"
                          >
                            {t('actions.add')}
                          </button>
                          <button
                            onClick={() => onSetCardTarget(null)}
                            className="text-gray-400 hover:text-gray-600"
                          >
                            {t('actions.cancel')}
                          </button>
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}
                {relay.pendingTieMatchId === m.id && (
                  <div className="mt-2 flex items-center gap-2 flex-wrap px-2 py-1.5 bg-yellow-50 border border-yellow-200 rounded text-xs">
                    <span className="text-gray-700">{t('teams.tieNeedsWinner')}</span>
                    {(
                      [
                        ['A', ta],
                        ['B', tb],
                      ] as const
                    ).map(([side, team]) => (
                      <button
                        key={side}
                        onClick={() => relay.onResolveTie(side)}
                        className="px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                      >
                        {t('teams.priorityWinner', { team: team?.name ?? side })}
                      </button>
                    ))}
                  </div>
                )}
                {currentOrder !== null && (
                  <div className="mt-2 pt-2 border-t border-gray-200 grid grid-cols-2 gap-3 text-xs">
                    {(
                      [
                        ['A', ta],
                        ['B', tb],
                      ] as const
                    ).map(([side, team]) =>
                      team && team.fencers.some(f => f.isReserve) ? (
                        <SubstitutePicker
                          key={side}
                          side={side}
                          team={team}
                          fencerIds={[
                            ...new Set(
                              m.bouts
                                .filter(b => b.status !== 'finished')
                                .map(b => (side === 'A' ? b.fencerAId : b.fencerBId))
                            ),
                          ]}
                          fencerName={fencerName}
                          onSubstitute={out => relay.onSubstitute(m.id, team.id, out)}
                        />
                      ) : (
                        <div key={side} />
                      )
                    )}
                  </div>
                )}
                {!isLaserArena && relay.onWithdrawTeam && m.status !== 'finished' && (
                  <div className="mt-2 pt-2 border-t border-gray-200 grid grid-cols-2 gap-3 text-xs">
                    {[['A', ta] as const, ['B', tb] as const].map(([side, team]) => (
                      <div key={side} className={side === 'B' ? 'text-right' : ''}>
                        {team && !withdrawn[team.id] && (
                          <TipButton
                            onClick={() => relay.onWithdrawTeam?.(m.id, team.id)}
                            tip={t('teams.withdrawTeamTooltip')}
                            className="px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50"
                          >
                            <Icon icon={DoorOpen} /> {t('teams.withdrawTeam', { team: team.name })}
                          </TipButton>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {isLaserArena && onAddTeamCard && (
                  <div className="mt-2 pt-2 border-t border-gray-200 grid grid-cols-2 gap-3 text-xs">
                    {[['A', ta, m.teamAId] as const, ['B', tb, m.teamBId] as const].map(
                      ([side, team, teamId]) => {
                        const teamCards = (matchCards[m.id] ?? []).filter(c => c.teamId === teamId);
                        return (
                          <div key={side} className={side === 'B' ? 'text-right' : ''}>
                            <div className="text-gray-500 mb-1">
                              {t('teams.teamCardsTitle', { team: team?.name ?? '—' })}
                            </div>
                            <div
                              className={`flex items-center gap-1 flex-wrap ${side === 'B' ? 'justify-end' : ''}`}
                            >
                              <TipButton
                                onClick={() => onAddTeamCard(m.id, teamId)}
                                tip={t('teams.teamCardEscalateTooltip')}
                                className="px-1.5 py-0.5 rounded border border-blue-400 text-blue-700 hover:bg-blue-50"
                              >
                                {t('teams.teamCardEscalate')}
                              </TipButton>
                              {TEAM_CARD_TYPES.map(type => (
                                <TipButton
                                  key={type}
                                  onClick={() => onAddTeamCard(m.id, teamId, type)}
                                  tip={t('teams.teamCardTooltip', { type })}
                                  className="px-1.5 py-0.5 rounded border border-gray-200 hover:bg-gray-50"
                                >
                                  <CardIcon type={type} />
                                </TipButton>
                              ))}
                              {teamCards.map(c => (
                                <span key={c.id} className="inline-flex items-center">
                                  <CardIcon
                                    type={c.type}
                                    label={t('teams.teamCardTooltip', { type: c.type })}
                                  />
                                  {onCancelCard && (
                                    <TipButton
                                      onClick={() => onCancelCard(m.id, c.id, 'team')}
                                      tip={t('teams.cancelCard')}
                                      className="text-gray-400 hover:text-red-600"
                                    >
                                      <Icon icon={X} />
                                    </TipButton>
                                  )}
                                </span>
                              ))}
                            </div>
                          </div>
                        );
                      }
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

/**
 * Carton d'un relais : type et points rendus par le moteur ; motif nul = carton de l'appareil de
 * piste, groupe à compléter (ADR-0028 q. 6). Bouton d'annulation (Directoire technique) sauf noir.
 */
const RelayCardBadge: React.FC<{ card: RelayCardDTO; onCancel?: () => void }> = ({
  card,
  onCancel,
}) => {
  const { t } = useTranslation();
  const reason = card.reason
    ? (CARD_REASON_LABELS[card.reason as CardReason] ?? card.reason)
    : t('teams.cardNoGroup');
  const title =
    card.pointsAwarded > 0
      ? t('teams.cardPointsAwarded', { reason, points: card.pointsAwarded })
      : reason;
  return (
    <span className="inline-flex items-center flex-shrink-0" title={title}>
      <CardIcon type={card.type} label={title} />
      {card.pointsAwarded > 0 && (
        <span className="text-[10px] text-gray-500">+{card.pointsAwarded}</span>
      )}
      {onCancel && (
        <TipButton
          onClick={onCancel}
          tip={t('teams.cancelCard')}
          className="text-[10px] text-gray-400 hover:text-red-600"
        >
          <Icon icon={X} />
        </TipButton>
      )}
    </span>
  );
};

/** Remplacement : tireur sortant choisi parmi ceux des relais à tirer de l'équipe */
const SubstitutePicker: React.FC<{
  side: 'A' | 'B';
  team: TeamRow;
  fencerIds: string[];
  fencerName: (id: string) => string;
  onSubstitute: (outFencerId: string) => void;
}> = ({ side, team, fencerIds, fencerName, onSubstitute }) => {
  const { t } = useTranslation();
  const [out, setOut] = useState('');
  return (
    <div className={`flex items-center gap-1 flex-wrap ${side === 'B' ? 'justify-end' : ''}`}>
      <select
        aria-label={t('teams.substituteOut', { team: team.name })}
        value={out}
        onChange={e => setOut(e.target.value)}
        className="border border-gray-300 rounded px-1.5 py-1 text-xs"
      >
        <option value="">{t('teams.substituteOut', { team: team.name })}</option>
        {fencerIds.map(id => (
          <option key={id} value={id}>
            {fencerName(id)}
          </option>
        ))}
      </select>
      <button
        onClick={() => {
          if (!out) return;
          onSubstitute(out);
          setOut('');
        }}
        disabled={!out}
        className="px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
      >
        <Icon icon={UserRoundCog} /> {t('teams.substitute')}
      </button>
    </div>
  );
};

export default TeamPoolView;
