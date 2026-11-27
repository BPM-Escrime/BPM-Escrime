/**
 * BPM - Escrime - Fichiers de données du poste par le contrat (#1981, docs/adr/0021 et 0022)
 * Reprise des anciens canaux IPC file:exportCompetition, file:exportFencersArchive,
 * file:importFencersArchive, file:exportPhotos, file:importPhotos, privacy:exportEncryptedBpm,
 * privacy:openEncryptedBpm, club:importPhotos, club:exportBackup, club:importBackup,
 * diagnostic:exportReport, file:writeSpreadsheet : contenu
 * base64 en entrée et en sortie, jamais de chemin. Les copies en clair d'une base passent par
 * un fichier temporaire du dossier de la base (userData), supprimé aussitôt.
 * Les imports dans une épreuve décodent l'archive (asynchrone) puis écrivent par runCommand
 * (engine.ts) : `importArchiveFencers` et `applyFencerPhotos` sont synchrones.
 * Licensed under GPL-3.0
 */
import * as fs from 'fs';
import * as path from 'path';
import type { z } from 'zod';
import type { fileOperations } from '../../../shared/api/contractFiles';
import { Gender, type Fencer, type FencerMember } from '../../../shared/types';
import { logger, LogCategory, toError } from '../../../shared/services/logger';
import {
  decryptBpmBuffer,
  encryptBpmBuffer,
  isEncryptedBpmBuffer,
  MIN_BPM_PASSWORD,
} from '../../bpmCrypto';
import { decodeClubBackup, encodeClubBackup } from '../../clubBackupFile';
import { unpackFederalFiles } from '../../federalFiles';
import { diagnosticReportFile } from '../../diagnosticReport';
import { rowsToXlsx } from '../../xlsxToCsv';
import { CLUB_EXISTS_ERROR } from '../../../database/repos/clubBackupRepo';
import {
  fencersFromArchive,
  fencersToArchive,
  InvalidFileError,
  photosFromZip,
  photosToZip,
} from '../../dataFileCodec';
import { CommandError, type CommandContext } from './context';
import { getCompetitionOrThrow } from './competitions';
import { refusing } from './refusal';
import { portOf } from './stationSupport';

type Ops = typeof fileOperations;
type FileHandler<N extends keyof Ops> = (
  ctx: CommandContext,
  input: z.output<Ops[N]['input']>
) => z.output<Ops[N]['output']> | Promise<z.output<Ops[N]['output']>>;

const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'ascii');

/** Nom de fichier sûr tiré d'un titre */
export function safeFileName(title: string | undefined | null, fallback: string): string {
  const base = String(title ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return base || fallback;
}

const fromBase64 = (content: string) => Buffer.from(content, 'base64');

/** Archive ou format illisible → invalid_file (message pour l'opérateur) */
async function decoding<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof InvalidFileError) throw new CommandError('invalid_file', e.message);
    throw e;
  }
}

