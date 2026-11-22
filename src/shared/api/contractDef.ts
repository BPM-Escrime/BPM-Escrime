/**
 * BellePoule Modern - Briques du contrat d'API (#1981) : forme d'une opération, droits,
 * constructeurs command / query / subscription, schémas communs. Partagées par contract.ts et
 * les groupes d'opérations déclarés à part (contractDtView.ts).
 * Licensed under GPL-3.0
 */
import { z } from 'zod';

/** Droits (utilisés par le sous-ticket 4, rôles et permissions) */
export type Permission =
  | 'competition:read'
  | 'competition:write'
  | 'fencers:write'
  | 'score:write'
  | 'cards:read'
  | 'referees:write'
  | 'club:read'
  | 'club:write'
  | 'station:admin'
  | 'remote:admin';

/**
 * Droits des fonctions du poste (docs/adr/0022) : jamais servis sur le réseau, jamais journalisés
 * (ce ne sont pas des faits de l'épreuve), hors de la transaction du journal (runCommand).
 */
export const STATION_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  'club:read',
  'club:write',
  'station:admin',
  'remote:admin',
]);

export type OperationKind = 'command' | 'query' | 'subscription';

/** Exposition comme outil MCP : écriture pour une commande, lecture pour une requête */
export interface McpExposure {
  name: string;
  title: string;
  destructive?: boolean;
  idempotent?: boolean;
}

export interface OperationDef<
  K extends OperationKind = OperationKind,
  I extends z.ZodType = z.ZodType,
  O extends z.ZodType = z.ZodType,
> {
  kind: K;
  /** Description (documentation, outil MCP) */
  description: string;
  input: I;
  output: O;
  permission: Permission;
  mcp?: McpExposure;
}

type Def<K extends OperationKind, I extends z.ZodType, O extends z.ZodType> = Omit<
  OperationDef<K, I, O>,
  'kind'
>;

export const command = <I extends z.ZodType, O extends z.ZodType>(d: Def<'command', I, O>) => ({
  kind: 'command' as const,
  ...d,
});
export const query = <I extends z.ZodType, O extends z.ZodType>(d: Def<'query', I, O>) => ({
  kind: 'query' as const,
  ...d,
});
export const subscription = <I extends z.ZodType, O extends z.ZodType>(
  d: Omit<Def<'subscription', I, O>, 'mcp'>
) => ({ kind: 'subscription' as const, ...d });

export type ApiContract = Record<string, OperationDef>;

// ─── Schémas communs ─────────────────────────────────────────────────────────

export const Id = z.string().trim().min(1).max(200);
export const CompetitionId = Id.describe('Identifiant de la compétition (list_competitions)');
export const DryRun = z.boolean().optional().describe('Décrit le résultat sans rien écrire');
export const CommandId = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .optional()
  .describe(
    'Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau)'
  );

/** Tireur exposé par le contrat (listFencers, dates en ISO 8601) */
export const FencerSchema = z.object({
  id: z.string(),
  ref: z.number(),
  lastName: z.string(),
  firstName: z.string(),
  birthDate: z.string().nullable(),
  gender: z.string(),
  nationality: z.string(),
  region: z.string().nullable(),
  department: z.string().nullable(),
  club: z.string().nullable(),
  license: z.string().nullable(),
  ranking: z.number().nullable(),
  handedness: z.enum(['R', 'L']).nullable(),
  status: z.string(),
  exclusionReason: z.string().nullable(),
  seedNumber: z.number().nullable(),
  initialRanking: z.number().nullable(),
  finalRanking: z.number().nullable(),
  photo: z.string().nullable(),
});
