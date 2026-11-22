/**
 * BellePoule Modern - Serveur distant : clients connectés (écrans, tablettes) et avis à l'écran
 * (#1981 lot 2, docs/adr/0022). Reprise des anciens canaux IPC remote:getConnectedClients,
 * sendClientCommand, broadcastCommand, renameClient, identifyClient, setClientKioskMode et des
 * avis du préload (onRemoteArenaUpdate, onRemoteMatchFinished, onKioskNoteUpdate…), lus sur le
 * bus du main (api/events.ts). Pas de journal.
 * Licensed under GPL-3.0
 */
import type { KioskModeConfig } from '../../remote/clientRegistry';
import { onRemoteActivityEvent, onRemoteClientsEvent } from '../api/events';
import type { CommandContext } from './context';
import { adminOf, refuse, serverOf, type RemoteHandler } from './remoteSupport';

type ClientOps =
  | 'listRemoteClients'
  | 'sendClientCommand'
  | 'broadcastClientCommand'
  | 'renameRemoteClient'
  | 'identifyRemoteClient'
  | 'setClientKioskMode';

export const remoteClientsHandlers: { [N in ClientOps]: RemoteHandler<N> } = {
  // Serveur arrêté : aucun client (comme l'ancien canal)
  listRemoteClients: (ctx, { competitionId }) =>
    refuse(() => adminOf(ctx).server(competitionId)?.clients.list() ?? []),
  sendClientCommand: (ctx, { competitionId, socketId, command }) =>
    refuse(() => serverOf(ctx, competitionId).clients.send(socketId, command)),
  broadcastClientCommand: (ctx, { competitionId, command }) =>
    refuse(() => serverOf(ctx, competitionId).clients.broadcast(command)),
  renameRemoteClient: (ctx, { competitionId, socketId, label }) =>
    refuse(() => serverOf(ctx, competitionId).clients.rename(socketId, label)),
  identifyRemoteClient: (ctx, { competitionId, socketId }) =>
    refuse(() => serverOf(ctx, competitionId).clients.identify(socketId)),
  setClientKioskMode: (ctx, { competitionId, socketId, config }) =>
    refuse(() =>
      serverOf(ctx, competitionId).clients.setKioskMode(socketId, config as KioskModeConfig)
    ),
};

/**
 * Avis d'une épreuve : un avis sans épreuve (logo du poste) ou venu d'un serveur sans épreuve
 * connue est livré à tous les abonnés ; sinon, seulement à ceux de son épreuve.
 */
const concerns = (wanted: string | undefined, event: string | null): boolean =>
  !wanted || event === null || event === wanted;

/** Abonnement onRemoteActivity : avis des tablettes et des écrans, filtrés par épreuve */
export const onRemoteActivity = (
  _ctx: CommandContext,
  { competitionId }: { competitionId?: string },
  emit: (event: Parameters<Parameters<typeof onRemoteActivityEvent>[0]>[0]) => void
): (() => void) =>
  onRemoteActivityEvent(event => {
    if (concerns(competitionId, event.competitionId)) emit(event);
  });

/** Abonnement onRemoteClients : liste des clients connectés modifiée */
export const onRemoteClients = (
  _ctx: CommandContext,
  { competitionId }: { competitionId?: string },
  emit: (event: Parameters<Parameters<typeof onRemoteClientsEvent>[0]>[0]) => void
): (() => void) =>
  onRemoteClientsEvent(event => {
    if (concerns(competitionId, event.competitionId)) emit(event);
  });
