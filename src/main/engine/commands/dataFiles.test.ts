// @vitest-environment node
/**
 * Fichiers de données par le contrat (#1981, ADR-0021) sur une base SQLite réelle : sauvegarde
 * .bpm (en clair, chiffrée, réouverture), archive de tireurs .bpf, photos ZIP, sauvegarde de
 * club .bpclub. Contenu base64 en entrée et en sortie, jamais de chemin.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import JSZip from 'jszip';
import { DatabaseManager } from '../../../database';
import { Category, Gender, Weapon, type Fencer } from '../../../shared/types';
import type { CommandContext } from './context';
import { invoke } from '../api/engine';
import { ApiError } from '../../../shared/api/client';
import { xlsxToRows } from '../../xlsxToCsv';
import { contract } from '../../../shared/api/contract';
import { STATION_PERMISSIONS } from '../../../shared/api/contractDef';
import { WS_READ_PERMISSIONS } from '../api/wsAdapter';

// Base native (VACUUM INTO, ATTACH), comme database/bpmSnapshot.test.ts
const d = describe;

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
let dir: string;
let db: DatabaseManager;
let ctx: CommandContext;
let competitionId: string;
const changes: unknown[] = [];

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-datafiles-'));
  db = new DatabaseManager(path.join(dir, 'bellepoule.db'));
  await db.open();
  changes.length = 0;
  ctx = { db, emitChange: c => changes.push(c) };
  competitionId = db.createCompetition({
    title: 'Open / Rennes',
    date: new Date('2026-12-06'),
    weapon: Weapon.EPEE,
    gender: Gender.MALE,
    category: Category.SENIOR,
  } as never).id;
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const run = (op: string, input: Record<string, unknown>) =>
  invoke(ctx, op as never, input as never) as Promise<any>;

const addFencer = (lastName: string, extra: Partial<Fencer> = {}) =>
  db.addFencer(competitionId, { firstName: 'P', lastName, ...extra } as never) as Fencer;

/** Aucun fichier temporaire laissé à côté de la base */
const leftovers = () => fs.readdirSync(dir).filter(f => f.startsWith('.'));

const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as ApiError;
  }
  throw new Error('refus attendu');
};

d('sauvegarde .bpm', () => {
  it('getCompetitionFile rend une base SQLite autonome, rouverte par openCompetitionFile', async () => {
    addFencer('Dupont');
    const file = await run('getCompetitionFile', { competitionId });
    expect(file.fileName).toBe('Open Rennes.bpm');
    const bytes = Buffer.from(file.content, 'base64');
    expect(bytes.subarray(0, 15).toString('ascii')).toBe('SQLite format 3');
    expect(leftovers()).toEqual([]);

    db.deleteCompetition(competitionId);
    const { competitionIds } = await run('openCompetitionFile', { content: file.content });
    expect(competitionIds).toEqual([competitionId]);
    expect(db.getFencersByCompetition(competitionId).map(f => f.lastName)).toEqual(['Dupont']);
    expect(changes).toContainEqual({ scope: 'competitions', competitionIds: [competitionId] });
    expect(leftovers()).toEqual([]);
  });

  it('archive chiffrée : mot de passe requis, faux, puis bon ; mot de passe trop court refusé', async () => {
    const weak = await refusal(
      run('getEncryptedCompetitionFile', { competitionId, password: 'court' })
    );
    expect(weak.code).toBe('weak_password');

    const file = await run('getEncryptedCompetitionFile', {
      competitionId,
      password: 'motdepasse',
    });
    expect(Buffer.from(file.content, 'base64').subarray(0, 8).toString('ascii')).toBe('BPMENC1\n');
    db.deleteCompetition(competitionId);

    expect((await refusal(run('openCompetitionFile', { content: file.content }))).code).toBe(
      'password_required'
    );
    const wrong = await refusal(
      run('openCompetitionFile', { content: file.content, password: 'pas-le-bon' })
    );
    expect(wrong.code).toBe('wrong_password');
    expect(wrong.message).not.toContain('pas-le-bon');
    const ok = await run('openCompetitionFile', { content: file.content, password: 'motdepasse' });
    expect(ok.competitionIds).toEqual([competitionId]);
    expect(leftovers()).toEqual([]);
  });

  it('toute la base chiffrée (competitionId nul) ; fichier qui n’est pas une sauvegarde : invalid_file', async () => {
    const all = await run('getEncryptedCompetitionFile', {
      competitionId: null,
      password: 'motdepasse',
    });
    expect(all.fileName).toBe('competition.bpm');
    const bad = await refusal(
      run('openCompetitionFile', { content: Buffer.from('pas une base').toString('base64') })
    );
    expect(bad.code).toBe('invalid_file');
    const unknown = await refusal(run('getCompetitionFile', { competitionId: 'inconnue' }));
    expect(unknown.code).toBe('competition_not_found');
  });

  it('contenu qui n’est pas du base64 : invalid_input', async () => {
    const e = await refusal(run('openCompetitionFile', { content: 'pas du base64 !' }));
    expect(e.code).toBe('invalid_input');
  });
});

