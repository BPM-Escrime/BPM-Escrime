/**
 * BPM - Escrime - Dépôt du fichier de résultats sur un serveur distant (#1331)
 * Équivalent de l'ancien `FileUploader` (libcurl) : le fichier est déposé dans le dossier indiqué par l'URL.
 * - ftp:// et ftps:// : protocole FTP (basic-ftp)
 * - http:// et https:// : HTTP PUT vers `<dossier>/<fichier>`, comme l'ancien BPM - Escrime avec escrime-info.com
 * Appelé par le port du poste (`ctx.station.publication`) pour la commande publishResults
 * (#1981 lot 4, docs/adr/0022). Le mot de passe n'est jamais journalisé ni logué.
 * Licensed under GPL-3.0
 */
import { Client } from 'basic-ftp';
import { Readable } from 'stream';
import { parseRemoteUrl, type RemoteTarget } from './remoteUrl';

export { parseRemoteUrl, type RemoteTarget };

const TIMEOUT_MS = 20_000;
const MAX_XML_CHARS = 20 * 1024 * 1024;
const MAX_CREDENTIAL_CHARS = 200;
const FILE_NAME_RE = /^[A-Za-z0-9_.-]{1,120}\.xml$/;

export interface FtpPublishRequest {
  fileName: string;
  xml: string;
  /** URL du dossier de dépôt : ftp(s)://hôte[:port]/dossier ou http(s)://hôte/dossier */
  url: string;
  user: string;
  password: string;
}

export interface FtpPublishResult {
  success: boolean;
  error?: string;
}

/** Sous-ensemble du client basic-ftp utilisé ici (permet de le remplacer dans les tests) */
export interface FtpClientLike {
  access(options: {
    host: string;
    port?: number;
    user?: string;
    password?: string;
    secure: boolean;
  }): Promise<unknown>;
  cd(path: string): Promise<unknown>;
  uploadFrom(source: Readable, toRemotePath: string): Promise<unknown>;
  close(): void;
}

/** Valide la requête (défense en profondeur, le moteur l'a construite) : URL, identifiants bornés, nom de fichier sûr, XML borné */
export function parseFtpRequest(raw: unknown): FtpPublishRequest | string {
  if (!raw || typeof raw !== 'object') return 'invalid_request';
  const { fileName, xml, url, user, password } = raw as Record<string, unknown>;
  if (typeof fileName !== 'string' || !FILE_NAME_RE.test(fileName)) return 'invalid_file_name';
  if (typeof xml !== 'string' || xml.length === 0 || xml.length > MAX_XML_CHARS)
    return 'invalid_xml';
  if (typeof url !== 'string' || url.length === 0 || url.length > 2048) return 'invalid_url';
  if (typeof user !== 'string' || user.length > MAX_CREDENTIAL_CHARS) return 'invalid_user';
  if (typeof password !== 'string' || password.length > MAX_CREDENTIAL_CHARS)
    return 'invalid_password';
  return { fileName, xml, url, user, password };
}

const defaultClient = (): FtpClientLike => new Client(TIMEOUT_MS);

/** Dépôt FTP/FTPS. Le client est toujours fermé, même en erreur. */
async function uploadOverFtp(
  request: FtpPublishRequest,
  target: Extract<RemoteTarget, { kind: 'ftp' }>,
  createClient: () => FtpClientLike
): Promise<FtpPublishResult> {
  const client = createClient();
  try {
    await client.access({
      host: target.host,
      port: target.port,
      user: request.user || undefined,
      password: request.password || undefined,
      secure: target.secure,
    });
    if (target.directory !== '/') await client.cd(target.directory);
    await client.uploadFrom(Readable.from([Buffer.from(request.xml, 'utf-8')]), request.fileName);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Erreur inconnue' };
  } finally {
    client.close();
  }
}

/**
 * HTTP PUT vers `<dossier>/<fichier>`, authentification Basic seulement si identifiant et mot de passe sont fournis
 * (comme l'ancien FileUploader). Pas de redirection : les identifiants ne suivent pas un autre hôte.
 */
async function uploadOverHttp(
  request: FtpPublishRequest,
  target: Extract<RemoteTarget, { kind: 'http' }>,
  fetchImpl: typeof fetch
): Promise<FtpPublishResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/xml' };
  if (request.user && request.password) {
    headers.Authorization = `Basic ${Buffer.from(`${request.user}:${request.password}`).toString('base64')}`;
  }
  try {
    const response = await fetchImpl(new URL(request.fileName, target.directoryUrl), {
      method: 'PUT',
      headers,
      body: request.xml,
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return { success: false, error: `HTTP ${response.status}` };
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Erreur inconnue' };
  }
}

/** Dépose le fichier dans le dossier de l'URL, en FTP/FTPS ou en HTTP PUT selon le schéma */
export async function publishRemote(
  request: FtpPublishRequest,
  options: { createClient?: () => FtpClientLike; fetchImpl?: typeof fetch } = {}
): Promise<FtpPublishResult> {
  const target = parseRemoteUrl(request.url);
  if (typeof target === 'string') return { success: false, error: target };
  if (target.kind === 'http') {
    return uploadOverHttp(request, target, options.fetchImpl ?? fetch);
  }
  return uploadOverFtp(request, target, options.createClient ?? defaultClient);
}
