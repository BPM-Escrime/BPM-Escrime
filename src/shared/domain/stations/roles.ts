/**
 * BPM - Escrime - Rôles et droits du multi-poste (#1982, docs/adr/0029)
 * Matrice rôle → droits, portée du compte (épreuves désignées, arène), bail exigé pour
 * l'orchestration. Règle pure, vérifiée par le moteur dans l'adaptateur, jamais par l'écran.
 * Licensed under GPL-3.0
 */
import { holdsLease, type CompetitionLease } from './lease';

/**
 * Droits d'une opération du contrat. `checkin:write` et `structure:write` découpent
 * `fencers:write` et `score:write` (docs/adr/0029, lot 2 : le contrat les adopte).
 */
export type AccessRight =
  | 'competition:read'
  | 'competition:write'
  | 'fencers:write'
  | 'checkin:write'
  | 'structure:write'
  | 'score:write'
  | 'cards:read'
  | 'referees:write'
  | 'club:read'
  | 'club:write'
  | 'station:admin'
  | 'remote:admin';

export const ALL_ACCESS_RIGHTS: readonly AccessRight[] = [
  'competition:read',
  'competition:write',
  'fencers:write',
  'checkin:write',
  'structure:write',
  'score:write',
  'cards:read',
  'referees:write',
  'club:read',
  'club:write',
  'station:admin',
  'remote:admin',
];

export type StationRole =
  'admin' | 'dayDirector' | 'competitionDirector' | 'assistant' | 'checkIn' | 'referee' | 'public';

const READ: readonly AccessRight[] = ['competition:read', 'cards:read'];

/** Fonctions du poste : jamais à un rôle de la journée (docs/adr/0022) */
const STATION_RIGHTS: ReadonlySet<AccessRight> = new Set<AccessRight>([
  'club:read',
  'club:write',
  'station:admin',
  'remote:admin',
]);

const COMPETITION_RIGHTS: readonly AccessRight[] = ALL_ACCESS_RIGHTS.filter(
  r => !STATION_RIGHTS.has(r)
);

export const ROLE_RIGHTS: Readonly<Record<StationRole, ReadonlySet<AccessRight>>> = {
  admin: new Set(ALL_ACCESS_RIGHTS),
  dayDirector: new Set(COMPETITION_RIGHTS),
  competitionDirector: new Set(COMPETITION_RIGHTS),
  assistant: new Set<AccessRight>([...READ, 'score:write', 'checkin:write']),
  checkIn: new Set<AccessRight>([...READ, 'checkin:write']),
  referee: new Set<AccessRight>([...READ, 'score:write']),
  public: new Set<AccessRight>(READ),
};

/** Droits qui changent la structure d'une épreuve : bail exigé */
export const LEASED_RIGHTS: ReadonlySet<AccessRight> = new Set<AccessRight>([
  'competition:write',
  'fencers:write',
  'referees:write',
  'structure:write',
]);

const READ_RIGHTS: ReadonlySet<AccessRight> = new Set<AccessRight>(READ);

export interface StationAccount {
  id: string;
  role: StationRole;
  /** Épreuves désignées (assistant, pointage) : vide = toutes les épreuves de la journée */
  competitionIds: readonly string[];
  /** Arène du rôle `referee` (jeton bp_token_arena{N}) */
  arena?: number;
}

export interface AccessRequest {
  right: AccessRight;
  /** Épreuve visée, absente pour une opération de la journée ou du poste */
  competitionId?: string;
  /** Arène visée (saisie d'un arbitre) */
  arena?: number;
  /** Poste appelant */
  stationId: string;
  /** Bail de l'épreuve visée */
  lease?: CompetitionLease | null;
}

export type AccessDecision =
  { ok: true } | { ok: false; code: 'permission_denied' | 'lease_required' };

const DENIED: AccessDecision = { ok: false, code: 'permission_denied' };

/** Le compte peut-il transférer un bail ou piloter la journée ? */
export function canManageLeases(account: StationAccount): boolean {
  return account.role === 'admin' || account.role === 'dayDirector';
}

function inScope(account: StationAccount, competitionId: string | undefined): boolean {
  if (account.competitionIds.length === 0) return true;
  return competitionId !== undefined && account.competitionIds.includes(competitionId);
}

/**
 * Décision d'accès. Ordre : droit du rôle, portée du compte, puis bail pour l'orchestration.
 * Le DT d'épreuve n'écrit que sur les épreuves dont son poste tient le bail ; il lit les autres.
 * Admin et DT général ne passent pas outre le bail : ils le transfèrent d'abord.
 */
export function decideAccess(account: StationAccount, req: AccessRequest): AccessDecision {
  if (!ROLE_RIGHTS[account.role].has(req.right)) return DENIED;
  if (READ_RIGHTS.has(req.right)) return { ok: true };

  if (account.role === 'referee') {
    if (account.arena === undefined || req.arena !== account.arena) return DENIED;
  } else if (!inScope(account, req.competitionId)) {
    return DENIED;
  }

  if (req.competitionId !== undefined && LEASED_RIGHTS.has(req.right)) {
    if (!holdsLease(req.lease, req.stationId)) return { ok: false, code: 'lease_required' };
  } else if (req.competitionId === undefined && LEASED_RIGHTS.has(req.right)) {
    // Opération de la journée (inscriptions partagées, épreuves) : DT général ou admin
    if (!canManageLeases(account)) return DENIED;
  }
  return { ok: true };
}
