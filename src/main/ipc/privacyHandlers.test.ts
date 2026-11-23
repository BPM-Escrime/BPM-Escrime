/**
 * RGPD côté main (#1882) : plus aucun canal `privacy:*` en ipcMain. Fichier → Ouvrir sur une
 * archive chiffrée envoie à l'écran son nom et son contenu ; l'ouverture (mot de passe) passe
 * par le contrat (openCompetitionFile, engine/commands/dataFiles.test.ts).
 */
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const handle = vi.fn();
vi.mock('electron', () => ({ ipcMain: { handle } }));

import { createPrivacyHandlers } from './privacyHandlers';

describe('RGPD côté main', () => {
  it('archive chiffrée du menu : nom et contenu base64 envoyés à l’écran, aucun canal ipcMain', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-privacy-'));
    const file = path.join(dir, 'secret.bpm');
    fs.writeFileSync(file, Buffer.from('BPMENC1\nxyz'));
    const send = vi.fn();
    const { requestEncryptedOpen } = createPrivacyHandlers({
      getMainWindow: () => ({ webContents: { send } }) as never,
    });
    await requestEncryptedOpen(file);
    expect(send).toHaveBeenCalledWith(
      'privacy:encrypted-bpm',
      'secret.bpm',
      Buffer.from('BPMENC1\nxyz').toString('base64')
    );
    expect(handle).not.toHaveBeenCalled();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
