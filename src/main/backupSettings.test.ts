import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  AUTOSAVE_FILE_NAME,
  competitionBackupDir,
  defaultBackupDir,
  importLegacyCompetitionBackupDirs,
  readBackupSettings,
  resolveBackupDir,
  sanitizeBackupDir,
  setCompetitionBackupDir,
  writeBackupSettings,
} from './backupSettings';

const tmpDirs: string[] = [];
const makeTmp = (): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-backup-'));
  tmpDirs.push(d);
  return d;
};

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('sanitizeBackupDir', () => {
  it('accepte un chemin absolu et le normalise', () => {
    expect(sanitizeBackupDir('  /home/club//sauvegardes/ ')).toBe(
      path.normalize('/home/club/sauvegardes/')
    );
  });

  it('refuse vide, relatif, octet nul ou non-texte', () => {
    for (const bad of ['', '   ', 'relatif/dossier', '/x\0y', 42, null, undefined]) {
      expect(sanitizeBackupDir(bad)).toBeNull();
    }
  });
});

describe('dossier par défaut', () => {
  it('vaut <Documents>/BPM - Escrime sans réglage', () => {
    const userData = makeTmp();
    const docs = '/home/u/Documents';
    expect(resolveBackupDir(userData, docs)).toEqual({
      dir: defaultBackupDir(docs),
      isDefault: true,
    });
    expect(defaultBackupDir(docs)).toBe(path.join(docs, 'BPM - Escrime'));
  });

  it('un réglage invalide dans le fichier retombe sur le défaut', () => {
    const userData = makeTmp();
    fs.writeFileSync(path.join(userData, 'backup-settings.json'), '{"dir":"relatif"}');
    expect(readBackupSettings(userData)).toEqual({});
    expect(resolveBackupDir(userData, '/d').isDefault).toBe(true);
  });

  it('fichier corrompu : pas d’exception, défaut', () => {
    const userData = makeTmp();
    fs.writeFileSync(path.join(userData, 'backup-settings.json'), '{pas du json');
    expect(readBackupSettings(userData)).toEqual({});
  });
});

describe('réglage utilisateur', () => {
  it('écrit puis relit le dossier choisi', () => {
    const userData = makeTmp();
    const chosen = path.join(makeTmp(), 'Club');
    writeBackupSettings(userData, { dir: chosen });
    expect(resolveBackupDir(userData, '/d')).toEqual({ dir: chosen, isDefault: false });
  });

  it('réinitialiser (réglage vide) rétablit le défaut', () => {
    const userData = makeTmp();
    writeBackupSettings(userData, { dir: makeTmp() });
    writeBackupSettings(userData, {});
    expect(resolveBackupDir(userData, '/d/Documents').isDefault).toBe(true);
  });

  it('le nom de la sauvegarde automatique est fixe', () => {
    expect(AUTOSAVE_FILE_NAME).toMatch(/\.bpm$/);
  });
});

describe('dossier propre d’une épreuve (docs/adr/0030)', () => {
  it('table épreuve → dossier : fixée, relue, retirée ; dossier du poste gardé', () => {
    const userData = makeTmp();
    const global = makeTmp();
    const own = makeTmp();
    writeBackupSettings(userData, { dir: global });
    setCompetitionBackupDir(userData, 'c1', own);
    expect(competitionBackupDir(userData, 'c1')).toBe(own);
    expect(competitionBackupDir(userData, 'c2')).toBeNull();
    expect(readBackupSettings(userData).dir).toBe(global);
    setCompetitionBackupDir(userData, 'c1', null);
    expect(readBackupSettings(userData)).toEqual({ dir: global });
  });

  it('entrée invalide du fichier (relative) ignorée à la lecture', () => {
    const userData = makeTmp();
    fs.writeFileSync(
      path.join(userData, 'backup-settings.json'),
      JSON.stringify({ competitions: { c1: 'relatif', c2: '/abs' } })
    );
    expect(readBackupSettings(userData).competitions).toEqual({ c2: path.normalize('/abs') });
  });
});

describe('reprise de settings.backupDir (docs/adr/0030)', () => {
  it('dossier existant repris, absent ignoré, puis plus jamais refaite', () => {
    const userData = makeTmp();
    const existing = makeTmp();
    const missing = path.join(makeTmp(), 'disparu');
    const comps = [
      { id: 'c1', settings: { backupDir: existing } },
      { id: 'c2', settings: { backupDir: missing } },
      { id: 'c3', settings: { backupDir: 'relatif' } },
      { id: 'c4', settings: {} },
      { id: 'c5' },
    ];
    const report = importLegacyCompetitionBackupDirs(userData, comps);
    expect(report).toEqual({
      imported: ['c1'],
      ignored: [
        { competitionId: 'c2', dir: missing },
        { competitionId: 'c3', dir: 'relatif' },
      ],
    });
    expect(readBackupSettings(userData)).toEqual({
      competitions: { c1: existing },
      legacyImported: true,
    });
    // Idempotente : une archive importée ensuite (autre poste) n'est jamais reprise
    const later = makeTmp();
    expect(
      importLegacyCompetitionBackupDirs(userData, [
        ...comps,
        { id: 'c6', settings: { backupDir: later } },
      ])
    ).toBeNull();
    expect(competitionBackupDir(userData, 'c6')).toBeNull();
    expect(competitionBackupDir(userData, 'c1')).toBe(existing);
  });

  it('un dossier déjà réglé sur le poste n’est pas remplacé ; dossier du poste gardé', () => {
    const userData = makeTmp();
    const global = makeTmp();
    const chosen = makeTmp();
    writeBackupSettings(userData, { dir: global, competitions: { c1: chosen } });
    importLegacyCompetitionBackupDirs(userData, [{ id: 'c1', settings: { backupDir: makeTmp() } }]);
    expect(readBackupSettings(userData)).toEqual({
      dir: global,
      competitions: { c1: chosen },
      legacyImported: true,
    });
  });
});
