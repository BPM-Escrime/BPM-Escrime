/**
 * Tests du serveur d'entraînement : simule le contrat d'API (docs/adr/0022) à partir de fonctions
 * par méthode de l'écran (`createTrainingApi`, src/renderer/api/trainingApi.ts, mêmes noms que
 * l'ancien groupe `training` de window.electronAPI). Chaque opération du contrat reçoit son
 * entrée nommée et la rend en arguments positionnels à la méthode correspondante ; la méthode
 * répond comme l'ancien canal (`{ success, … }`) : un `success: false` devient un refus du
 * contrat, que l'écran rend sous la même enveloppe. Le contrat lui-même est couvert par
 * src/main/engine/commands/training.test.ts.
 * Licensed under GPL-3.0
 */
import { ApiError, type ApiBridge } from '../../shared/api/client';
import type { ApiHandlers } from './apiBridge';
import { eventfulBridge } from './stationBridge';

/** Méthodes de l'écran simulées (vi.fn) : nom → fonction */
export type TrainingMocks = Record<string, unknown>;

type Input = Record<string, unknown>;

/** Opérations du contrat → méthode de l'écran, arguments positionnels, champ de la réponse */
const MAPPING: Record<string, [method: string, args: (i: Input) => unknown[], output?: string]> = {
  startTrainingServer: ['startServer', i => [i.port, i.host, i.useHttps], 'serverInfo'],
  stopTrainingServer: ['stopServer', () => []],
  startTrainingSession: ['startSession', i => [i.strips, i.weapon, i.customRules], 'session'],
  stopTrainingSession: ['stopSession', () => []],
  setTrainingTheme: ['setTheme', i => [i.theme]],
  listTrainingHistory: ['getHistory', () => [], 'history'],
  getTrainingSession: ['getSession', () => [], 'session'],
  listTrainingArenas: ['getArenas', () => [], 'arenas'],
  getTrainingServerInfo: ['getServerInfo', () => [], 'serverInfo'],
  openDemoScreens: ['openDemoScreens', i => [i.strips]],
};

/** Codes de l'ancien canal rendus sous le code du catalogue */
const CODES = new Set(['training_not_started', 'training_already_started', 'invalid_theme']);

/** Une réponse `{ success: false, error }` de l'ancien canal devient un refus du contrat */
function refusalOf(res: { error?: string }): ApiError {
  const error = res.error ?? '';
  if (error === 'server_not_started') {
    return new ApiError('training_not_started', 'Serveur d’entraînement non démarré');
  }
  if (CODES.has(error)) return new ApiError(error as 'invalid_theme', error);
  if (error === 'tls_cert_failed') return new ApiError('tls_cert_failed', error);
  return new ApiError('remote_refused', error);
}

/** Les arguments facultatifs absents ne sont pas transmis (appel de l'écran à l'identique) */
const trimmed = (args: unknown[]): unknown[] => {
  const out = [...args];
  while (out.length && out[out.length - 1] === undefined) out.pop();
  return out;
};

/** Gestionnaires du contrat pour `fakeApiBridge`, à partir des méthodes de l'écran simulées */
export function trainingHandlers(mocks: TrainingMocks): ApiHandlers {
  const handlers: ApiHandlers = {};
  for (const [op, [method, toArgs, output]] of Object.entries(MAPPING)) {
    handlers[op] = async input => {
      const fn = mocks[method] as ((...args: unknown[]) => unknown) | undefined;
      if (!fn) throw new Error(`Méthode du serveur d’entraînement non simulée : ${method}`);
      const res = (await fn(...trimmed(toArgs(input)))) as
        { success?: boolean; error?: string; count?: number; [k: string]: unknown } | undefined;
      // Méthode sans valeur de retour (vi.fn()) : succès
      if (!res || typeof res !== 'object')
        return op === 'openDemoScreens' ? { count: 0 } : undefined;
      if (res.success === false) throw refusalOf(res);
      if (op === 'openDemoScreens') return { count: res.count ?? 0 };
      return output ? res[output] : undefined;
    };
  }
  return handlers;
}

/**
 * `window.electronAPI` d'un test de l'entraînement : pont du contrat. `extra` ajoute d'autres
 * opérations du contrat ou des groupes de l'API Electron. `emit(name, event)` livre un avis
 * d'abonnement (`onTrainingActivity`).
 */
export function trainingElectron(
  mocks: TrainingMocks,
  extra: { api?: ApiHandlers; [group: string]: unknown } = {}
): { api: ApiBridge; emit: (name: string, event: unknown) => void; [group: string]: unknown } {
  const { api: extraApi, ...rest } = extra;
  const { api, emit } = eventfulBridge({ ...trainingHandlers(mocks), ...extraApi });
  return { ...rest, api, emit };
}
