/**
 * Serveur d'entraînement par le contrat (#1981 lot 2, docs/adr/0022) : démarrage et arrêt
 * simulés par le port, refus si déjà démarré ou non démarré, session, thème, historique vide
 * sans serveur, écrans de démo, abonnement qui relaie les avis. Sans base : ces opérations
 * n'écrivent aucun fait de l'épreuve (pas de journal).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ApiError } from '../../../shared/api/client';
import type {
  TrainingActivity,
  TrainingMatchRecord,
  TrainingServerInfo,
} from '../../../shared/types/training';
import { CommandError, type CommandContext, type TrainingPort } from './context';
import { invoke, subscribe } from '../api/engine';
import { publishTrainingActivity } from '../api/events';

const INFO: TrainingServerInfo = {
  url: 'https://10.0.0.4:8066',
  ip: '10.0.0.4',
  port: 8066,
  useHttps: true,
};

const RECORD: TrainingMatchRecord = {
  id: 'm1',
  arenaId: 'arena1',
  arenaNumber: 1,
  weapon: 'E',
  scoreA: 5,
  scoreB: 3,
  durationSec: 120,
  finishedAt: '2026-11-22T10:00:00.000Z',
};

let running: boolean;
let calls: unknown[][];
let sessionFails: boolean;
let ctx: CommandContext;

function fakePort(): TrainingPort {
  return {
    server: () =>
      running
        ? {
            startTrainingSession: async (...args: unknown[]) => {
              calls.push(['startTrainingSession', ...args]);
              if (sessionFails) throw new Error('Session déjà active');
              return { competitionId: '__training__', strips: [] } as never;
            },
            stopTrainingSession: () => {
              calls.push(['stopTrainingSession']);
            },
            getTrainingHistory: () => [RECORD],
            getSession: () => ({ competitionId: '__training__', strips: [] }) as never,
            getAllArenas: () => [{ id: 'arena1', number: 1 }] as never,
          }
        : undefined,
    info: () => (running ? INFO : undefined),
    start: async options => {
      if (options.port === 80) throw new CommandError('remote_refused', 'Port indisponible');
      running = true;
      return { ...INFO, port: options.port ?? INFO.port };
    },
    stop: () => {
      const was = running;
      running = false;
      return was;
    },
    applyTheme: theme => {
      calls.push(['applyTheme', theme]);
    },
    openDemoScreens: strips => {
      calls.push(['openDemoScreens', strips]);
      return 3;
    },
  };
}

beforeEach(() => {
  running = false;
  sessionFails = false;
  calls = [];
  ctx = {
    // Journal présent mais jamais touché : une commande d'entraînement n'écrit aucun fait
    db: {
      eventLog: {
        getRevision: () => {
          throw new Error('journal touché');
        },
      },
    } as never,
    training: fakePort(),
  };
});

const refusal = async (name: string, input: unknown = {}) => {
  try {
    await invoke(ctx, name, input);
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return (e as ApiError).code;
  }
  throw new Error(`« ${name} » devait être refusée`);
};

describe('serveur d’entraînement', () => {
  it('démarre, rend l’adresse, puis arrête', async () => {
    expect(await invoke(ctx, 'startTrainingServer', { port: 9000 })).toEqual({
      ...INFO,
      port: 9000,
    });
    expect(await invoke(ctx, 'getTrainingServerInfo', {})).toEqual(INFO);
    await invoke(ctx, 'stopTrainingServer', {});
    expect(running).toBe(false);
    expect(await refusal('getTrainingServerInfo')).toBe('training_not_started');
  });

  it('refuse un double démarrage (training_already_started)', async () => {
    await invoke(ctx, 'startTrainingServer', {});
    expect(await refusal('startTrainingServer')).toBe('training_already_started');
  });

  it('refus du port rendu sous son code, port hors bornes refusé par le schéma', async () => {
    expect(await refusal('startTrainingServer', { port: 80 })).toBe('remote_refused');
    expect(await refusal('startTrainingServer', { port: 70000 })).toBe('invalid_input');
    expect(await refusal('startTrainingServer', { host: 'x', extra: 1 })).toBe('invalid_input');
  });

  it('arrêt d’un serveur absent : training_not_started', async () => {
    expect(await refusal('stopTrainingServer')).toBe('training_not_started');
  });

  it('hors du poste Electron (pas de port) : unavailable', async () => {
    ctx = { db: ctx.db };
    expect(await refusal('startTrainingServer')).toBe('unavailable');
  });
});

describe('session', () => {
  beforeEach(async () => {
    await invoke(ctx, 'startTrainingServer', {});
  });

  it('démarre la session avec les règles libres, puis l’arrête', async () => {
    const rules = {
      matchDurationSeconds: 180,
      allowedZones: [],
      disableSuddenDeath: false,
      demo: true,
    };
    await invoke(ctx, 'startTrainingSession', { strips: 2, weapon: 'E', customRules: rules });
    await invoke(ctx, 'stopTrainingSession', {});
    expect(calls).toEqual([['startTrainingSession', 2, 'E', rules], ['stopTrainingSession']]);
  });

  it('refus du serveur (session déjà active) : remote_refused, message gardé', async () => {
    sessionFails = true;
    await expect(
      invoke(ctx, 'startTrainingSession', { strips: 1, weapon: 'S' })
    ).rejects.toMatchObject({ code: 'remote_refused', message: 'Session déjà active' });
  });

  it('entrées bornées : pistes, arme et règles inconnues refusées', async () => {
    expect(await refusal('startTrainingSession', { strips: 0, weapon: 'E' })).toBe('invalid_input');
    expect(await refusal('startTrainingSession', { strips: 2, weapon: 'Z' })).toBe('invalid_input');
    expect(
      await refusal('startTrainingSession', {
        strips: 2,
        weapon: 'E',
        customRules: {
          matchDurationSeconds: 60,
          allowedZones: [],
          disableSuddenDeath: false,
          x: 1,
        },
      })
    ).toBe('invalid_input');
  });

  it('session, arènes et historique du serveur démarré', async () => {
    expect(await invoke(ctx, 'getTrainingSession', {})).toMatchObject({
      competitionId: '__training__',
    });
    expect(await invoke(ctx, 'listTrainingArenas', {})).toEqual([{ id: 'arena1', number: 1 }]);
    expect(await invoke(ctx, 'listTrainingHistory', {})).toEqual([RECORD]);
  });
});

describe('serveur arrêté', () => {
  it('historique, arènes et session vides (comme l’ancien canal)', async () => {
    expect(await invoke(ctx, 'listTrainingHistory', {})).toEqual([]);
    expect(await invoke(ctx, 'listTrainingArenas', {})).toEqual([]);
    expect(await invoke(ctx, 'getTrainingSession', {})).toBeNull();
  });

  it('session, thème et démo refusés : training_not_started', async () => {
    expect(await refusal('startTrainingSession', { strips: 1, weapon: 'E' })).toBe(
      'training_not_started'
    );
    expect(await refusal('stopTrainingSession')).toBe('training_not_started');
    expect(await refusal('setTrainingTheme', { theme: 'neon' })).toBe('training_not_started');
    expect(await refusal('openDemoScreens', { strips: 2 })).toBe('training_not_started');
  });
});

describe('thème et démo', () => {
  beforeEach(async () => {
    await invoke(ctx, 'startTrainingServer', {});
  });

  it.each(['dark', 'light', 'neon', 'unicorn', 'musketeers'])(
    'applique le thème %s',
    async theme => {
      await invoke(ctx, 'setTrainingTheme', { theme });
      expect(calls).toEqual([['applyTheme', theme]]);
    }
  );

  it('refuse un thème inconnu ou personnalisé (invalid_theme), avant l’état du serveur', async () => {
    expect(await refusal('setTrainingTheme', { theme: 'custom' })).toBe('invalid_theme');
    running = false;
    expect(await refusal('setTrainingTheme', { theme: 'custom' })).toBe('invalid_theme');
    expect(calls).toEqual([]);
  });

  it('ouvre les écrans de démo et rend leur nombre', async () => {
    expect(await invoke(ctx, 'openDemoScreens', { strips: 2 })).toEqual({ count: 3 });
    expect(calls).toEqual([['openDemoScreens', 2]]);
    expect(await refusal('openDemoScreens', { strips: 0 })).toBe('invalid_input');
  });
});

describe('onTrainingActivity', () => {
  it('relaie le match fini jusqu’à la désinscription', () => {
    const seen: TrainingActivity[] = [];
    const off = subscribe(ctx, 'onTrainingActivity', {}, e => seen.push(e as TrainingActivity));
    publishTrainingActivity({ kind: 'match_finished', record: RECORD });
    publishTrainingActivity({ kind: 'match_finished', record: null });
    off();
    publishTrainingActivity({ kind: 'match_finished', record: RECORD });
    expect(seen).toEqual([
      { kind: 'match_finished', record: RECORD },
      { kind: 'match_finished', record: null },
    ]);
  });
});
