/**
 * BPM - Escrime - Fin d’un match d’arène (enregistrement, historique, match suivant) (#1240)
 * Extrait de RemoteScoreServer : l'état reste dans le serveur, exposé par accesseurs (contexte).
 * Licensed under GPL-3.0
 */
import { recordRemoteEvent } from './remoteEvents';
import { checkFinishedScore, recordFinishedScore, type FinishOutcome } from './scoreCommand';
import { runRemoteCommand } from './remoteCommand';
import type { RemoteScoreServer } from '../remoteScoreServer';
import type { ArenaEventList } from '../remoteScoreServer';
import { getSharedMainWindow } from '../mainWindowRef';
import { logger, LogCategory } from '../../shared/services/logger';
import type { SessionScore } from './types';
import {
  checkPrevEligibility,
  restoreForCorrection,
  type LastFinishedSnapshot,
  type PrevRefusal,
} from './prevMatch';
import type { ArenaMatch } from '../../shared/types/remote';
import { winnerByScore } from '../../shared/domain/match/matchEndValidation';
import { notifyScreen, notifyTraining } from './remoteActivity';

type S = RemoteScoreServer;

/** État et services du serveur utilisés par ce module (accesseurs : valeurs toujours à jour). */
/** Score en mémoire marqué victoire (objet Score), sinon false */
const isVictory = (s: SessionScore): boolean => typeof s === 'object' && !!s?.isVictory;

export interface MatchFinishContext {
  readonly arenaCards: S['arenaCards'];
  readonly arenaEventTimes: S['arenaEventTimes'];
  readonly arenaExits: S['arenaExits'];
  readonly arenaMatchQueue: S['arenaMatchQueue'];
  readonly arenaRefereeSelected: S['arenaRefereeSelected'];
  readonly arenaTouches: S['arenaTouches'];
  readonly arenas: S['arenas'];
  readonly assignMatchToArena: S['assignMatchToArena'];
  readonly broadcastArenaUpdate: S['broadcastArenaUpdate'];
  readonly broadcastDashboardUpdate: S['broadcastDashboardUpdate'];
  readonly createTrainingMatch: S['createTrainingMatch'];
  readonly db: S['db'];
  readonly fireWebhook: S['fireWebhook'];
  readonly isTrainingMode: S['isTrainingMode'];
  readonly loadNextMatch: S['loadNextMatch'];
  readonly peekNextMatch: S['peekNextMatch'];
  readonly persistArenaState: S['persistArenaState'];
  readonly recentMatchDurationsMs: S['recentMatchDurationsMs'];
  readonly resolveDbMatchId: S['resolveDbMatchId'];
  readonly logDiag: S['logDiag'];
  readonly session: S['session'];
  readonly sessionMatchScores: S['sessionMatchScores'];
  readonly sessionModernRules: S['sessionModernRules'];
  readonly sessionWeapon: S['sessionWeapon'];
  readonly trainingHistory: S['trainingHistory'];
}

/** Fin d'un match d'entraînement : écouteurs du process principal (Mode Club #1872) */
export type TrainingFinishRecord = S['trainingHistory'][number];
export const trainingFinishListeners = new Set<(record: TrainingFinishRecord) => void>();

/**
 * Dernier match terminé, par objet arène (PREV, #1829). Lié à l'objet : une réinitialisation
 * des arènes le supprime sans purge explicite.
 */
const lastFinished = new WeakMap<object, LastFinishedSnapshot>();

/** Mémorise le dernier match terminé d'une arène (appelé à la fin de match) */
export function rememberLastFinished(arena: object, snapshot: LastFinishedSnapshot): void {
  lastFinished.set(arena, snapshot);
}

/**
 * PREV (#1829) : rappelle le dernier match terminé de la piste pour correction, dans la fenêtre
 * bornée de `prevMatch.ts`. Un match DE non commencé repasse en tête de file (les pools sont
 * relues par la file normale). Renvoie false si le rappel est refusé, sans rien modifier.
 */
