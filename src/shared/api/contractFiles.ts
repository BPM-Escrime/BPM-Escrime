/**
 * BPM - Escrime - Fichiers de données du poste (#1981, docs/adr/0021 et 0022) : sauvegarde
 * .bpm d'une épreuve (en clair ou chiffrée), archive de tireurs .bpf, photos en ZIP, sauvegarde
 * d'un club .bpclub, rapport de diagnostic, tableur .xlsx. Le contrat rend ou reçoit un **contenu** (base64), jamais un chemin :
 * l'écran l'enregistre ou le choisit par PlatformServices (usePlatform).
 * Fonctions du poste : jamais servies sur le réseau (STATION_PERMISSIONS), pas d'outil MCP.
 * Une écriture dans une épreuve passe par runCommand (docs/adr/0006). Mot de passe d'une archive
 * chiffrée : jamais journalisé ni logué.
 * Licensed under GPL-3.0
 */
import { z } from 'zod';
import { command, CompetitionId, Id, query } from './contractDef';

/** Taille maximale d'un fichier de données échangé par le contrat (octets) */
export const MAX_DATA_FILE_BYTES = 100 * 1024 * 1024;

/** Contenu binaire d'un fichier, encodé en base64 (transport neutre : IPC, JSON, Socket.IO) */
const FileContent = z
  .string()
  .min(1)
  .max(Math.ceil(MAX_DATA_FILE_BYTES / 3) * 4)
  .regex(/^[A-Za-z0-9+/]*={0,2}$/, 'base64 attendu')
  .describe('Contenu du fichier en base64');

/** Tableur : lignes et colonnes au plus (Mode Club : inventaire) */
export const MAX_SPREADSHEET_ROWS = 20_000;
export const MAX_SPREADSHEET_COLUMNS = 200;
const SpreadsheetCell = z.union([z.string().max(32_767), z.number()]);

const ClubId = Id.describe('Identifiant du club (listClubs)');
const Password = z.string().min(1).max(1000);

/** Fichier rendu par le contrat : nom proposé et contenu base64 */
export interface DataFile {
  fileName: string;
  content: string;
}

