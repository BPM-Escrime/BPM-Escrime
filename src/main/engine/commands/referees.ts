/**
 * BPM - Escrime - Inscription des arbitres (#1981, docs/adr/0018)
 * registerReferees, updateRefereeDetails, setRefereeAvailability, unregisterReferee : commandes
 * d'intention à la place des écritures de table de l'écran. Pas de journal (docs/adr/0018).
 * Licensed under GPL-3.0
 */
import { MatchStatus, type Referee } from '../../../shared/types';
import { importIdentityKeys } from '../../../shared/utils/personIdentity';
import { CommandError, type CommandContext } from './context';
import { getCompetitionOrThrow } from './competitions';
import { readSession } from './sessionView';
import { sessionPools } from './sport';

export interface RefereeDetailsInput {
  firstName?: string;
  lastName?: string;
  gender?: 'M' | 'F' | 'X';
  nationality?: string;
  club?: string | null;
  license?: string | null;
  category?: string | null;
}

export interface RegisterRefereeInput extends RefereeDetailsInput {
  lastName: string;
}

/** Arbitre exposé par le contrat (même forme que listReferees) */
export function refereeDTO(r: Referee) {
  return {
    id: r.id,
    ref: r.ref,
    firstName: r.firstName,
    lastName: r.lastName,
    gender: r.gender ?? 'M',
    club: r.club ?? null,
    license: r.license ?? null,
    nationality: r.nationality ?? null,
    region: r.region ?? null,
    category: r.category ?? null,
    status: r.status,
  };
}

/** La base range l'arbitre sous un seul nom : « prénom nom » */
const fullName = (firstName: string | undefined, lastName: string) =>
  `${(firstName ?? '').trim()} ${lastName.trim()}`.trim();

const text = (v: string | null | undefined) => {
  const s = (v ?? '').trim();
  return s || undefined;
};

function refereeOf(ctx: CommandContext, competitionId: string, refereeId: string): Referee {
  const r = ctx.db.getRefereesByCompetition(competitionId).find(x => x.id === refereeId);
  if (!r) throw new CommandError('referee_not_found', `Arbitre introuvable : ${refereeId}`);
  return r;
}

export function registerReferees(
  ctx: CommandContext,
  input: { competitionId: string; referees: RegisterRefereeInput[]; dryRun?: boolean }
) {
  const comp = getCompetitionOrThrow(ctx, input.competitionId);
  // Doublon : mêmes clés que les imports et le MCP (licence, ou nom et prénom)
  const known = new Map<string, string>();
  for (const r of ctx.db.getRefereesByCompetition(comp.id)) {
    for (const k of importIdentityKeys(r)) known.set(k, r.id);
  }
  const duplicates: Array<{ index: number; refereeId: string }> = [];
  input.referees.forEach((r, index) => {
    const hit = importIdentityKeys(r)
      .map(k => known.get(k))
      .find(Boolean);
    if (hit) duplicates.push({ index, refereeId: hit });
  });
  if (input.dryRun) return { dryRun: true, referees: [], duplicates };
  const created: Referee[] = [];
  ctx.db.transaction(() => {
    for (const r of input.referees) {
      created.push(
        ctx.db.createReferee(comp.id, {
          name: fullName(r.firstName, r.lastName),
          gender: r.gender,
          nationality: text(r.nationality)?.toUpperCase() ?? 'FRA',
          club: text(r.club),
          license: text(r.license),
          category: text(r.category),
        })
      );
    }
  });
  if (created.length) ctx.emitChange?.({ scope: 'referees', competitionIds: [comp.id] });
  return { dryRun: false, referees: created.map(refereeDTO), duplicates };
}