d('archive de tireurs .bpf', () => {
  it('export puis réimport : mise à jour par licence, ajout sinon ; statut jamais importé', async () => {
    addFencer('Dupont', { license: '123', club: 'Rennes' } as never);
    const file = await run('getFencersArchive', { competitionId });
    expect(file.count).toBe(1);
    expect(file.fileName).toBe('tireurs-Open Rennes.bpf');

    const target = db.createCompetition({ title: 'Autre' } as never).id;
    const first = await run('importFencersArchive', {
      competitionId: target,
      content: file.content,
    });
    expect(first).toEqual({ added: 1, updated: 0 });
    const imported = db.getFencersByCompetition(target);
    expect(imported[0]).toMatchObject({ lastName: 'Dupont', license: '123', club: 'Rennes' });
    expect(imported[0].id).not.toBe(db.getFencersByCompetition(competitionId)[0].id);
    expect(changes).toContainEqual({ scope: 'fencers', competitionIds: [target] });

    // Archive forgée : statut et identifiant ignorés, même licence → mise à jour
    const zip = new JSZip();
    zip.file(
      'fencers.json',
      JSON.stringify([
        { id: 'x', lastName: 'Dupont', firstName: 'P', license: '123', club: 'Brest', status: 'E' },
      ])
    );
    const forged = (await zip.generateAsync({ type: 'nodebuffer' })).toString('base64');
    const second = await run('importFencersArchive', { competitionId: target, content: forged });
    expect(second).toEqual({ added: 0, updated: 1 });
    const after = db.getFencersByCompetition(target)[0];
    expect(after.club).toBe('Brest');
    expect(after.status).toBe(imported[0].status);
  });

  it('équipe (docs/adr/0043) : membres, niveau et marqueur HANDI suivent le tireur', async () => {
    const members = [
      { lastName: 'DURAND', firstName: 'Éva', gender: 'F', birthDate: '1989-06-01' },
      { lastName: 'PETIT', firstName: 'Noé' },
    ];
    db.updateFencer(addFencer('Les Lames', { license: 'EQ1' } as never).id, {
      members,
      level: 2,
      handicap: true,
    } as never);
    const file = await run('getFencersArchive', { competitionId });
    const target = db.createCompetition({ title: 'Équipes' } as never).id;
    await run('importFencersArchive', { competitionId: target, content: file.content });
    expect(db.getFencersByCompetition(target)[0]).toMatchObject({
      members,
      level: 2,
      handicap: true,
    });
    // Archive forgée : membres illisibles ou hors bornes ignorés
    const zip = new JSZip();
    zip.file(
      'fencers.json',
      JSON.stringify([
        { lastName: 'Forge', firstName: 'x', members: [3, { lastName: 5 }], level: 'fort' },
      ])
    );
    const forged = (await zip.generateAsync({ type: 'nodebuffer' })).toString('base64');
    await run('importFencersArchive', { competitionId: target, content: forged });
    const forgedFencer = db.getFencersByCompetition(target).find(f => f.lastName === 'Forge')!;
    expect(forgedFencer.members).toBeUndefined();
    expect(forgedFencer.level).toBeUndefined();
  });

  it('archive invalide : invalid_file ; épreuve inconnue : competition_not_found', async () => {
    const notZip = Buffer.from('nope').toString('base64');
    expect(
      (await refusal(run('importFencersArchive', { competitionId, content: notZip }))).code
    ).toBe('invalid_file');
    const zip = new JSZip();
    zip.file('meta.json', '{}');
    const noFencers = (await zip.generateAsync({ type: 'nodebuffer' })).toString('base64');
    expect(
      (await refusal(run('importFencersArchive', { competitionId, content: noFencers }))).code
    ).toBe('invalid_file');
    expect(
      (await refusal(run('importFencersArchive', { competitionId: 'x', content: noFencers }))).code
    ).toBe('competition_not_found');
  });
});

