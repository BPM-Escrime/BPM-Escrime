/**
 * BPM - Escrime - Mode Club : sauvegarde d'un club (.bpclub) et chargement sur un
 * autre poste. Contenu par le contrat (getClubBackupFile, importClubBackup), dialogues par la
 * plateforme (ADR-0021).
 * Licensed under GPL-3.0
 */
import { ApiError } from '../../../shared/api/client';
import { defaultPlatform } from '../../platform/PlatformContext';
import { filesApi, openDataFile, saveDataFile } from '../../api/filesApi';

type TFn = (key: string, params?: Record<string, string | number>) => string;

/** Nom de fichier proposé : <club>-AAAA-MM-JJ.bpclub */
export function backupFileName(clubName: string, date = new Date()): string {
  const base =
    clubName
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'club';
  return `${base}-${date.toISOString().slice(0, 10)}.bpclub`;
}

const filters = (t: TFn) => [{ name: t('clubs.backup_file'), extensions: ['bpclub'] }];

/** Sauvegarde le club ; false si annulé */
export async function exportClubBackup(
  clubId: string,
  clubName: string,
  t: TFn,
  api = filesApi,
  platform = defaultPlatform
): Promise<boolean> {
  const { content } = await api.club.backupFile(clubId);
  return saveDataFile(
    platform,
    { fileName: backupFileName(clubName), content },
    { title: t('clubs.backup_export'), filters: filters(t) }
  );
}

/**
 * Charge une sauvegarde ; si le club existe déjà (club_exists), demande confirmation avant de
 * remplacer. Renvoie le club chargé, ou null si annulé.
 */
export async function importClubBackup(
  t: TFn,
  confirmReplace: () => Promise<boolean>,
  api = filesApi,
  platform = defaultPlatform
): Promise<{ clubId: string; clubName: string; replaced: boolean } | null> {
  const picked = await openDataFile(platform, {
    title: t('clubs.backup_import'),
    filters: filters(t),
  });
  if (!picked) return null;
  try {
    return await api.club.importBackup(picked.content, false);
  } catch (e) {
    if (!(e instanceof ApiError) || e.code !== 'club_exists') throw e;
    if (!(await confirmReplace())) return null;
    return api.club.importBackup(picked.content, true);
  }
}
