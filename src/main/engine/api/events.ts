/**
 * BellePoule Modern - Bus d'événements de données côté main (#1981)
 * Alimenté par emitCompetitionEvent ; lu par les abonnements du contrat (onCompetitionEvents).
 * Licensed under GPL-3.0
 */
import { EventEmitter } from 'events';
import type { RemoteActivity, RemoteClientsEvent } from '../../../shared/types/remote';
import type { ConnectedClient } from '../../../shared/types/preload';

export interface CompetitionEventPayload {
  type: string;
  competitionId?: string;
  /** journal:appended : nouvelle révision du journal de l'épreuve (#1980) */
  revision?: number;
}

const bus = new EventEmitter();
bus.setMaxListeners(0);

export function publishCompetitionEvent(event: CompetitionEventPayload): void {
  bus.emit('event', event);
}

export function onCompetitionEvent(cb: (event: CompetitionEventPayload) => void): () => void {
  bus.on('event', cb);
  return () => {
    bus.off('event', cb);
  };
}

/** Mode Club : reprise du fichier de synchronisation ou sauvegarde restaurée (onClubSynced) */
export function publishClubSynced(clubId: string): void {
  bus.emit('club:synced', clubId);
}

export function onClubSyncedEvent(cb: (clubId: string) => void): () => void {
  bus.on('club:synced', cb);
  return () => {
    bus.off('club:synced', cb);
  };
}

/**
 * Serveur distant : avis des tablettes et des écrans à l'écran du poste (onRemoteActivity,
 * onRemoteClients ; docs/adr/0010 et 0022). Porte des identifiants et l'état d'affichage.
 */
export function publishRemoteActivity(event: RemoteActivity): void {
  bus.emit('remote:activity', event);
}

export function onRemoteActivityEvent(cb: (event: RemoteActivity) => void): () => void {
  bus.on('remote:activity', cb);
  return () => {
    bus.off('remote:activity', cb);
  };
}

export function publishRemoteClients(event: RemoteClientsEvent<ConnectedClient>): void {
  bus.emit('remote:clients', event);
}

export function onRemoteClientsEvent(
  cb: (event: RemoteClientsEvent<ConnectedClient>) => void
): () => void {
  bus.on('remote:clients', cb);
  return () => {
    bus.off('remote:clients', cb);
  };
}
