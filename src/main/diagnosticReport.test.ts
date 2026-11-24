import { describe, it, expect } from 'vitest';
import {
  buildDiagnosticReport,
  diagnosticFileName,
  diagnosticReportFile,
  type DiagnosticInput,
} from './diagnosticReport';

const input: DiagnosticInput = {
  appVersion: '5.9.0',
  build: 1521,
  channel: 'dev',
  platform: 'linux',
  arch: 'x64',
  osRelease: '6.8.0',
  locale: 'fr',
  electronVersion: '45.0.0',
  chromeVersion: '130.0.0',
  nodeVersion: '24.0.0',
  uptimeSeconds: 120,
  memoryRssMb: 210,
  activeRemoteServers: 2,
  generatedAt: new Date('2026-10-30T19:28:00.000Z'),
};

describe('buildDiagnosticReport (#1326)', () => {
  it('ne garde que la liste blanche de champs', () => {
    const report = buildDiagnosticReport({
      ...input,
      // champs parasites : ne doivent jamais sortir dans le rapport
      password: 'secret',
      token: 'jeton',
      dataPath: '/home/user/.config/bpm-escrime',
      fencerName: 'DUPONT Jean',
    } as DiagnosticInput);
    expect(Object.keys(report).sort()).toEqual([
      'app',
      'generatedAt',
      'runtime',
      'schemaVersion',
      'system',
    ]);
    expect(JSON.stringify(report)).not.toMatch(/secret|jeton|bpm-escrime|DUPONT/);
  });

  it('sérialise la date en ISO et conserve les versions', () => {
    const report = buildDiagnosticReport(input);
    expect(report.schemaVersion).toBe(1);
    expect(report.generatedAt).toBe('2026-10-30T19:28:00.000Z');
    expect(report.app).toEqual({ version: '5.9.0', build: 1521, channel: 'dev' });
    expect(report.runtime).toEqual({
      electron: '45.0.0',
      chrome: '130.0.0',
      node: '24.0.0',
      uptimeSeconds: 120,
      memoryRssMb: 210,
      activeRemoteServers: 2,
    });
  });
});

describe('diagnosticFileName (#1326)', () => {
  it('produit un nom de fichier horodaté sans caractères interdits', () => {
    expect(diagnosticFileName('2026-10-30T19:28:00.000Z')).toBe(
      'bpm-escrime-diagnostic-20261030T192800.json'
    );
  });
});

describe('diagnosticReportFile (#1326)', () => {
  it('nom proposé horodaté et JSON indenté terminé par un saut de ligne', () => {
    const file = diagnosticReportFile(input);
    expect(file.fileName).toBe('bpm-escrime-diagnostic-20261030T192800.json');
    expect(file.text.endsWith('}\n')).toBe(true);
    expect(JSON.parse(file.text).app.build).toBe(1521);
  });
});
