/**
 * BPM - Escrime - Adresse de dépôt des résultats (#1331) : schéma ftp, ftps, http ou https,
 * hôte explicite, aucun identifiant dans l'URL. Pure : lue par le moteur (publishResults)
 * avant tout envoi, et par le dépôt lui-même.
 * Licensed under GPL-3.0
 */

export type RemoteTarget =
  | { kind: 'ftp'; host: string; port?: number; secure: boolean; directory: string }
  | { kind: 'http'; directoryUrl: URL };

/** Valide une URL de dépôt : schéma ftp/ftps/http/https, hôte explicite, aucun identifiant dans l'URL */
export function parseRemoteUrl(raw: string): RemoteTarget | string {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(raw)?.[1]?.toLowerCase();
  if (!scheme || !['ftp', 'ftps', 'http', 'https'].includes(scheme)) return 'invalid_url_scheme';
  // « ftp:///dir » serait lu par l'analyseur comme hôte « dir » : on exige un hôte explicite
  if (!/^[a-z]+:\/\/[^/]/i.test(raw)) return 'invalid_url';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'invalid_url';
  }
  if (!url.hostname) return 'invalid_url';
  if (url.username || url.password) return 'credentials_in_url';

  let directory: string;
  try {
    directory = decodeURIComponent(url.pathname) || '/';
  } catch {
    return 'invalid_url';
  }
  if (directory.includes('\0')) return 'invalid_url';

  if (url.protocol === 'http:' || url.protocol === 'https:') {
    const directoryUrl = new URL(url.href);
    directoryUrl.pathname = directory.endsWith('/') ? directory : `${directory}/`;
    directoryUrl.search = '';
    directoryUrl.hash = '';
    return { kind: 'http', directoryUrl };
  }
  return {
    kind: 'ftp',
    host: url.hostname,
    port: url.port ? Number(url.port) : undefined,
    secure: url.protocol === 'ftps:',
    directory,
  };
}
