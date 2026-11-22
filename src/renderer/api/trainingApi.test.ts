/**
 * Serveur d'entraînement (#1981 lot 2, docs/adr/0022) : chaque appel de l'écran donne une entrée
 * que le schéma zod de l'opération du contrat accepte ; un refus du contrat revient sous
 * l'ancienne enveloppe `{ success: false, error }` ; l'avis de match fini est filtré.
 */
import { describe, expect, it } from 'vitest';
import { contract, type OperationName } from '../../shared/api/contract';
import { trainingOperations } from '../../shared/api/contractTraining';
import { ApiError, type ApiBridge } from '../../shared/api/client';
import { IpcClient } from './IpcClient';
import { createTrainingApi } from './trainingApi';
import { eventfulBridge } from '../testUtils/stationBridge';

const seen: Array<{ name: string; input: unknown }> = [];
/** Réponse du pont par opération ; absente : succès sans valeur */
let replies: Record<string, () => unknown> = {};
const bridge: ApiBridge = {
  invoke: async (name, input) => {
    seen.push({ name, input });
    const def = contract[name as OperationName];
    if (!def) return { ok: false, error: { code: 'unknown_operation', message: name } };
    const parsed = def.input.safeParse(input ?? {});
    if (!parsed.success) {
      return { ok: false, error: { code: 'invalid_input', message: parsed.error.message } };
    }
    try {
      return { ok: true, data: replies[name]?.() ?? null };
    } catch (e) {
      if (e instanceof ApiError) return { ok: false, error: e.toJSON() };
      throw e;
    }
  },
  subscribe: async () => ({ ok: true, data: null }),
  unsubscribe: () => undefined,
  onEvent: () => () => undefined,
};
const api = createTrainingApi(new IpcClient(() => bridge));

const CALLS: Array<[string, () => Promise<unknown>]> = [
  ['startServer', () => api.startServer(8066, '0.0.0.0', true)],
  ['startServer (défauts)', () => api.startServer()],
  ['stopServer', () => api.stopServer()],
  [
    'startSession (règles libres)',
    () =>
      api.startSession(3, 'L', {
        matchDurationSeconds: 180,
        allowedZones: ['A', 'B'],
        disableSuddenDeath: true,
        demo: true,
      }),
  ],
  ['startSession', () => api.startSession(2, 'E')],
  ['stopSession', () => api.stopSession()],
  ['setTheme', () => api.setTheme('musketeers')],
  ['getHistory', () => api.getHistory()],
  ['getSession', () => api.getSession()],
  ['getArenas', () => api.getArenas()],
  ['getServerInfo', () => api.getServerInfo()],
  ['openDemoScreens', () => api.openDemoScreens(2)],
];

describe('trainingApi : entrées du contrat', () => {
  it.each(CALLS)('%s', async (_label, call) => {
    seen.length = 0;
    replies = {};
    const res = await call();
    expect(seen).toHaveLength(1);
    // L'entrée a passé le schéma zod de l'opération (sinon : invalid_input)
    const failure = (res ?? {}) as { success?: boolean; error?: string };
    expect(failure.error ?? '').not.toMatch(/Entrée invalide|invalid_input/);
  });

  it('chaque opération d’entraînement est atteignable par un appel de l’écran', async () => {
    const called = new Set<string>();
    for (const [, call] of CALLS) {
      seen.length = 0;
      replies = {};
      await call();
      called.add(seen[0].name);
    }
    const missing = (Object.keys(trainingOperations) as OperationName[]).filter(
      n => contract[n].kind !== 'subscription' && !called.has(n)
    );
    expect(missing).toEqual([]);
  });
});

describe('trainingApi : enveloppe historique', () => {
  it('une réponse est rangée dans son champ', async () => {
    replies = {
      startTrainingServer: () => ({ url: 'http://10.0.0.4:8066', ip: '10.0.0.4', port: 8066 }),
      listTrainingHistory: () => [{ id: 'm1' }],
      getTrainingSession: () => null,
      openDemoScreens: () => ({ count: 3 }),
    };
    expect(await api.startServer()).toMatchObject({ success: true, serverInfo: { port: 8066 } });
    expect(await api.getHistory()).toMatchObject({ success: true, history: [{ id: 'm1' }] });
    expect(await api.getSession()).toEqual({ success: true, session: null });
    expect(await api.openDemoScreens(2)).toEqual({ success: true, count: 3 });
  });

  it('un refus du contrat devient success: false, avec le code traduisible', async () => {
    replies = {
      startTrainingServer: () => {
        throw new ApiError('training_already_started', 'déjà');
      },
      stopTrainingSession: () => {
        throw new ApiError('training_not_started', 'non démarré');
      },
      setTrainingTheme: () => {
        throw new ApiError('invalid_theme', 'inconnu');
      },
      startTrainingSession: () => {
        throw new ApiError('remote_refused', 'Session déjà active');
      },
    };
    expect(await api.startServer()).toEqual({ success: false, error: 'training_already_started' });
    expect(await api.stopSession()).toEqual({ success: false, error: 'training_not_started' });
    expect(await api.setTheme('custom')).toEqual({ success: false, error: 'invalid_theme' });
    expect(await api.startSession(1, 'E')).toEqual({
      success: false,
      error: 'Session déjà active',
    });
  });

  it('hors Electron (pas de pont) : success: false, jamais de rejet, historique vide', async () => {
    const offline = createTrainingApi(new IpcClient(() => undefined));
    expect(await offline.getArenas()).toMatchObject({ success: false });
    expect(await offline.getHistory()).toMatchObject({ success: false, history: [] });
    expect(() => offline.onMatchFinished(() => undefined)()).not.toThrow();
  });
});

describe('trainingApi : avis', () => {
  it('onMatchFinished livre la ligne d’historique jusqu’à la désinscription', () => {
    const events = eventfulBridge({});
    const live = createTrainingApi(new IpcClient(() => events.api));
    const records: Array<string | null> = [];
    const off = live.onMatchFinished(({ record }) => records.push(record?.id ?? null));
    events.emit('onTrainingActivity', { kind: 'match_finished', record: { id: 'm1' } });
    events.emit('onTrainingActivity', { kind: 'match_finished', record: null });
    off();
    events.emit('onTrainingActivity', { kind: 'match_finished', record: { id: 'm2' } });
    expect(records).toEqual(['m1', null]);
  });
});
