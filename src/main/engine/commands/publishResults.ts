/**
 * BPM - Escrime - Publication des résultats vers GREG ou un serveur de dépôt (#1328, #1331,
 * #1981 lot 4, docs/adr/0022 amendée). Reprise des anciens canaux greg:publish et ftp:publish :
 * le XML est construit ici depuis la base (même XML que l'export FFE, racine native des
 * épreuves par équipes), puis envoyé par le port du poste (`ctx.station.publication`).
 * Fonction du poste : pas de journal (effet externe, pas un fait de l'épreuve). Le mot de passe
 * du dépôt n'est jamais logué ni renvoyé : il est masqué dans tout message d'échec.
 * Licensed under GPL-3.0
 */
import type { z } from 'zod';
import type { publicationOperations } from '../../../shared/api/contractPublication';
import type { Competition } from '../../../shared/types';
import {
  buildGregFields,
  gregFileName,
  isGregUrl,
  toNativeRootTag,
} from '../../../shared/utils/gregPublication';
import { parseRemoteUrl } from '../../publication/remoteUrl';
import { CommandError, type CommandContext, type SendResult } from './context';
import { resultsData } from './sport';
import { resultsXml } from './exportResults';

type Ops = typeof publicationOperations;
type Input = z.output<Ops['publishResults']['input']>;
type Output = z.output<Ops['publishResults']['output']>;

/** Codes de parseRemoteUrl → message pour l'opérateur */
const URL_REFUSALS: Record<string, string> = {
  invalid_url_scheme: 'schéma ftp, ftps, http ou https attendu',
  credentials_in_url:
    'identifiant ou mot de passe interdits dans l’adresse (champs Utilisateur et Mot de passe)',
  invalid_url: 'adresse invalide (hôte explicite attendu)',
};

/** Retire un secret d'un message (erreur d'un serveur ou du réseau) */
function scrub(message: string, secret: string): string {
  return secret ? message.split(secret).join('***') : message;
}

function failure(label: string, result: SendResult, secret = ''): CommandError {
  const detail = scrub(result.error ?? 'erreur inconnue', secret);
  return new CommandError('publication_failed', `${label} : ${detail}`);
}

export async function publishResults(ctx: CommandContext, input: Input): Promise<Output> {
  const data = resultsData(ctx, input.competitionId);
  const competition = data.competition as Competition;
  const ftp = typeof input.target === 'object' ? input.target.ftp : null;
  // Comme l'ancien BPM - Escrime : une adresse escrime-info.com part toujours vers GREG
  const toGreg = !ftp || isGregUrl(ftp.url);
  if (ftp && !toGreg) {
    const target = parseRemoteUrl(ftp.url);
    if (typeof target === 'string') {
      throw new CommandError(
        'invalid_url',
        `Adresse de dépôt refusée : ${URL_REFUSALS[target] ?? target}`
      );
    }
  }
  let fields: ReturnType<typeof buildGregFields> | null = null;
  if (toGreg) {
    try {
      fields = buildGregFields(competition);
    } catch (e) {
      throw new CommandError(
        'not_publishable',
        e instanceof Error ? e.message : 'Épreuve non publiable'
      );
    }
  }
  const port = ctx.station?.publication;
  if (!port) {
    throw new CommandError('unavailable', 'Publication des résultats indisponible dans ce mode');
  }
  const fileName = gregFileName(competition.title);
  const xml = toNativeRootTag(resultsXml(data), !!competition.isTeamEvent);
  if (fields) {
    const result = await port.greg({ fileName, xml, fields });
    if (!result.success) throw failure('Échec de la publication GREG', result);
    return { target: 'greg', fileName };
  }
  const { url, user, password } = ftp!;
  const result = await port.remote({ fileName, xml, url, user, password });
  if (!result.success) throw failure('Échec de l’envoi FTP', result, password);
  return { target: 'ftp', fileName };
}

export const publicationHandlers = {
  publishResults: (ctx: CommandContext, input: Input) => publishResults(ctx, input),
};