export function recallPrevMatch(ctx: MatchFinishContext, arenaId: string): boolean {
  return recallPrevMatchResult(ctx, arenaId).ok;
}

/**
 * Comme `recallPrevMatch`, mais renvoie le motif du refus (`none` / `expired` / `in_progress`,
 * `error` si la base n'a pas pu être purgée) pour que la tablette l'affiche (#2001).
 */
export function recallPrevMatchResult(
  ctx: MatchFinishContext,
  arenaId: string
): { ok: true } | { ok: false; reason: PrevRefusal | 'error' } {
  const arena = ctx.arenas.get(arenaId);
  if (!arena || !ctx.session) return { ok: false, reason: 'none' };
  const snapshot = lastFinished.get(arena);
  const verdict = checkPrevEligibility(snapshot, arena.currentMatch, Date.now());
  if (!verdict.ok || !snapshot) {
    logger.info(
      LogCategory.NETWORK,
      `[RemoteScoreServer] PREV refusé sur arène ${arenaId} : ${verdict.ok ? 'aucun' : verdict.reason}`
    );
    return { ok: false, reason: verdict.ok ? 'none' : verdict.reason };
  }

  const restored = restoreForCorrection(snapshot);
  // Plus de purge des événements en base : la fin de match suivante les remplace d'un bloc
  // (recordMatchEvents, #2175), sans doublon ni échec possible à ce stade

  const pending: ArenaMatch | null = arena.currentMatch;
  if (pending && pending.status !== 'finished' && pending.isTableau) {
    ctx.arenaMatchQueue.set(arenaId, [pending, ...(ctx.arenaMatchQueue.get(arenaId) || [])]);
  }

  const ev = snapshot.events;
  ctx.arenaCards.set(arenaId, ev.cards ?? { cardsA: [], cardsB: [] });
  ctx.arenaTouches.set(arenaId, ev.touches ?? { touchesA: [], touchesB: [] });
  ctx.arenaExits.set(arenaId, [...ev.exits]);
  if (ev.times) ctx.arenaEventTimes.set(arenaId, ev.times);
  else ctx.arenaEventTimes.delete(arenaId);
  lastFinished.delete(arena);

  ctx.assignMatchToArena(arenaId, restored);
  logger.info(
    LogCategory.NETWORK,
    `[RemoteScoreServer] PREV : match ${restored.id} rendu à l'arène ${arenaId} pour correction`
  );
  return { ok: true };
}

/**
 * Exclusion signalée par l'appareil (statut E, #1829), déjà écrite par recordScore avec le score
 * (docs/adr/0016) : notification au renderer et appel DT, comme le carton noir de la tablette
 * (remote/routes/matchRoutes.ts). Annulable depuis la tablette (motif `black_card`).
 */
function applyDeviceExclusion(
  ctx: MatchFinishContext,
  arenaId: string,
  match: ArenaMatch,
  side: 'A' | 'B'
): void {
  const culprit = side === 'A' ? match.fencerA : match.fencerB;
  if (!culprit?.id) return;
  const mainWin = getSharedMainWindow();
  if (mainWin) {
    notifyScreen({
      kind: 'fencer_excluded',
      competitionId: ctx.session?.competitionId ?? null,
      fencerId: culprit.id,
      matchId: match.id,
      reason: 'black_card',
    });
  }
  recordRemoteEvent(ctx, {
    type: 'dt_call',
    arenaId,
    matchId: match.id,
    refereeId: match.referee?.id ?? null,
    detail: 'black_card',
  });
  notifyScreen({
    kind: 'dt_call',
    arenaId,
    arenaNumber: ctx.arenas.get(arenaId)?.number ?? null,
    matchNumber: (match as { number?: number }).number ?? null,
    competitionId: ctx.session?.competitionId ?? null,
    timestamp: Date.now(),
    reason: 'black_card',
    fencerName: `${culprit.lastName ?? ''} ${culprit.firstName ?? ''}`.trim() || null,
  });
}

/**
 * Abandon signalé par l'appareil (statut A, #1829) : le DT décide. Jamais de changement automatique
 * du statut (décision médicale, t.45.1) ; l'appel apparaît dans le panneau DT avec le motif.
 */
