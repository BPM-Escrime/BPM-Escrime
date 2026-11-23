/**
 * BPM - Escrime - Serveur distant : cycle de vie, session, pistes et synchro d'affichage
 * (#1981 lot 2, docs/adr/0022). Reprise des anciens canaux IPC remote:* (remoteServerHandlers,
 * remoteMatchHandlers, remoteSessionHandlers). Le serveur lui-même (registre, ports, certificat)
 * passe par le port `ctx.remote.admin` branché par main.ts ; pas de journal.
 *
 * Un fait, un chemin (docs/adr/0005) : les opérations `push…ToStrips` ne font que pousser aux
 * tablettes l'état de l'écran (cache et files du serveur, en mémoire). Les scores, statuts et
 * compositions s'écrivent par recordScore, clearScore, generatePools… qui journalisent.
 * Licensed under GPL-3.0
 */
import type { RemoteScoreServer } from '../../remoteScoreServer';
import { CommandError } from './context';
import {
  adminOf,
  refuseLogged,
  refuseLoggedAsync,
  serverOf,
  type RemoteHandler,
} from './remoteSupport';

type LifecycleOps =
  | 'listNetworkInterfaces'
  | 'startRemoteServer'
  | 'stopRemoteServer'
  | 'reloadRemoteServer'
  | 'getRemoteServerInfo'
  | 'getRemoteCertFingerprint'
  | 'getRemoteFirewallDiagnosis'
  | 'startRemoteSession'
  | 'stopRemoteSession'
  | 'launchRemoteCompetition'
  | 'getRemoteSession'
  | 'listRemoteArenas'
  | 'setRemoteStripCount'
  | 'setRemoteShowPhotos'
  | 'setRemoteCardAnnounce'
  | 'setStripPlan'
  | 'setActiveWave'
  | 'moveMatchToArena'
  | 'setTeamArenaMatch'
  | 'clearTeamArenaMatch'
  | 'requestMatchSignature'
  | 'acknowledgeDtCall'
  | 'pushPoolFencersToStrips'
  | 'pushPoolMatchesToStrips'
  | 'pushPoolsToStrips'
  | 'pushTableauToStrips'
  | 'pushMatchFinishToStrips'
  | 'pushMatchResetToStrips';

type PoolsData = Parameters<RemoteScoreServer['assignPools']>[0];
type KioskViews = NonNullable<Parameters<RemoteScoreServer['startSession']>[4]>;