export const fileOperations = {
  // ── Sauvegarde .bpm d'une épreuve ──
  getCompetitionFile: query({
    description:
      'Sauvegarde .bpm d’une épreuve (base SQLite autonome, état d’avancement compris) : nom proposé et contenu base64.',
    input: z.strictObject({ competitionId: CompetitionId }),
    output: z.custom<DataFile>(),
    permission: 'station:admin',
  }),
  getEncryptedCompetitionFile: query({
    description:
      'Archive .bpm chiffrée par mot de passe (AES-256-GCM, scrypt) d’une épreuve, ou de toute la base si `competitionId` est nul. Mot de passe de moins de 8 caractères : weak_password.',
    input: z.strictObject({ competitionId: CompetitionId.nullable(), password: Password }),
    output: z.custom<DataFile>(),
    permission: 'station:admin',
  }),
  openCompetitionFile: command({
    description:
      'Fusionne une sauvegarde .bpm (chiffrée ou non) dans la base du poste ; renvoie les épreuves importées. Archive chiffrée sans mot de passe : password_required ; mot de passe faux : wrong_password ; fichier illisible : invalid_file.',
    input: z.strictObject({ content: FileContent, password: Password.optional() }),
    output: z.custom<{ competitionIds: string[] }>(),
    permission: 'station:admin',
  }),

  // ── Tireurs d'une épreuve ──
  getFencersArchive: query({
    description:
      'Archive des tireurs d’une épreuve (.bpf : ZIP de meta.json et fencers.json) : nom proposé, contenu base64, nombre de tireurs.',
    input: z.strictObject({ competitionId: CompetitionId }),
    output: z.custom<DataFile & { count: number }>(),
    permission: 'station:admin',
  }),
  importFencersArchive: command({
    description:
      'Importe une archive .bpf dans l’épreuve : tireur retrouvé par licence (sinon nom et prénom) mis à jour, sinon inscrit. Statut, classement final et scores ne sont jamais importés. Archive invalide : invalid_file.',
    input: z.strictObject({ competitionId: CompetitionId, content: FileContent }),
    output: z.custom<{ added: number; updated: number }>(),
    permission: 'station:admin',
  }),
  getFencerPhotosArchive: query({
    description:
      'Photos des tireurs d’une épreuve en ZIP (un JPEG par licence, sinon nom_prénom) : nom proposé, contenu base64, nombre de photos.',
    input: z.strictObject({ competitionId: CompetitionId }),
    output: z.custom<DataFile & { count: number }>(),
    permission: 'station:admin',
  }),
  importFencerPhotos: command({
    description:
      'Photos d’un ZIP (fichiers .jpg/.jpeg/.png nommés par licence) appliquées aux tireurs de l’épreuve de même licence. ZIP invalide : invalid_file.',
    input: z.strictObject({ competitionId: CompetitionId, content: FileContent }),
    output: z.custom<{ matched: number; total: number }>(),
    permission: 'station:admin',
  }),

  // ── Extranet fédéral (#1938) ──
  listFederalFiles: query({
    description:
      'Fichiers de l’extranet fédéral (.zip d’une épreuve, .xml / .cotcot / .fff / .txt isolés) décodés en texte : nom et contenu de chaque fichier, pour l’analyse partagée de « Nouvelle compétition ». 5 fichiers au plus. Archive ou fichier invalide : invalid_file.',
    input: z.strictObject({
      // 5 : FEDERAL_MAX_INPUTS (src/main/federalFiles.ts)
      files: z
        .array(z.strictObject({ name: z.string().min(1).max(260), content: FileContent }))
        .min(1)
        .max(5),
    }),
    output: z.custom<Array<{ name: string; content: string }>>(),
    permission: 'station:admin',
  }),

  // ── Poste ──
  getDiagnosticReport: query({
    description:
      'Rapport de diagnostic du poste (JSON : versions, système, mémoire, serveurs distants actifs ; aucun nom, mot de passe, jeton ni chemin) : nom proposé et contenu base64.',
    input: z.strictObject({}),
    output: z.custom<DataFile>(),
    permission: 'station:admin',
  }),
  getSpreadsheetFile: query({
    description: `Tableur Excel (.xlsx) d’une feuille construit depuis une grille de valeurs (${MAX_SPREADSHEET_ROWS} lignes et ${MAX_SPREADSHEET_COLUMNS} colonnes au plus) : contenu base64.`,
    input: z.strictObject({
      rows: z
        .array(z.array(SpreadsheetCell).max(MAX_SPREADSHEET_COLUMNS))
        .max(MAX_SPREADSHEET_ROWS),
      sheetName: z.string().max(100).optional(),
    }),
    output: z.object({ content: z.string() }),
    // Mise en forme de lignes : compte du Mode Club sans administration du poste
    permission: 'club:read',
  }),

  // ── Mode Club ──
  importClubPhotos: command({
    description:
      'Photos d’un ZIP (nommées par licence) appliquées aux membres du club de même licence. ZIP invalide : invalid_file.',
    input: z.strictObject({ clubId: ClubId, content: FileContent }),
    output: z.custom<{ matched: number; total: number }>(),
    permission: 'club:write',
  }),
  getClubBackupFile: query({
    description:
      'Sauvegarde complète d’un club (.bpclub) pour la recharger sur un autre poste : nom du club et contenu base64.',
    input: z.strictObject({ clubId: ClubId }),
    output: z.custom<{ clubName: string; content: string }>(),
    permission: 'club:read',
  }),
  importClubBackup: command({
    description:
      'Recharge une sauvegarde de club (.bpclub). Club déjà présent sur le poste : club_exists, sauf `replace`. Fichier invalide : invalid_file.',
    input: z.strictObject({ content: FileContent, replace: z.boolean().optional() }),
    output: z.custom<{ clubId: string; clubName: string; replaced: boolean; rows: number }>(),
    permission: 'club:write',
  }),
};
