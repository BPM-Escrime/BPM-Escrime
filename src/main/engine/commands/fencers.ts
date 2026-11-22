/**
 * BellePoule Modern - Inscription des tireurs (#1981, docs/adr/0018)
 * registerFencers, updateFencerDetails, setFencerRankings, unregisterFencers : commandes
 * d'intention à la place des écritures de table de l'écran. Pas de journal : l'inscription
 * précède le tirage, où le journal commence (docs/adr/0017).
 * Licensed under GPL-3.0
 */
import { FencerStatus, Gender, type Fencer } from '../../../shared/types';
import { CommandError, type CommandContext } from './context';
import { getCompetitionOrThrow } from './competitions';
import { readSession } from './sessionView';
import { sessionPools, sessionTableau } from './sport';

/** Données d'identité d'un tireur, sans règle (docs/adr/0018) */
export interface FencerDetailsInput {
  lastName?: string;
  firstName?: string;
  /** ISO 8601 (AAAA-MM-JJ) ; null : effacée */
  birthDate?: string | null;
  gender?: 'M' | 'F' | 'X';
  nationality?: string;
  region?: string | null;
  department?: string | null;
  club?: string | null;
  license?: string | null;
  handedness?: 'R' | 'L';
  photo?: string | null;
}

export interface RegisterFencerInput extends FencerDetailsInput {
  lastName: string;
  firstName: string;
  ranking?: number | null;
  /** Statut initial : non pointé (défaut) ou pointé */
  status?: 'N' | 'P';
}

/** Tireur exposé par le contrat : dates en ISO 8601 */
export function fencerDTO(f: Fencer) {
  return {
    id: f.id,
    ref: f.ref,
    lastName: f.lastName,
    firstName: f.firstName,
    birthDate: f.birthDate ? new Date(f.birthDate).toISOString() : null,
    gender: f.gender,
    nationality: f.nationality,
    region: f.region ?? null,
    department: f.department ?? null,
    club: f.club ?? null,
    license: f.license ?? null,
    ranking: f.ranking ?? null,
    handedness: f.handedness ?? null,
    status: f.status,
    exclusionReason: f.exclusionReason ?? null,
    seedNumber: f.seedNumber ?? null,
    initialRanking: f.initialRanking ?? null,
    finalRanking: f.finalRanking ?? null,
    photo: f.photo ?? null,
  };
}

/** Poules tirées, épreuve sans poules ou tableau généré : l'inscription est close */
export function drawDone(ctx: CommandContext, competitionId: string): boolean {
  const session = readSession(ctx, competitionId);
  return (
    sessionPools(session).length > 0 ||
    sessionTableau(session).length > 0 ||
    session.skipPoolPhase === true
  );
}

/** Champs d'identité → patch de la base (undefined : inchangé, null : effacé) */
function detailsPatch(d: FencerDetailsInput): Partial<Fencer> {
  const patch: Record<string, unknown> = {};
  const set = (k: keyof FencerDetailsInput, v: unknown) => {
    if (d[k] !== undefined) patch[k] = v;
  };
  set('lastName', d.lastName?.trim());
  set('firstName', d.firstName?.trim());
  set('birthDate', d.birthDate ? new Date(d.birthDate) : undefined);
  set('gender', d.gender);
  set('nationality', d.nationality?.trim().toUpperCase());
  set('region', d.region ?? undefined);
  set('department', d.department ?? undefined);
  set('club', d.club ?? undefined);
  set('license', d.license ?? undefined);
  set('handedness', d.handedness);
  set('photo', d.photo ?? undefined);
  return patch as Partial<Fencer>;
}

const norm = (s: string | undefined | null) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();

/** Doublon : même licence, sinon mêmes nom et prénom */
function duplicateOf(existing: Fencer[], f: RegisterFencerInput): Fencer | undefined {
  const license = norm(f.license);
  return existing.find(e =>
    license
      ? norm(e.license) === license
      : norm(e.lastName) === norm(f.lastName) && norm(e.firstName) === norm(f.firstName)
  );
}

