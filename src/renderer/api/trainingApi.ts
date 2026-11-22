/**
 * BellePoule Modern - Serveur d'entraînement : appels de l'écran au contrat d'API (#1981 lot 2,
 * docs/adr/0022). Traduit les appels de l'écran (arguments positionnels, mêmes noms que l'ancien
 * groupe `training` de window.electronAPI) en opérations du contrat (shared/api/contractTraining.ts)
 * et rend la réponse sous l'ancienne enveloppe `{ success, error?, … }` (même règle que
 * remoteApi.ts : refus du contrat → `success: false` et code traduisible par `errors.<code>`).
 * L'avis de match fini (ex-onTrainingMatchFinished) est l'abonnement `onTrainingActivity`.
 * Licensed under GPL-3.0
 */
import { useMemo } from 'react';
import type { BpmClient } from '../../shared/api/client';
import type { Weapon } from '../../shared/types';
import type { Arena, RemoteSession } from '../../shared/types/remote';
import type {
  TrainingCustomRules,
  TrainingMatchRecord,
  TrainingServerInfo,
} from '../../shared/types/training';
import { useBpmClient } from './BpmClientContext';
import { defaultBpmClient } from './IpcClient';
import { settle } from './remoteApi';

export { remoteAvailable as trainingAvailable } from './remoteApi';

export function createTrainingApi(client: BpmClient) {
  const q = client.query.bind(client);
  const c = client.call.bind(client);
  return {
    startServer: (port?: number, host?: string, useHttps?: boolean) =>
      settle(
        () => c('startTrainingServer', { port, host, useHttps }),
        (serverInfo): { serverInfo: TrainingServerInfo } => ({ serverInfo })
      ),
    stopServer: () => settle(() => c('stopTrainingServer', {})),
    startSession: (strips: number, weapon: Weapon | string, customRules?: TrainingCustomRules) =>
      settle(
        () => c('startTrainingSession', { strips, weapon: weapon as Weapon, customRules }),
        (session): { session: RemoteSession } => ({ session })
      ),
    stopSession: () => settle(() => c('stopTrainingSession', {})),
    setTheme: (theme: string) => settle(() => c('setTrainingTheme', { theme })),
    getHistory: async () => {
      const res = await settle(
        () => q('listTrainingHistory', {}),
        (history): { history: TrainingMatchRecord[] } => ({ history })
      );
      return { ...res, history: res.history ?? [] };
    },
    getSession: () =>
      settle(
        () => q('getTrainingSession', {}),
        (session): { session: RemoteSession | null } => ({ session })
      ),
    getArenas: () =>
      settle(
        () => q('listTrainingArenas', {}),
        (arenas): { arenas: Arena[] } => ({ arenas })
      ),
    getServerInfo: () =>
      settle(
        () => q('getTrainingServerInfo', {}),
        (serverInfo): { serverInfo: TrainingServerInfo } => ({ serverInfo })
      ),
    /** Démo autonome : ouvre les écrans arène / tablette arbitre / kiosque du serveur */
    openDemoScreens: (strips: number) =>
      settle(
        () => c('openDemoScreens', { strips }),
        (res): { count: number } => ({ count: res.count })
      ),
    /** Match fini sur une tablette : dernière ligne de l'historique. Renvoie la désinscription. */
    onMatchFinished: (callback: (data: { record: TrainingMatchRecord | null }) => void) => {
      try {
        return client.subscribe('onTrainingActivity', {}, event => {
          if (event.kind === 'match_finished') callback({ record: event.record });
        });
      } catch {
        // Hors Electron (pas de pont) : aucun avis, rien à désinscrire
        return () => undefined;
      }
    },
  };
}

export type TrainingApi = ReturnType<typeof createTrainingApi>;

/** API d'entraînement de l'écran, sur le client du contrat (stable tant que le client l'est) */
export function useTrainingApi(): TrainingApi {
  const client = useBpmClient();
  return useMemo(() => createTrainingApi(client), [client]);
}

/** API d'entraînement hors React : client par défaut */
export const trainingApi: TrainingApi = createTrainingApi(defaultBpmClient);
