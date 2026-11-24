/**
 * BPM - Escrime - Publication des résultats vers GREG (escrime-info.com) ou un serveur de dépôt
 * (FTP, FTPS, HTTP PUT) (#1328, #1331, #1981 lot 4, docs/adr/0022 amendée).
 * Le moteur construit lui-même le XML des résultats depuis la base (même XML que l'export
 * FFE) : l'écran n'envoie plus de fichier. Fonction du poste : droit `station:admin`, jamais
 * servie sur le réseau ni à la vue DT, pas d'outil MCP, pas de journal (effet externe, pas un
 * fait de l'épreuve). Mot de passe du dépôt : jamais journalisé, logué ni renvoyé.
 * Licensed under GPL-3.0
 */
import { z } from 'zod';
import { command, CompetitionId } from './contractDef';

/** Bornes des anciens canaux greg:publish / ftp:publish */
const MAX_URL_CHARS = 2048;
const MAX_CREDENTIAL_CHARS = 200;

const FtpTarget = z.strictObject({
  ftp: z.strictObject({
    url: z
      .string()
      .trim()
      .min(1)
      .max(MAX_URL_CHARS)
      .describe('Dossier de dépôt : ftp(s)://hôte[:port]/dossier ou http(s)://hôte/dossier'),
    user: z.string().max(MAX_CREDENTIAL_CHARS),
    password: z.string().max(MAX_CREDENTIAL_CHARS),
  }),
});

export const publicationOperations = {
  publishResults: command({
    description:
      'Publie les résultats de l’épreuve (XML construit depuis la base) sur GREG (`greg`) ou les dépose sur un serveur (`{ ftp: { url, user, password } }` : ftp, ftps, http ou https). Une adresse escrime-info.com part vers GREG. ' +
      'Refus : invalid_url (adresse de dépôt), not_publishable (arme, catégorie ou lieu refusés par GREG), publication_failed (serveur ou réseau), unavailable (hors du poste).',
    input: z.strictObject({
      competitionId: CompetitionId,
      target: z.union([z.literal('greg'), FtpTarget]),
    }),
    output: z.object({ target: z.enum(['greg', 'ftp']), fileName: z.string() }),
    permission: 'station:admin',
  }),
} as const;
