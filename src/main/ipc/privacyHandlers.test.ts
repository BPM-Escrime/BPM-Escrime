/**
 * Handlers IPC `privacy:*` restants (RGPD, #1882) : archives .bpm chiffrées.
 * Les droits des personnes et la conservation sont testés par le contrat
 * (engine/commands/privacy.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as os from 'os';

type Handler = (...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();
vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
  dialog: { showSaveDialog: vi.fn(async () => ({ canceled: true })) },
  ipcMain: { handle: (ch: string, fn: Handler) => handlers.set(ch, fn) },
}));

import { createPrivacyHandlers } from './privacyHandlers';
import type { DatabaseManager } from '../../database';

describe('handlers privacy:* restants', () => {
  beforeEach(() => {
    handlers.clear();
    createPrivacyHandlers({
      db: {} as unknown as DatabaseManager,
      getMainWindow: () => null,
    }).register();
  });

  it('ne déclare plus que les canaux à dialogue natif ou chemin de fichier', () => {
    expect([...handlers.keys()].sort()).toEqual([
      'privacy:cancelEncryptedBpm',
      'privacy:exportEncryptedBpm',
      'privacy:exportPerson',
      'privacy:openEncryptedBpm',
    ]);
  });

  it('archive chiffrée : mot de passe trop court, aucun fichier en attente', async () => {
    expect(await handlers.get('privacy:exportEncryptedBpm')!({}, null, 'court')).toEqual({
      success: false,
      error: 'password_too_short',
    });
    expect(await handlers.get('privacy:openEncryptedBpm')!({}, 'motdepasse')).toEqual({
      success: false,
      error: 'no_pending_file',
    });
  });
});