export function registerFencers(
  ctx: CommandContext,
  input: { competitionId: string; fencers: RegisterFencerInput[]; dryRun?: boolean }
) {
  const comp = getCompetitionOrThrow(ctx, input.competitionId);
  const existing = ctx.db.getFencersByCompetition(comp.id);
  const duplicates: Array<{ index: number; fencerId: string }> = [];
  input.fencers.forEach((f, index) => {
    const dup = duplicateOf(existing, f);
    if (dup) duplicates.push({ index, fencerId: dup.id });
  });
  if (input.dryRun) return { dryRun: true, fencers: [], duplicates };
  const created: Fencer[] = [];
  ctx.db.transaction(() => {
    for (const f of input.fencers) {
      created.push(
        ctx.db.addFencer(comp.id, {
          gender: Gender.MALE,
          nationality: 'FRA',
          ...detailsPatch(f),
          ranking: f.ranking ?? undefined,
          status: f.status === 'P' ? FencerStatus.CHECKED_IN : FencerStatus.NOT_CHECKED_IN,
        })
      );
    }
  });
  if (created.length) ctx.emitChange?.({ scope: 'fencers', competitionIds: [comp.id] });
  return { dryRun: false, fencers: created.map(fencerDTO), duplicates };
}

function fencerOf(ctx: CommandContext, competitionId: string, fencerId: string): Fencer {
  const f = ctx.db.getFencer(fencerId);
  if (!f || !ctx.db.getFencersByCompetition(competitionId).some(x => x.id === fencerId)) {
    throw new CommandError('fencer_not_found', `Tireur introuvable : ${fencerId}`);
  }
  return f;
}

export function updateFencerDetails(
  ctx: CommandContext,
  input: { competitionId: string; fencerId: string; details: FencerDetailsInput; dryRun?: boolean }
) {
  const comp = getCompetitionOrThrow(ctx, input.competitionId);
  const f = fencerOf(ctx, comp.id, input.fencerId);
  const patch = detailsPatch(input.details);
  if (patch.lastName === '' || patch.firstName === '') {
    throw new CommandError('invalid_name', 'Nom et prénom ne peuvent pas être vides');
  }
  if (!input.dryRun && Object.keys(patch).length > 0) {
    ctx.db.updateFencer(f.id, patch);
    ctx.emitChange?.({ scope: 'fencers', competitionIds: [comp.id] });
  }
  const updated = input.dryRun ? { ...f, ...patch } : (ctx.db.getFencer(f.id) ?? f);
  return { dryRun: !!input.dryRun, fencer: fencerDTO(updated) };
}

export function setFencerRankings(
  ctx: CommandContext,
  input: {
    competitionId: string;
    rankings: Array<{ fencerId: string; ranking: number | null }>;
    dryRun?: boolean;
  }
) {
  const comp = getCompetitionOrThrow(ctx, input.competitionId);
  if (drawDone(ctx, comp.id)) {
    throw new CommandError(
      'draw_done',
      'Poules tirées ou tableau généré : le classement d’entrée est figé'
    );
  }
  const ids = new Set(ctx.db.getFencersByCompetition(comp.id).map(f => f.id));
  const unknown = input.rankings.filter(r => !ids.has(r.fencerId)).map(r => r.fencerId);
  const known = input.rankings.filter(r => ids.has(r.fencerId));
  if (!input.dryRun && known.length) {
    ctx.db.transaction(() => {
      for (const r of known) {
        ctx.db.updateFencer(r.fencerId, { ranking: r.ranking ?? undefined });
      }
    });
    ctx.emitChange?.({ scope: 'fencers', competitionIds: [comp.id] });
  }
  return { dryRun: !!input.dryRun, updated: known.length, unknown };
}

export function unregisterFencers(
  ctx: CommandContext,
  input: { competitionId: string; fencerIds?: string[]; all?: boolean; dryRun?: boolean }
) {
  const comp = getCompetitionOrThrow(ctx, input.competitionId);
  if (!input.all && !input.fencerIds?.length) {
    throw new CommandError('invalid_input', 'fencerIds ou all requis');
  }
  if (drawDone(ctx, comp.id)) {
    throw new CommandError(
      'draw_done',
      'Poules tirées ou tableau généré : retirer le tireur (withdrawFencer) au lieu de le désinscrire'
    );
  }
  const all = ctx.db.getFencersByCompetition(comp.id);
  const targets = input.all ? all : all.filter(f => input.fencerIds!.includes(f.id));
  const unknown = input.all ? [] : input.fencerIds!.filter(id => !all.some(f => f.id === id));
  if (!input.dryRun && targets.length) {
    ctx.db.transaction(() => {
      if (input.all) ctx.db.deleteAllFencers(comp.id);
      else for (const f of targets) ctx.db.deleteFencer(f.id);
    });
    ctx.emitChange?.({ scope: 'fencers', competitionIds: [comp.id] });
  }
  return { dryRun: !!input.dryRun, removed: targets.map(f => f.id), unknown };
}