d('photos ZIP', () => {
  it('export puis import : photo appliquée au tireur de même licence', async () => {
    addFencer('Dupont', { license: '123', photo: PNG } as never);
    addFencer('Martin', { license: '456' } as never);
    const file = await run('getFencerPhotosArchive', { competitionId });
    expect(file.count).toBe(1);
    const zip = await JSZip.loadAsync(Buffer.from(file.content, 'base64'));
    expect(Object.keys(zip.files)).toEqual(['123.jpg']);

    const back = new JSZip();
    back.file('456.png', Buffer.from('iVBORw0KGgo=', 'base64'));
    back.file('999.jpg', Buffer.from('x'));
    back.file('notes.txt', 'ignoré');
    const content = (await back.generateAsync({ type: 'nodebuffer' })).toString('base64');
    expect(await run('importFencerPhotos', { competitionId, content })).toEqual({
      matched: 1,
      total: 2,
    });
    const martin = db.getFencersByCompetition(competitionId).find(f => f.lastName === 'Martin');
    expect(martin?.photo).toBe(PNG);
  });
});

d('Mode Club', () => {
  it('sauvegarde .bpclub rechargée ; club déjà présent : club_exists, sauf replace', async () => {
    const club = db.club.createClub({ name: 'Cercle' } as never) as { id: string };
    const file = await run('getClubBackupFile', { clubId: club.id });
    expect(file.clubName).toBe('Cercle');
    const exists = await refusal(run('importClubBackup', { content: file.content }));
    expect(exists.code).toBe('club_exists');
    const replaced = await run('importClubBackup', { content: file.content, replace: true });
    expect(replaced).toMatchObject({ clubId: club.id, clubName: 'Cercle', replaced: true });
    const bad = await refusal(
      run('importClubBackup', { content: Buffer.from('x').toString('base64') })
    );
    expect(bad.code).toBe('invalid_file');
    const unknown = await refusal(run('getClubBackupFile', { clubId: 'inconnu' }));
    expect(unknown.code).toBe('club_refused');
  });

  it('photos du club par licence', async () => {
    const club = db.club.createClub({ name: 'Cercle' } as never) as { id: string };
    db.club.createMember(club.id, { lastName: 'Durand', firstName: 'A', license: '42' } as never);
    const zip = new JSZip();
    zip.file('42.png', Buffer.from('iVBORw0KGgo=', 'base64'));
    const content = (await zip.generateAsync({ type: 'nodebuffer' })).toString('base64');
    const r = await run('importClubPhotos', { clubId: club.id, content });
    expect(r).toMatchObject({ matched: 1, total: 1 });
  });
});

d('Tableur .xlsx (ex-canal file:writeSpreadsheet)', () => {
  it('grille → classeur en base64, relu à l’identique', async () => {
    const { content } = await run('getSpreadsheetFile', {
      rows: [
        ['Article', 'Prix'],
        ['Masque', 120],
      ],
      sheetName: 'Inventaire',
    });
    expect(await xlsxToRows(Buffer.from(content, 'base64'))).toEqual([
      ['Article', 'Prix'],
      ['Masque', '120'],
    ]);
  });

  it('droits : club:read pour le tableur, station:admin pour le diagnostic, jamais sur le réseau', () => {
    expect(contract.getSpreadsheetFile.permission).toBe('club:read');
    expect(contract.getDiagnosticReport.permission).toBe('station:admin');
    expect(STATION_PERMISSIONS.has('club:read')).toBe(true);
    expect(WS_READ_PERMISSIONS.has('club:read')).toBe(false);
  });

  it('cellule d’un autre type ou trop de colonnes : invalid_input', async () => {
    expect((await refusal(run('getSpreadsheetFile', { rows: [[{ x: 1 }]] }))).code).toBe(
      'invalid_input'
    );
    const wide = [Array.from({ length: 201 }, () => 'x')];
    expect((await refusal(run('getSpreadsheetFile', { rows: wide }))).code).toBe('invalid_input');
  });
});
