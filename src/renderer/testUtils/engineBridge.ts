/**
 * Tests : pont du contrat d'API (window.electronAPI.api) branché sur le vrai moteur
 * (invoke, subscribe) et une base réelle, comme l'adaptateur IPC du main
 * (src/main/engine/api/ipcAdapter.ts) : enveloppes, abonnements, signaux du journal.
 * Licensed under GPL-3.0
 */
import type { ApiBridge } from '../../shared/api/client';
import type { CommandContext } from '../../main/engine/commands/context';
import { invoke, subscribe, toApiError } from '../../main/engine/api/engine';

export function engineBridge(ctx: CommandContext): ApiBridge & { close: () => void } {
  const listeners = new Set<(id: string, event: unknown) => void>();
  const subs = new Map<string, () => void>();
  return {
    invoke: async (name, input) => {
      try {
        return { ok: true, data: await invoke(ctx, name, input) };
      } catch (e) {
        return { ok: false, error: toApiError(e).toJSON() };
      }
    },
    subscribe: async (id, name, input) => {
      try {
        subs.get(id)?.();
        subs.set(
          id,
          subscribe(ctx, name, input, event => {
            for (const l of listeners) l(id, event);
          })
        );
        return { ok: true, data: null };
      } catch (e) {
        return { ok: false, error: toApiError(e).toJSON() };
      }
    },
    unsubscribe: id => {
      subs.get(id)?.();
      subs.delete(id);
    },
    onEvent: callback => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    close: () => {
      for (const off of subs.values()) off();
      subs.clear();
      listeners.clear();
    },
  };
}
