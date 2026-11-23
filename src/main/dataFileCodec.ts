/**
 * BPM - Escrime - Codage des fichiers de données en mémoire (#1981, docs/adr/0021) :
 * photos en ZIP (compétition et Mode Club), archive de tireurs .bpf. Contenu en entrée et en
 * sortie, jamais de chemin : partagé par les opérations du contrat (engine/commands/dataFiles).
 * Licensed under GPL-3.0
 */
import * as path from 'path';
import JSZip from 'jszip';
import { checkZipEntries, validateImportedFencers, ZIP_LIMITS } from './pathAuthorization';

/** Erreur de format : message pour l'opérateur, rendu sous le code invalid_file */
export class InvalidFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidFileError';
  }
}

async function loadZip(buffer: Buffer, what: string): Promise<JSZip> {
  if (buffer.length > ZIP_LIMITS.maxFileBytes) {
    throw new InvalidFileError(`Fichier trop volumineux (max ${ZIP_LIMITS.maxFileBytes} octets)`);
  }
  try {
    return await JSZip.loadAsync(buffer);
  } catch {
    throw new InvalidFileError(`Ce fichier n'est pas ${what}`);
  }
}

/** Entrées sûres d'une archive ; archive trop grosse ou trop d'entrées → invalid_file */
function entries(zip: JSZip): string[] {
  try {
    return checkZipEntries(zip);
  } catch (e) {
    throw new InvalidFileError(e instanceof Error ? e.message : String(e));
  }
}

/** Photos d'un ZIP : fichiers .jpg/.jpeg/.png nommés par licence → { license, data URL } */
export async function photosFromZip(buffer: Buffer): Promise<{ license: string; photo: string }[]> {
  const zip = await loadZip(buffer, 'une archive ZIP de photos');
  const photos: { license: string; photo: string }[] = [];
  for (const filename of entries(zip)) {
    const ext = path.extname(filename).toLowerCase();
    if (!['.jpg', '.jpeg', '.png'].includes(ext)) continue;
    const data = await zip.files[filename].async('base64');
    const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
    photos.push({
      license: path.basename(filename, ext),
      photo: `data:${mimeType};base64,${data}`,
    });
  }
  return photos;
}

/** Photos des tireurs → ZIP (un JPEG par licence, sinon nom_prénom_identifiant) */
export async function photosToZip(
  photos: {
    id: string;
    license: string | null;
    lastName: string;
    firstName: string;
    photo: string;
  }[]
): Promise<Buffer> {
  const zip = new JSZip();
  for (const { id, license, lastName, firstName, photo } of photos) {
    const base64 = photo.replace(/^data:image\/\w+;base64,/, '');
    const filename = license
      ? license.replace(/[^a-zA-Z0-9_-]/g, '_')
      : `${lastName}_${firstName}_${id.slice(0, 8)}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    zip.file(`${filename}.jpg`, Buffer.from(base64, 'base64'));
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

/** Archive .bpf : meta.json + fencers.json */
export async function fencersToArchive(
  fencers: unknown[],
  competitionName: string
): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    'meta.json',
    JSON.stringify({
      version: '1',
      competitionName,
      exportDate: new Date().toISOString(),
      count: fencers.length,
    })
  );
  zip.file('fencers.json', JSON.stringify(fencers));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Tireurs d'une archive .bpf, validés (tableau borné, champs texte bornés) */
export async function fencersFromArchive(buffer: Buffer): Promise<Record<string, unknown>[]> {
  const zip = await loadZip(buffer, 'une archive de tireurs BPM - Escrime (.bpf)');
  const names = new Set(entries(zip));
  const file = names.has('fencers.json') ? zip.file('fencers.json') : null;
  if (!file) throw new InvalidFileError('Format .bpf invalide : fencers.json manquant');
  let data: unknown;
  try {
    data = JSON.parse(await file.async('string'));
  } catch {
    throw new InvalidFileError('Format .bpf invalide : fencers.json illisible');
  }
  try {
    return validateImportedFencers(data);
  } catch (e) {
    throw new InvalidFileError(e instanceof Error ? e.message : String(e));
  }
}
