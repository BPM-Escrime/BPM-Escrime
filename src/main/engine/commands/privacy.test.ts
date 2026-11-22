/**
 * RGPD (#1882) par le contrat : conservation, entrées non fiables, compétition ouverte,
 * compactage après effacement (dépôt simulé ; le chemin SQLite réel est dans station.test.ts).
 */
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { applyRetention } from './privacy';
import { getNameMasking, setNameMasking } from '../../remote/publicDto';
import {
  readPrivacySettings,
  sanitizePrivacySettings,
  writePrivacySettings,
} from '../../privacySettings';
import { DEFAULT_PRIVACY_SETTINGS, type PrivacySettings } from '../../../shared/types/privacy';
import type { DatabaseManager } from '../../../database';
import type { CommandContext, StationPort } from './context';
import type { OperationName } from '../../../shared/api/contract';
import { invoke } from '../api/engine';

function fakeDb() {
  const privacy = {
    listRetentionCandidates: vi.fn(() => ({
      competitions: [{ id: 'c1', title: 'A', date: '2019-01-01', fencerCount: 3 }],
      members: [{ id: 'm1', lastName: 'X', firstName: 'Y', clubName: '', lastActivity: '' }],
    })),
    purgeCompetition: vi.fn(),
    anonymizeCompetition: vi.fn(),
    eraseMembersById: vi.fn(),
    anonymizeMembersById: vi.fn(),
    findPersons: vi.fn(() => []),
    anonymizePerson: vi.fn(() => ({ fencers: 0, members: 0, pseudonym: 'P' })),
    erasePerson: vi.fn(() => ({ fencers: 1, members: 0 })),
    competitionIdsOf: vi.fn(() => ['c-open']),
  };
  const compactAfterErasure = vi.fn();
  return {
    privacy,
    compactAfterErasure,
    db: { privacy, isOpen: () => true, compactAfterErasure } as unknown as DatabaseManager,
  };
}

describe('applyRetention', () => {
  it('anonymise par défaut, supprime sur demande', () => {
    const { privacy, db } = fakeDb();
    const s = {
      ...DEFAULT_PRIVACY_SETTINGS,
      competitionRetentionMonths: 12,
      memberRetentionMonths: 12,
    };
    expect(applyRetention(db, s)).toEqual({ competitions: 1, members: 1 });
    expect(privacy.anonymizeCompetition).toHaveBeenCalledWith('c1');
    expect(privacy.anonymizeMembersById).toHaveBeenCalledWith(['m1']);
    applyRetention(db, { ...s, retentionAction: 'delete' });
    expect(privacy.purgeCompetition).toHaveBeenCalledWith('c1', false);
    expect(privacy.eraseMembersById).toHaveBeenCalledWith(['m1']);
  });

  it('restreint à la sélection', () => {
    const { privacy, db } = fakeDb();
    const r = applyRetention(db, DEFAULT_PRIVACY_SETTINGS, {
      competitionIds: [],
      memberIds: ['m1'],
    });
    expect(r).toEqual({ competitions: 0, members: 1 });
    expect(privacy.anonymizeCompetition).not.toHaveBeenCalled();
  });

  it('ignore une compétition ouverte, compacte la base après purge (#1882)', () => {
    const { privacy, db, compactAfterErasure } = fakeDb();
    const r = applyRetention(
      db,
      DEFAULT_PRIVACY_SETTINGS,
      undefined,
      new Date(),
      id => id === 'c1'
    );
    expect(r).toEqual({ competitions: 0, members: 1 });
    expect(privacy.anonymizeCompetition).not.toHaveBeenCalled();
    expect(compactAfterErasure).toHaveBeenCalled();
  });
});

describe('opérations RGPD du contrat', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'privacy-api-'));
  const station = (busy: (id: string) => boolean = () => false) =>
    ({
      privacy: {
        settings: () => readPrivacySettings(dir),
        update: (input: Partial<PrivacySettings>) => {
          const settings = sanitizePrivacySettings(input, readPrivacySettings(dir));
          writePrivacySettings(dir, settings);
          setNameMasking(settings.nameMasking);
          return settings;
        },
        isCompetitionBusy: busy,
      },
    }) as unknown as StationPort;
  const call = (ctx: CommandContext, op: OperationName, input: Record<string, unknown>) =>
    invoke(ctx, op, input);

  it('enregistre et applique les réglages (noms abrégés à chaud)', async () => {
    const ctx = { db: fakeDb().db, station: station() };
    const settings = await call(ctx, 'updatePrivacySettings', { nameMasking: 'initial' });
    expect(settings).toMatchObject({ nameMasking: 'initial' });
    expect(getNameMasking()).toBe('initial');
    expect(await call(ctx, 'getPrivacySettings', {})).toMatchObject({ nameMasking: 'initial' });
    await expect(call(ctx, 'updatePrivacySettings', { nameMasking: 'x' })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    setNameMasking('full');
  });

  it('entrées non fiables refusées par le schéma, requête tronquée à 100 caractères', async () => {
    const f = fakeDb();
    const ctx = { db: f.db, station: station() };
    await expect(call(ctx, 'listPrivacyPersons', { query: 42 })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(
      call(ctx, 'anonymizePerson', { fencerIds: ['a', 3], memberIds: 'x' })
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await call(ctx, 'listPrivacyPersons', { query: 'x'.repeat(300) });
    expect(f.privacy.findPersons).toHaveBeenCalledWith('x'.repeat(100));
    await call(ctx, 'anonymizePerson', { fencerIds: ['a'] });
    expect(f.privacy.anonymizePerson).toHaveBeenCalledWith({ fencerIds: ['a'], memberIds: [] });
  });

  it('compétition ouverte : anonymisation et effacement refusés (#1882)', async () => {
    const f = fakeDb();
    const ctx = { db: f.db, station: station(id => id === 'c-open') };
    const ref = { fencerIds: ['a'], memberIds: [] };
    await expect(call(ctx, 'anonymizePerson', ref)).rejects.toMatchObject({
      code: 'competition_open',
    });
    await expect(call(ctx, 'erasePerson', ref)).rejects.toMatchObject({ code: 'competition_open' });
    expect(f.privacy.anonymizePerson).not.toHaveBeenCalled();
    expect(f.privacy.erasePerson).not.toHaveBeenCalled();
  });

  it('effacement : base compactée ensuite (#1882)', async () => {
    const f = fakeDb();
    const ctx = { db: f.db, station: station() };
    // Le dépôt simulé annonce une épreuve de la personne, mais aucune n'est ouverte
    await call(ctx, 'erasePerson', { fencerIds: ['a'] });
    expect(f.privacy.erasePerson).toHaveBeenCalled();
    expect(f.compactAfterErasure).toHaveBeenCalled();
  });

  it('conservation par le contrat : seuls les identifiants listés sont traités', async () => {
    const f = fakeDb();
    const ctx = { db: f.db, station: station() };
    expect(await call(ctx, 'applyRetention', {})).toEqual({ competitions: 0, members: 0 });
    expect(await call(ctx, 'applyRetention', { memberIds: ['m1'] })).toEqual({
      competitions: 0,
      members: 1,
    });
    expect(f.privacy.anonymizeCompetition).not.toHaveBeenCalled();
  });
});
