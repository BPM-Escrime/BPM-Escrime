import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const handlers = new Map<string, (...args: any[]) => any>();

vi.mock('electron', () => ({
  app: { getAppPath: () => '/opt/app', getPath: () => '/tmp' },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  ipcMain: { handle: (ch: string, fn: (...args: any[]) => any) => handlers.set(ch, fn) },
}));

import { dialog } from 'electron';
import { registerFileHandlers } from './fileHandlers';
import { authorizePath } from '../pathAuthorization';

describe('registerFileHandlers (#1341)', () => {
  beforeEach(() => {
    handlers.clear();
    registerFileHandlers({ db: {} as never, getMainWindow: () => null });
  });

  it('enregistre les canaux file:* et dialog:*', () => {
    expect([...handlers.keys()].sort()).toEqual([
      'dialog:openFile',
      'dialog:saveFile',
      'file:export',
      'file:import',
      'file:writeContent',
      'file:writeSpreadsheet',
    ]);
  });

  it('refuse d’écrire un chemin non autorisé par une boîte de dialogue (#1146)', async () => {
    await expect(handlers.get('file:writeContent')!({}, '/etc/passwd', 'x')).rejects.toThrow();
  });

  it('écrit des octets (fichier de données rendu par le contrat, ADR-0021) ou du texte', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-write-'));
    const bin = path.join(dir, 'a.bpm');
    const txt = path.join(dir, 'a.csv');
    authorizePath(bin, 'write');
    authorizePath(txt, 'write');
    await handlers.get('file:writeContent')!({}, bin, new Uint8Array([0, 255, 1]));
    await handlers.get('file:writeContent')!({}, txt, 'é;x');
    expect([...fs.readFileSync(bin)]).toEqual([0, 255, 1]);
    expect(fs.readFileSync(txt, 'utf-8')).toBe('é;x');
    await expect(handlers.get('file:writeContent')!({}, txt, { x: 1 })).rejects.toThrow();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('dialog:openFile binaire : octets bruts, option retirée du dialogue natif', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-open-'));
    const file = path.join(dir, 'tireurs.bpf');
    fs.writeFileSync(file, Buffer.from([80, 75, 3, 4]));
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
      canceled: false,
      filePaths: [file],
    });
    const r = await handlers.get('dialog:openFile')!(
      {},
      { filters: [{ name: 'BPF', extensions: ['bpf'] }], binary: true }
    );
    expect([...r.bytes]).toEqual([80, 75, 3, 4]);
    expect(r.filePath).toBe(file);
    expect((vi.mocked(dialog.showOpenDialog).mock.calls[0] as unknown[])[1]).toEqual({
      filters: [{ name: 'BPF', extensions: ['bpf'] }],
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
