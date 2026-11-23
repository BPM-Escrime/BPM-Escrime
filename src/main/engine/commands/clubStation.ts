/**
 * BPM - Escrime - Mode Club : tablettes, synchronisation et sauvegardes du poste
 * (#1981 lot 2, docs/adr/0022). Les services dépendant d'Electron (serveur d'entraînement,
 * sélecteur de dossier) passent par le port `ctx.club`, branché par main.ts.
 * Licensed under GPL-3.0
 */
import { onClubSyncedEvent } from '../api/events';
import { CommandError, type ClubPort, type CommandContext } from './context';
import { refuse, refuseAsync, type ClubHandler } from './club';

/** Port du poste ; refus « unavailable » hors du poste Electron (tests, MCP) */
function portOf(ctx: CommandContext): ClubPort {
  if (!ctx.club) throw new CommandError('unavailable', 'Services du poste indisponibles');
  return ctx.club;
}

type StationOps =
  | 'getClubRemoteStatus'
  | 'sendClubBoutToStrip'
  | 'linkClubSessionToStrips'
  | 'releaseClubBout'
  | 'getClubSyncStatus'
  | 'enableClubSync'
  | 'disableClubSync'
  | 'syncClubNow'
  | 'resolveClubSyncConflict'
  | 'listClubBackups'
  | 'createClubBackup'
  | 'restoreClubBackup';

export const clubStationHandlers: { [N in StationOps]: ClubHandler<N> } = {
  // Tablettes : sans serveur d'entraînement, l'état est « inactif » comme avant
  getClubRemoteStatus: ctx => ctx.club?.remoteStatus() ?? { active: false, url: null, strips: 0 },
  sendClubBoutToStrip: (ctx, { boutId }) =>
    refuse(() => {
      const repo = ctx.db.club;
      const bout = repo.getBout(boutId);
      if (!bout || (bout.status !== 'pending' && bout.status !== 'in_progress')) return 'no_arena';
      return portOf(ctx).pushBout(
        bout,
        repo.getMember(bout.memberAId),
        repo.getMember(bout.memberBId)
      );
    }),
  linkClubSessionToStrips: (ctx, { sessionId }) => portOf(ctx).linkSession(sessionId),
  releaseClubBout: (ctx, { boutId }) => portOf(ctx).releaseBout(boutId),
  // Synchronisation vers un dossier et sauvegardes locales
  getClubSyncStatus: (ctx, { clubId }) => refuse(() => portOf(ctx).sync.status(clubId)),
  enableClubSync: (ctx, { clubId }) => refuseAsync(() => portOf(ctx).sync.enable(clubId)),
  disableClubSync: (ctx, { clubId }) => refuse(() => portOf(ctx).sync.disable(clubId)),
  syncClubNow: (ctx, { clubId }) => refuseAsync(() => portOf(ctx).sync.now(clubId)),
  resolveClubSyncConflict: (ctx, { clubId, keep }) =>
    refuseAsync(() => portOf(ctx).sync.resolve(clubId, keep)),
  listClubBackups: (ctx, { clubId }) => refuse(() => portOf(ctx).backups.list(clubId)),
  createClubBackup: (ctx, { clubId }) => refuseAsync(() => portOf(ctx).backups.create(clubId)),
  restoreClubBackup: (ctx, { clubId, backupId }) =>
    refuseAsync(() => portOf(ctx).backups.restore(clubId, backupId)),
};

/** Abonnement onClubSynced : reprise du fichier de synchro ou sauvegarde restaurée */
export const onClubSynced = (
  _ctx: CommandContext,
  _input: Record<string, never>,
  emit: (event: { clubId: string }) => void
): (() => void) => onClubSyncedEvent(clubId => emit({ clubId }));