/** Fichier temporaire à côté de la base (userData), supprimé avec ses compagnons SQLite */
async function withTempFile<T>(
  ctx: CommandContext,
  prefix: string,
  fn: (tmp: string) => Promise<T>
): Promise<T> {
  const tmp = path.join(
    path.dirname(ctx.db.getPath()),
    `.${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.bpm`
  );
  try {
    return await fn(tmp);
  } finally {
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`, `${tmp}-journal`]) {
      await fs.promises.unlink(f).catch(() => undefined);
    }
  }
}

/** Sauvegarde en clair : une épreuve, ou toute la base (competitionId nul) */
function plainCopy(ctx: CommandContext, competitionId: string | null): Promise<Buffer> {
  return withTempFile(ctx, 'export', async tmp => {
    if (competitionId) await ctx.db.exportCompetitionToFile(competitionId, tmp);
    else await ctx.db.exportToFile(tmp);
    return fs.promises.readFile(tmp);
  });
}

/** Champs d'identité repris d'une archive .bpf ; jamais statut, classement final ni scores */
function archiveFencer(raw: Record<string, unknown>): Partial<Fencer> {
  const str = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string) : undefined);
  const out: Partial<Fencer> = { lastName: str('lastName'), firstName: str('firstName') };
  for (const k of ['nationality', 'region', 'department', 'club', 'license', 'photo'] as const) {
    const v = str(k);
    if (v !== undefined) out[k] = v;
  }
  const birth = str('birthDate');
  if (birth && !Number.isNaN(Date.parse(birth))) out.birthDate = new Date(birth);
  const gender = str('gender');
  if (gender && (Object.values(Gender) as string[]).includes(gender)) out.gender = gender as Gender;
  if (raw.handedness === 'L' || raw.handedness === 'R') out.handedness = raw.handedness;
  if (typeof raw.ranking === 'number' && Number.isInteger(raw.ranking) && raw.ranking > 0) {
    out.ranking = raw.ranking;
  }
  // Équipe (binôme, docs/adr/0043) : les membres, le niveau et le marqueur HANDI suivent le tireur
  if (Array.isArray(raw.members)) {
    const members = raw.members
      .filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null)
      .slice(0, 10)
      .map((m): FencerMember => ({
        lastName: typeof m.lastName === 'string' ? m.lastName.slice(0, 200) : '',
        firstName: typeof m.firstName === 'string' ? m.firstName.slice(0, 200) : '',
        ...(m.gender === 'M' || m.gender === 'F' ? { gender: m.gender } : {}),
        ...(typeof m.birthDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(m.birthDate)
          ? { birthDate: m.birthDate }
          : {}),
      }))
      .filter(m => m.lastName || m.firstName);
    if (members.length > 0) out.members = members;
  }
  if (typeof raw.level === 'number' && Number.isInteger(raw.level) && raw.level >= 1) {
    out.level = Math.min(raw.level, 20);
  }
  if (typeof raw.handicap === 'boolean') out.handicap = raw.handicap;
  return out;
}

/** Tireurs décodés d'une archive .bpf (avant l'écriture) */
export function decodeFencersArchive(content: string): Promise<Partial<Fencer>[]> {
  return decoding(async () => (await fencersFromArchive(fromBase64(content))).map(archiveFencer));
}

/** Écriture synchrone (runCommand) : mise à jour par licence, sinon nom et prénom ; ou ajout */
export function importArchiveFencers(
  ctx: CommandContext,
  competitionId: string,
  fencers: Partial<Fencer>[]
): { added: number; updated: number } {
  const comp = getCompetitionOrThrow(ctx, competitionId);
  const result = ctx.db.upsertFencersByLicense(comp.id, fencers);
  if (result.added || result.updated) {
    ctx.emitChange?.({ scope: 'fencers', competitionIds: [comp.id] });
  }
  return result;
}

/** Photos décodées d'un ZIP (avant l'écriture) */
export function decodePhotosZip(content: string): Promise<{ license: string; photo: string }[]> {
  return decoding(() => photosFromZip(fromBase64(content)));
}

/** Écriture synchrone (runCommand) : photos appliquées aux tireurs de même licence */
export function applyFencerPhotos(
  ctx: CommandContext,
  competitionId: string,
  photos: { license: string; photo: string }[]
): { matched: number; total: number } {
  const comp = getCompetitionOrThrow(ctx, competitionId);
  const result = ctx.db.updateFencerPhotosByLicense(comp.id, photos);
  if (result.matched) ctx.emitChange?.({ scope: 'fencers', competitionIds: [comp.id] });
  return result;
}

const getCompetitionFile: FileHandler<'getCompetitionFile'> = async (ctx, { competitionId }) => {
  const comp = getCompetitionOrThrow(ctx, competitionId);
  const content = await plainCopy(ctx, comp.id);
  return {
    fileName: `${safeFileName(comp.title, 'competition')}.bpm`,
    content: content.toString('base64'),
  };
};

const getEncryptedCompetitionFile: FileHandler<'getEncryptedCompetitionFile'> = async (
  ctx,
  { competitionId, password }
) => {
  if (password.length < MIN_BPM_PASSWORD) {
    throw new CommandError(
      'weak_password',
      `Mot de passe de ${MIN_BPM_PASSWORD} caractères minimum`
    );
  }
  const comp = competitionId ? getCompetitionOrThrow(ctx, competitionId) : null;
  const plain = await plainCopy(ctx, comp?.id ?? null);
  const encrypted = await encryptBpmBuffer(plain, password);
  return {
    fileName: `${safeFileName(comp?.title, 'competition')}.bpm`,
    content: encrypted.toString('base64'),
  };
};

const openCompetitionFile: FileHandler<'openCompetitionFile'> = async (
  ctx,
  { content, password }
) => {
  let data: Buffer = fromBase64(content);
  if (isEncryptedBpmBuffer(data)) {
    if (!password)
      throw new CommandError('password_required', 'Archive chiffrée : mot de passe requis');
    try {
      data = await decryptBpmBuffer(data, password);
    } catch (e) {
      if (e instanceof Error && e.message === 'wrong_password') {
        throw new CommandError('wrong_password', 'Mot de passe faux ou archive altérée');
      }
      throw new CommandError('invalid_file', 'Archive chiffrée illisible');
    }
  }
  if (
    data.length < SQLITE_MAGIC.length ||
    !data.subarray(0, SQLITE_MAGIC.length).equals(SQLITE_MAGIC)
  ) {
    throw new CommandError(
      'invalid_file',
      "Ce fichier n'est pas une sauvegarde BPM - Escrime (.bpm)"
    );
  }
  const competitionIds = await withTempFile(ctx, 'open', async tmp => {
    await fs.promises.writeFile(tmp, data);
    try {
      return await ctx.db.mergeFromFile(tmp);
    } catch (e) {
      logger.error(LogCategory.DATABASE, '[fichiers] sauvegarde .bpm illisible', toError(e));
      throw new CommandError('invalid_file', 'Sauvegarde .bpm illisible');
    }
  });
  ctx.emitChange?.({ scope: 'competitions', competitionIds });
  return { competitionIds };
};

const getFencersArchive: FileHandler<'getFencersArchive'> = async (ctx, { competitionId }) => {
  const comp = getCompetitionOrThrow(ctx, competitionId);
  const fencers = ctx.db.getFencersByCompetition(comp.id);
  const content = await fencersToArchive(fencers, comp.title ?? '');
  return {
    fileName: `tireurs-${safeFileName(comp.title, 'competition')}.bpf`,
    content: content.toString('base64'),
    count: fencers.length,
  };
};

const getFencerPhotosArchive: FileHandler<'getFencerPhotosArchive'> = async (
  ctx,
  { competitionId }
) => {
  const comp = getCompetitionOrThrow(ctx, competitionId);
  const photos = ctx.db.getFencerPhotos(comp.id);
  const content = await photosToZip(photos);
  return {
    fileName: `photos-${safeFileName(comp.title, 'competition')}.zip`,
    content: content.toString('base64'),
    count: photos.length,
  };
};

const importClubPhotos: FileHandler<'importClubPhotos'> = async (ctx, { clubId, content }) => {
  const photos = await decodePhotosZip(content);
  return refusing('club_refused', () => ctx.db.club.setPhotosByLicense(clubId, photos));
};

const getClubBackupFile: FileHandler<'getClubBackupFile'> = async (ctx, { clubId }) => {
  const backup = refusing('club_refused', () => ctx.db.clubBackup.exportClub(clubId));
  const content = await encodeClubBackup(backup);
  return { clubName: backup.clubName, content: content.toString('base64') };
};

const importClubBackup: FileHandler<'importClubBackup'> = async (ctx, { content, replace }) => {
  let data: unknown;
  try {
    data = await decodeClubBackup(fromBase64(content));
  } catch (e) {
    throw new CommandError('invalid_file', e instanceof Error ? e.message : String(e));
  }
  try {
    return ctx.db.clubBackup.importClub(data, replace === true);
  } catch (e) {
    if (e instanceof Error && e.message === CLUB_EXISTS_ERROR) {
      throw new CommandError('club_exists', 'Ce club existe déjà sur ce poste');
    }
    return refusing('club_refused', () => {
      throw e;
    });
  }
};

/** Fichiers de l'extranet fédéral décodés (#1938, #2134) : refus explicite si illisibles */
async function listFederalFiles(
  _ctx: CommandContext,
  { files }: { files: Array<{ name: string; content: string }> }
) {
  try {
    return await unpackFederalFiles(
      files.map(f => ({ name: f.name, bytes: new Uint8Array(fromBase64(f.content)) }))
    );
  } catch (e) {
    throw new CommandError('invalid_file', e instanceof Error ? e.message : 'Fichier illisible');
  }
}

/** Rapport de diagnostic du poste (#1326) : JSON, liste blanche de champs techniques */
const getDiagnosticReport: FileHandler<'getDiagnosticReport'> = ctx => {
  const { fileName, text } = diagnosticReportFile(portOf(ctx).diagnostics());
  return { fileName, content: Buffer.from(text, 'utf-8').toString('base64') };
};

/** Tableur .xlsx d'une feuille (Mode Club : inventaire, membres) */
const getSpreadsheetFile: FileHandler<'getSpreadsheetFile'> = async (_ctx, { rows, sheetName }) => {
  const content = await rowsToXlsx(rows, sheetName);
  return { content: content.toString('base64') };
};

/** Opérations sans écriture dans une épreuve ; les deux imports d'épreuve sont dans engine.ts */
export const dataFileHandlers = {
  listFederalFiles,
  getCompetitionFile,
  getEncryptedCompetitionFile,
  openCompetitionFile,
  getFencersArchive,
  getFencerPhotosArchive,
  importClubPhotos,
  getClubBackupFile,
  importClubBackup,
  getDiagnosticReport,
  getSpreadsheetFile,
};