export function updateRefereeDetails(
  ctx: CommandContext,
  input: {
    competitionId: string;
    refereeId: string;
    details: RefereeDetailsInput;
    dryRun?: boolean;
  }
) {
  const comp = getCompetitionOrThrow(ctx, input.competitionId);
  const current = refereeOf(ctx, comp.id, input.refereeId);
  const d = input.details;
  const patch: Record<string, string | null> = {};
  if (d.firstName !== undefined || d.lastName !== undefined) {
    const lastName = d.lastName ?? current.lastName;
    if (!lastName.trim()) throw new CommandError('invalid_name', 'Le nom est obligatoire');
    patch.name = fullName(d.firstName ?? current.firstName, lastName);
  }
  if (d.gender !== undefined) patch.gender = d.gender;
  if (d.nationality !== undefined) patch.nationality = d.nationality.trim().toUpperCase();
  if (d.club !== undefined) patch.club = text(d.club) ?? null;
  if (d.license !== undefined) patch.license = text(d.license) ?? null;
  if (d.category !== undefined) patch.category = text(d.category) ?? null;
  if (!input.dryRun && Object.keys(patch).length > 0) {
    ctx.db.updateReferee(current.id, patch as Parameters<typeof ctx.db.updateReferee>[1]);
    ctx.emitChange?.({ scope: 'referees', competitionIds: [comp.id] });
  }
  const after = input.dryRun ? current : refereeOf(ctx, comp.id, current.id);
  return { dryRun: !!input.dryRun, referee: refereeDTO(after) };
}

/** Pointage des arbitres : disponible ou non pointé (même effet que l'appel distant, #1016) */
export function setRefereeAvailability(
  ctx: CommandContext,
  input: { competitionId: string; refereeIds: string[]; available: boolean; dryRun?: boolean }
) {
  const comp = getCompetitionOrThrow(ctx, input.competitionId);
  const status = input.available ? ('available' as const) : ('unavailable' as const);
  const all = ctx.db.getRefereesByCompetition(comp.id);
  const unknown = input.refereeIds.filter(id => !all.some(r => r.id === id));
  const targets = all.filter(r => input.refereeIds.includes(r.id) && r.status !== status);
  if (!input.dryRun && targets.length) {
    ctx.db.transaction(() => {
      for (const r of targets) ctx.db.updateReferee(r.id, { status });
    });
    ctx.emitChange?.({ scope: 'referees', competitionIds: [comp.id] });
  }
  return { dryRun: !!input.dryRun, status, updated: targets.length, unknown };
}

/**
 * Commentaire d'un formateur sur un arbitre (espace formateurs, #2159) : hors journal de
 * l'épreuve (avis, pas un fait sportif) ; arbitre de l'épreuve exigé.
 */
export function addRefereeComment(
  ctx: CommandContext,
  input: {
    competitionId: string;
    refereeId: string;
    comment: string;
    author?: string | null;
    matchLabel?: string | null;
  }
) {
  const comp = getCompetitionOrThrow(ctx, input.competitionId);
  const r = refereeOf(ctx, comp.id, input.refereeId);
  return ctx.db.addRefereeComment(
    comp.id,
    r.id,
    input.comment,
    input.author ?? null,
    input.matchLabel ?? null
  );
}

export function unregisterReferee(
  ctx: CommandContext,
  input: { competitionId: string; refereeId: string; dryRun?: boolean }
) {
  const comp = getCompetitionOrThrow(ctx, input.competitionId);
  const r = refereeOf(ctx, comp.id, input.refereeId);
  const busy = sessionPools(readSession(ctx, comp.id)).some(p =>
    p.matches?.some(m => m.status === MatchStatus.IN_PROGRESS && m.referee?.id === r.id)
  );
  if (busy) {
    throw new CommandError('referee_busy', 'Arbitre d’un match en cours : désinscription refusée');
  }
  if (!input.dryRun) {
    ctx.db.deleteReferee(r.id);
    ctx.emitChange?.({ scope: 'referees', competitionIds: [comp.id] });
  }
  return { dryRun: !!input.dryRun, refereeId: r.id };
}
