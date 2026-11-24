import { describe, it, expect, vi } from 'vitest';

const listeners = new Map<string, Array<() => void>>();

vi.mock('electron', () => ({
  ipcRenderer: {
    on: vi.fn((channel: string, fn: () => void) => {
      listeners.set(channel, [...(listeners.get(channel) ?? []), fn]);
    }),
  },
}));

import { createDbReady } from './dbReady';

const emit = (channel: string) => (listeners.get(channel) ?? []).forEach(fn => fn());

describe('whenDbReady (préload)', () => {
  it('attend db:ready, puis se résout tout de suite pour un appel tardif', async () => {
    listeners.clear();
    const whenDbReady = createDbReady();
    let resolved = false;
    const pending = whenDbReady().then(() => (resolved = true));
    await Promise.resolve();
    expect(resolved).toBe(false);
    emit('db:ready');
    await pending;
    expect(resolved).toBe(true);
    await expect(whenDbReady()).resolves.toBeUndefined();
  });
});
