/**
 * Tests : pont du contrat d'API (window.electronAPI.api) à partir de fonctions par opération.
 * Une erreur levée (Error) devient une enveloppe { ok: false } (code `internal`, ou celui d'une
 * ApiError levée : refus d'une commande) ; une autre valeur levée est propagée telle quelle,
 * comme un transport en panne.
 * Licensed under GPL-3.0
 */
import { ApiError, type ApiBridge } from '../../shared/api/client';

export type ApiHandlers = Record<string, (input: Record<string, unknown>) => unknown>;

export function fakeApiBridge(handlers: ApiHandlers): ApiBridge {
  return {
    invoke: async (name, input) => {
      const handler = handlers[name];
      if (!handler) {
        return {
          ok: false,
          error: { code: 'internal', message: `Opération non simulée : ${name}` },
        };
      }
      try {
        return { ok: true, data: await handler(input as Record<string, unknown>) };
      } catch (e) {
        if (e instanceof Error) {
          const code = e instanceof ApiError ? e.code : 'internal';
          return { ok: false, error: { code, message: e.message } };
        }
        throw e;
      }
    },
    subscribe: async () => ({ ok: true, data: null }),
    unsubscribe: () => {},
    onEvent: () => () => {},
  };
}