export const remoteHandlers: { [N in LifecycleOps]: RemoteHandler<N> } = {
  // ── Cycle de vie du serveur ──
  listNetworkInterfaces: ctx => adminOf(ctx).networkInterfaces(),
  startRemoteServer: (ctx, { competitionId, ...options }) =>
    adminOf(ctx).start(competitionId, options),
  stopRemoteServer: (ctx, { competitionId }) => {
    if (!adminOf(ctx).info(competitionId)) {
      throw new CommandError('remote_not_running', 'Saisie distante de l’épreuve non démarrée');
    }
    refuseLogged('Error stopping remote server:', () => ctx.remote?.stop(competitionId));
  },
  reloadRemoteServer: (ctx, { competitionId, ...options }) =>
    adminOf(ctx).reload(competitionId, options),
  getRemoteServerInfo: (ctx, { competitionId }) => {
    const info = adminOf(ctx).info(competitionId);
    if (!info) {
      throw new CommandError('remote_not_running', 'Saisie distante de l’épreuve non démarrée');
    }
    return info;
  },
  getRemoteCertFingerprint: ctx => adminOf(ctx).certFingerprint(),
  getRemoteFirewallDiagnosis: (ctx, { port }) => adminOf(ctx).firewallCheck(port),

  // ── Session ──
  startRemoteSession: (
    ctx,
    { competitionId, strips, matches, showPhotos, kioskViews, cardAnnounce }
  ) =>
    refuseLoggedAsync('Error starting session:', () =>
      serverOf(ctx, competitionId).startSession(
        competitionId,
        strips,
        matches,
        showPhotos,
        kioskViews as KioskViews | undefined,
        cardAnnounce
      )
    ),
  stopRemoteSession: (ctx, { competitionId }) =>
    refuseLogged('Error stopping session:', () => serverOf(ctx, competitionId).stopSession()),
  launchRemoteCompetition: (ctx, { competitionId }) =>
    refuseLogged('Error launching competition:', () =>
      serverOf(ctx, competitionId).launchCompetition()
    ),
  getRemoteSession: (ctx, { competitionId }) => serverOf(ctx, competitionId).getSession() ?? null,
  listRemoteArenas: (ctx, { competitionId }) => serverOf(ctx, competitionId).getAllArenas(),
  setRemoteStripCount: (ctx, { competitionId, count }) =>
    refuseLogged('Error updating strip count:', () =>
      serverOf(ctx, competitionId).updateStripCount(count)
    ),
  setRemoteShowPhotos: (ctx, { competitionId, value }) =>
    refuseLogged('Error updating showPhotos:', () =>
      serverOf(ctx, competitionId).updateShowPhotos(value)
    ),
  setRemoteCardAnnounce: (ctx, { competitionId, value }) =>
    refuseLogged('Error updating cardAnnounce:', () =>
      serverOf(ctx, competitionId).updateCardAnnounce(value)
    ),
  setStripPlan: (ctx, { competitionId, plan }) =>
    refuseLogged('Error setting strip plan:', () =>
      serverOf(ctx, competitionId).setStripPlan(plan)
    ),
  setActiveWave: (ctx, { competitionId, matchIds, poolsClosed }) =>
    adminOf(ctx).setActiveWave(competitionId, matchIds, poolsClosed === true),

  // ── Pistes ──
  moveMatchToArena: (ctx, { competitionId, matchId, fromArena, toArena, fencerA, fencerB }) =>
    refuseLogged('Error moving match to arena:', () =>
      serverOf(ctx, competitionId).updateMatchArena(
        matchId,
        fromArena,
        toArena,
        fencerA ?? undefined,
        fencerB ?? undefined
      )
    ),
  setTeamArenaMatch: (ctx, { competitionId, arenaId, matchId, isLaserPoints }) => {
    const ok = refuseLogged('Error setting team arena match:', () =>
      serverOf(ctx, competitionId).setTeamArenaMatch(arenaId, matchId, isLaserPoints)
    );
    if (!ok) throw new CommandError('match_not_found', 'Rencontre d’équipe introuvable');
  },
  // Serveur absent : rien à retirer (comme l'ancien canal)
  clearTeamArenaMatch: (ctx, { competitionId, arenaId }) =>
    refuseLogged('Error clearing team arena match:', () =>
      adminOf(ctx).server(competitionId)?.clearTeamArenaMatch(arenaId)
    ),
  requestMatchSignature: (ctx, { competitionId, arenaId, request }) => {
    const ok = refuseLogged('Error requesting match signature:', () =>
      serverOf(ctx, competitionId).requestMatchSignature(arenaId, request)
    );
    if (!ok) throw new CommandError('strip_not_found', 'Piste introuvable');
  },
  acknowledgeDtCall: (ctx, { competitionId, arenaId }) =>
    refuseLogged('Error acknowledging DT call:', () =>
      serverOf(ctx, competitionId).acknowledgeDTCall(arenaId)
    ),

  // ── Synchro d'affichage : l'écran pousse son état aux tablettes ──
  pushPoolFencersToStrips: (ctx, { competitionId, pools }) =>
    refuseLogged('Error pushing pool fencers:', () =>
      serverOf(ctx, competitionId).updatePoolFencers(pools)
    ),
  pushPoolMatchesToStrips: (ctx, { competitionId, pools }) =>
    refuseLogged('Error pushing pool matches:', () =>
      serverOf(ctx, competitionId).syncPoolMatches(pools)
    ),
  pushPoolsToStrips: (ctx, { competitionId, pools }) =>
    refuseLogged('Error pushing pools to strips:', () =>
      serverOf(ctx, competitionId).assignPools(pools as PoolsData)
    ),
  pushTableauToStrips: (ctx, { competitionId, matches }) =>
    refuseLogged('Error pushing tableau to strips:', () =>
      serverOf(ctx, competitionId).refreshDeMatches(matches)
    ),
  // Serveur absent : rien à prévenir (comme l'ancien canal)
  pushMatchFinishToStrips: (
    ctx,
    { competitionId, matchId, scoreA, scoreB, winner, specialStatus }
  ) =>
    refuseLogged('Error pushing match finish:', () =>
      adminOf(ctx)
        .server(competitionId)
        ?.finishPoolMatch(matchId, scoreA, scoreB, winner, specialStatus)
    ),
  pushMatchResetToStrips: (ctx, { competitionId, matchId }) =>
    refuseLogged('Error pushing match reset:', () =>
      adminOf(ctx).server(competitionId)?.resetPoolMatch(matchId)
    ),
};