function proposeAbandonToDT(
  ctx: MatchFinishContext,
  arenaId: string,
  match: ArenaMatch,
  side: 'A' | 'B'
): void {
  const abandoning = side === 'A' ? match.fencerA : match.fencerB;
  recordRemoteEvent(ctx, {
    type: 'dt_call',
    arenaId,
    matchId: match.id,
    refereeId: match.referee?.id ?? null,
    detail: 'abandon',
  });
  notifyScreen({
    kind: 'dt_call',
    arenaId,
    arenaNumber: ctx.arenas.get(arenaId)?.number ?? null,
    matchNumber: (match as { number?: number }).number ?? null,
    competitionId: ctx.session?.competitionId ?? null,
    timestamp: Date.now(),
    reason: 'abandon',
    fencerId: abandoning?.id ?? null,
    fencerName: abandoning
      ? `${abandoning.lastName ?? ''} ${abandoning.firstName ?? ''}`.trim()
      : null,
  });
}

/** Fin d'arène refusée par le moteur : code du catalogue et message, rien d'écrit (#2151) */
export type FinishRefusal = Extract<FinishOutcome, { kind: 'refused' }>;

/**
 * Termine le match de l'arène. Score écrit d'abord par recordScore : refus → rien d'écrit, arène
 * laissée en cours (match non avancé), refus rendu à l'appelant (tablette : 409) ; null sinon.
 */
export function finishArenaMatch(ctx: MatchFinishContext, arenaId: string): FinishRefusal | null {
  const arena = ctx.arenas.get(arenaId);
  ctx.logDiag(
    `[finishArenaMatch] arena=${arenaId} hasCurrent=${!!arena?.currentMatch} status=${arena?.status} matchId=${arena?.currentMatch?.id} isTableau=${(arena?.currentMatch as { isTableau?: boolean } | undefined)?.isTableau}`
  );
  if (!arena || !arena.currentMatch) return null;
  // Éviter le double-déclenchement (REST + Socket.IO)
  if (arena.status === 'finished') return null;

  const finishedMatch = { ...arena.currentMatch };

  // Score par la commande recordScore (#1980, ADR-0005) : session, base, journal et audit
  // en une transaction ; exclusion (carton noir, statut E) avec le score (docs/adr/0016).
  // Avant tout changement d'état : un refus laisse l'arène en cours (#2151, étape 3)
  const deviceReason = finishedMatch.deviceEnd?.reason;
  const finishWinner = resolveFinishWinner(ctx, finishedMatch);
  // Exclu : carton noir de la tablette, ou statut E de l'appareil (le perdant)
  const culpritSide: 'A' | 'B' | null =
    finishedMatch.blackCardFencer ??
    (deviceReason === 'exclusion' && finishWinner ? (finishWinner === 'A' ? 'B' : 'A') : null);
  const outcome = ctx.isTrainingMode
    ? null
    : recordFinishedScore(ctx.db, {
        competitionId: ctx.session?.competitionId,
        matchId: finishedMatch.id,
        scoreA: finishedMatch.scoreA,
        scoreB: finishedMatch.scoreB,
        winner: culpritSide ? (culpritSide === 'A' ? 'B' : 'A') : finishWinner,
        source: finishedMatch.deviceEnd ? 'cyrano' : 'tablet',
        // Exclusion (carton noir) : score et retrait en une commande (docs/adr/0016). Abandon
        // signalé par l'appareil : score seul, le DT décide du retrait (t.45.1)
        ...(culpritSide ? { specialStatus: 'exclusion' as const, blackCard: true } : {}),
      });
  // Refus après le contrôle de la tablette ou de l'appareil (course, match absent de la
  // session) : rien d'écrit, match laissé en cours ; l'arbitre ou le DT corrige
  if (outcome?.kind === 'refused') {
    logger.error(
      LogCategory.NETWORK,
      `[finishArenaMatch] ${finishedMatch.id} : score refusé par le moteur (${outcome.code}), non enregistré`
    );
    return outcome;
  }
  const recorded = outcome?.kind === 'accepted';

  // Réinitialiser le flag de sélection arbitre (match terminé)
  ctx.arenaRefereeSelected.set(arenaId, false);

  arena.status = 'finished';
  arena.currentMatch.status = 'finished';
  arena.currentMatch.endTime = new Date();

  if (arena.startTime) {
    const wallMs = new Date().getTime() - arena.startTime.getTime();
    // Durée = temps de combat cumulé (périodes, chrono remis à 3:00 après repos) si la
    // tablette l'a remonté ; sinon horloge murale début → fin (#1817)
    const fight = arena.currentMatch.fightSeconds;
    arena.currentMatch.duration =
      fight && fight > 0 ? Math.min(fight, Math.floor(wallMs / 1000)) : Math.floor(wallMs / 1000);
    // Durées réelles pour l'estimation de fin de phase (#1077)
    ctx.recentMatchDurationsMs.push(wallMs);
    if (ctx.recentMatchDurationsMs.length > 50) ctx.recentMatchDurationsMs.shift();
  }

  // Dernier match terminé : rappelable par PREV pendant la fenêtre de correction (#1829)
  if (!ctx.isTrainingMode)
    rememberLastFinished(arena, {
      match: { ...arena.currentMatch },
      finishedAt: Date.now(),
      events: {
        cards: ctx.arenaCards.get(arenaId),
        touches: ctx.arenaTouches.get(arenaId),
        exits: [...(ctx.arenaExits.get(arenaId) ?? [])],
        times: ctx.arenaEventTimes.get(arenaId),
      },
    });

  // Persistance secondaire (timing / cartons / touches / sorties) : ces écritures
  // utilisent arena.currentMatch.id qui, pour un match de tableau, n'est PAS l'id DB
  // (stocké en composite). Une éventuelle exception (ex: contrainte FK) NE DOIT PAS
  // empêcher l'avis match_finished vers le renderer (sinon : vainqueur jamais
  // remonté, pas de passage au tour suivant). On isole donc tout ce bloc.
  if (!ctx.isTrainingMode)
    try {
      // Id DB du match : composite pour un match de tableau (sinon FK rejetée → journal vide, #1031)
      const matchId = ctx.resolveDbMatchId(arena.currentMatch);
      const competitionId = ctx.session?.competitionId;
      if (matchId && competitionId) {
        const now = new Date().toISOString();
        const times = ctx.arenaEventTimes.get(arenaId);
        // Horodatage réel de l'événement (replay #1074), sinon fin de match
        const timeOf = (list: ArenaEventList, i: number) => times?.[list][i] ?? now;
        const uid = (fencerId: string, kind: string, i: number) =>
          `${matchId}-${fencerId}-${kind}-${i}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const sides = [
          ['A', arena.currentMatch.fencerA?.id],
          ['B', arena.currentMatch.fencerB?.id],
        ] as const;
        const cardLists = ctx.arenaCards.get(arenaId) ?? { cardsA: [], cardsB: [] };
        const touchLists = ctx.arenaTouches.get(arenaId) ?? { touchesA: [], touchesB: [] };
        const ZONE_POINTS: Record<string, number> = { A: 1, B: 3, C: 5 };
        const cards = sides.flatMap(([side, fencerId]) =>
          fencerId
            ? cardLists[`cards${side}`].map((cardType, i) => ({
                id: uid(fencerId, cardType, i),
                fencerId,
                cardType,
                reason: 'unknown',
                cardGroup: 1,
                timestamp: timeOf(`cards${side}`, i),
                pointsAwarded: 0,
                resultingExclusion: false,
              }))
            : []
        );
        const touches = sides.flatMap(([side, fencerId]) =>
          fencerId
            ? touchLists[`touches${side}`].map((zone, i) => ({
                id: uid(fencerId, zone, i),
                fencerId,
                zone,
                points: ZONE_POINTS[zone] ?? 1,
                timestamp: timeOf(`touches${side}`, i),
                isValidInSuddenDeath: false,
                isReversed: false,
              }))
            : []
        );
        const exits = (ctx.arenaExits.get(arenaId) ?? []).flatMap((exit, i) => {
          const fencerId =
            exit.fencer === 'A' ? arena.currentMatch!.fencerA?.id : arena.currentMatch!.fencerB?.id;
          return fencerId
            ? [
                {
                  id: uid(fencerId, 'exit', i),
                  fencerId,
                  exitType: exit.isVoluntary
                    ? ('arena_exit_voluntary' as const)
                    : ('arena_exit' as const),
                  timestamp: timeOf('exits', i),
                  // Escrime olympique : une touche ; Sabre Laser : 3 points (#1027)
                  pointsAwarded: ctx.sessionModernRules ? 1 : 3,
                },
              ]
            : [];
        });
        // Commande recordMatchEvents (#2175) : un bloc, dans sa transaction, hors journal
        const run = runRemoteCommand(ctx.db, 'recordMatchEvents', {
          competitionId,
          matchId,
          cards,
          touches,
          exits,
          ...(arena.startTime && arena.currentMatch.endTime
            ? {
                timing: {
                  startTime: arena.startTime.toISOString(),
                  endTime: new Date(arena.currentMatch.endTime).toISOString(),
                  duration: arena.currentMatch.duration ?? 0,
                },
              }
            : {}),
        });
        if (!run.ok) throw new Error(`recordMatchEvents refusée (${run.code})`);
      }
    } catch (e) {
      ctx.logDiag(
        `[finishArenaMatch] persistance secondaire échouée (non bloquant): ${(e as Error)?.message}`
      );
      logger.warn(
        LogCategory.NETWORK,
        '[RemoteScoreServer] Persistance secondaire (timing/cartons/touches) échouée:',
        e
      );
    }

  // Enregistrement mode entraînement (pas de DB)
  if (ctx.isTrainingMode) {
    ctx.trainingHistory.push({
      id: finishedMatch.id,
      arenaId,
      arenaNumber: arena.number,
      weapon: ctx.sessionWeapon ?? '',
      scoreA: finishedMatch.scoreA,
      scoreB: finishedMatch.scoreB,
      durationSec: finishedMatch.duration ?? 0,
      finishedAt: new Date().toISOString(),
    });
    const record = ctx.trainingHistory[ctx.trainingHistory.length - 1];
    for (const listener of trainingFinishListeners) {
      try {
        listener(record);
      } catch (e) {
        logger.warn(LogCategory.NETWORK, '[RemoteScoreServer] écouteur fin entraînement:', e);
      }
    }
    // Pré-charger le prochain match entraînement dans la file
    const queue = ctx.arenaMatchQueue.get(arenaId) ?? [];
    // Démo : null entre deux phases (la piste se libère, l'arbitre virtuel la réoccupe)
    const next = ctx.createTrainingMatch();
    if (next) ctx.arenaMatchQueue.set(arenaId, [...queue, next]);
  }

  const nextMatch = ctx.peekNextMatch(arenaId);

  // Mettre à jour l'état en mémoire sans broadcaster (on fait le broadcast manuellement
  // pour pouvoir inclure nextMatch, absent de Arena)
  const arenaRef = ctx.arenas.get(arenaId)!;
  Object.assign(arenaRef, { status: 'finished', currentMatch: arena.currentMatch });

  ctx.broadcastArenaUpdate(arenaId, {
    arenaId,
    match: arena.currentMatch,
    scoreA: arena.currentMatch?.scoreA,
    scoreB: arena.currentMatch?.scoreB,
    status: 'finished',
    fencerA: arena.currentMatch?.fencerA,
    fencerB: arena.currentMatch?.fencerB,
    nextMatch,
  });

  // Webhook résultats
  let competitionName = '';
  try {
    competitionName = ctx.session?.competitionId
      ? (ctx.db.getCompetition(ctx.session.competitionId)?.title ?? '')
      : '';
  } catch {
    // nom indisponible : message sans nom de compétition
  }
  ctx.fireWebhook({
    event: 'match_finished',
    arenaId,
    matchId: finishedMatch.id,
    fencerA: finishedMatch.fencerA
      ? {
          id: finishedMatch.fencerA.id,
          name: `${finishedMatch.fencerA.lastName} ${finishedMatch.fencerA.firstName}`,
          club: finishedMatch.fencerA.club,
        }
      : null,
    fencerB: finishedMatch.fencerB
      ? {
          id: finishedMatch.fencerB.id,
          name: `${finishedMatch.fencerB.lastName} ${finishedMatch.fencerB.firstName}`,
          club: finishedMatch.fencerB.club,
        }
      : null,
    scoreA: finishedMatch.scoreA,
    scoreB: finishedMatch.scoreB,
    winner:
      finishedMatch.deviceEnd?.winner ?? winnerByScore(finishedMatch.scoreA, finishedMatch.scoreB),
    duration: finishedMatch.duration ?? null,
    timestamp: new Date().toISOString(),
    // Compatibilité Slack/Discord : champ text en clair
    competitionName,
    arenaNumber: arenaRef.number,
    text: `${competitionName ? `${competitionName} — ` : ''}Match terminé — Piste ${arenaRef.number} — ${finishedMatch.fencerA ? `${finishedMatch.fencerA.lastName} ${finishedMatch.fencerA.firstName}` : '?'} ${finishedMatch.scoreA} – ${finishedMatch.scoreB} ${finishedMatch.fencerB ? `${finishedMatch.fencerB.lastName} ${finishedMatch.fencerB.firstName}` : '?'}`,
  });

  // Score et exclusion écrits par le moteur : appel DT et notification seulement
  if (recorded && deviceReason === 'exclusion' && culpritSide) {
    applyDeviceExclusion(ctx, arenaId, finishedMatch, culpritSide);
  } else if (recorded && deviceReason === 'abandon' && finishWinner) {
    proposeAbandonToDT(ctx, arenaId, finishedMatch, finishWinner === 'A' ? 'B' : 'A');
  }

  // Émettre l'event pour le renderer (pour sauvegarder le score dans les pools)
  const mainWindow = getSharedMainWindow();
  if (mainWindow && !ctx.isTrainingMode) {
    // Dériver le vainqueur depuis la DB pour gérer le cas tirage au sort (scores égaux)
    let winnerForRenderer: 'A' | 'B' | null =
      finishedMatch.deviceEnd?.winner ?? winnerByScore(finishedMatch.scoreA, finishedMatch.scoreB);
    if (!winnerForRenderer) {
      try {
        const dbM = ctx.db.getMatch(finishedMatch.id);
        if (dbM?.scoreA?.isVictory) winnerForRenderer = 'A';
        else if (dbM?.scoreB?.isVictory) winnerForRenderer = 'B';
      } catch (err) {
        logger.warn(
          LogCategory.NETWORK,
          `[RemoteScoreServer] Lecture DB échouée pour le vainqueur du match ${finishedMatch.id}:`,
          err
        );
      }
    }
    // Fallback pour les matchs en mémoire (non persistés en DB) : tirage au sort
    if (!winnerForRenderer) {
      const memScore = ctx.sessionMatchScores.get(finishedMatch.id);
      if (isVictory(memScore?.scoreA)) winnerForRenderer = 'A';
      else if (isVictory(memScore?.scoreB)) winnerForRenderer = 'B';
    }
    notifyScreen({
      kind: 'match_finished',
      competitionId: ctx.session?.competitionId ?? null,
      matchId: finishedMatch.id,
      scoreA: finishedMatch.scoreA,
      scoreB: finishedMatch.scoreB,
      winner: winnerForRenderer,
      poolId: finishedMatch.poolId,
      isTableau: finishedMatch.isTableau ?? false,
      deviceReason: finishedMatch.deviceEnd?.reason,
    });
    logger.info(
      LogCategory.NETWORK,
      `[RemoteScoreServer] Émission match:finished pour ${finishedMatch.id}: ${finishedMatch.scoreA}-${finishedMatch.scoreB}`
    );
  }
  if (mainWindow && ctx.isTrainingMode) {
    notifyTraining({
      kind: 'match_finished',
      record: ctx.trainingHistory[ctx.trainingHistory.length - 1] ?? null,
    });
  }

  ctx.persistArenaState(arenaId);
  ctx.broadcastDashboardUpdate();

  // Charger automatiquement le prochain match après un délai
  // (loadNextMatch gère aussi le cas "plus de matchs" → arène idle)
  setTimeout(() => {
    const a = ctx.arenas.get(arenaId);
    if (a && a.status === 'finished') {
      ctx.loadNextMatch(arenaId);
    }
  }, 3000);
  return null;
}

/**
 * Fin de match demandée par l'appareil de piste ou la tablette : score contrôlé par
 * recordScore sans rien écrire. Refus (score maximal dépassé, égalité impossible, tableau
 * tiré…) : verdict rendu, l'appareil reçoit NAK, la tablette le refus ; null sinon.
 */
export function checkArenaFinishOutcome(
  ctx: MatchFinishContext,
  arenaId: string,
  source: 'cyrano' | 'tablet' = 'cyrano'
): Extract<FinishOutcome, { kind: 'refused' }> | null {
  const match = ctx.arenas.get(arenaId)?.currentMatch;
  if (!match || ctx.isTrainingMode) return null;
  const reason = match.deviceEnd?.reason;
  const winner = resolveFinishWinner(ctx, match);
  const culprit = match.blackCardFencer ?? null;
  // Exclusion (statut E) : contrôlée avec le retrait, comme elle sera écrite (docs/adr/0016)
  const outcome = checkFinishedScore(ctx.db, {
    competitionId: ctx.session?.competitionId,
    matchId: match.id,
    scoreA: match.scoreA,
    scoreB: match.scoreB,
    winner: culprit ? (culprit === 'A' ? 'B' : 'A') : winner,
    source,
    ...((reason === 'exclusion' && winner) || culprit
      ? { specialStatus: 'exclusion' as const, blackCard: true }
      : {}),
  });
  return outcome.kind === 'refused' ? outcome : null;
}

/** Motif du refus de l'appareil de piste (NAK), null si la fin est acceptée */
export function checkArenaFinish(ctx: MatchFinishContext, arenaId: string): string | null {
  return checkArenaFinishOutcome(ctx, arenaId)?.code ?? null;
}

/** Vainqueur d'une fin de match : appareil, score, puis marque de victoire en mémoire */
function resolveFinishWinner(
  ctx: MatchFinishContext,
  m: { id: string; scoreA: number; scoreB: number; deviceEnd?: { winner?: 'A' | 'B' } }
): 'A' | 'B' | null {
  const byScore = m.deviceEnd?.winner ?? winnerByScore(m.scoreA, m.scoreB);
  if (byScore) return byScore;
  const mem = ctx.sessionMatchScores.get(m.id);
  if (isVictory(mem?.scoreA)) return 'A';
  if (isVictory(mem?.scoreB)) return 'B';
  return null;
}

/** Champs et méthodes du serveur exposés à ce contexte via liveContext (#1896) */
export const MATCH_FINISH_CONTEXT_KEYS = {
  state: [
    'arenaCards',
    'arenaEventTimes',
    'arenaExits',
    'arenaMatchQueue',
    'arenaRefereeSelected',
    'arenaTouches',
    'arenas',
    'db',
    'isTrainingMode',
    'recentMatchDurationsMs',
    'session',
    'sessionMatchScores',
    'sessionModernRules',
    'sessionWeapon',
    'trainingHistory',
  ],
  methods: [
    'broadcastArenaUpdate',
    'broadcastDashboardUpdate',
    'assignMatchToArena',
    'createTrainingMatch',
    'fireWebhook',
    'loadNextMatch',
    'peekNextMatch',
    'persistArenaState',
    'resolveDbMatchId',
    'logDiag',
  ],
} as const;
