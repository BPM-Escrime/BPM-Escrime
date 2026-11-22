/**
 * BellePoule Modern - Tireurs entre l'écran et le contrat (#1981, docs/adr/0018)
 * Le contrat transporte les dates en ISO 8601 ; l'écran manipule des Date.
 * Licensed under GPL-3.0
 */
import type { Input, Output } from '../../shared/api/contract';
import type { ExclusionReason, Fencer, FencerStatus, Gender } from '../../shared/types';

type FencerDTO = Output<'listFencers'>[number];
type RegisterInput = Input<'registerFencers'>['fencers'][number];
type DetailsInput = Input<'updateFencerDetails'>['details'];

/** Champs d'identité, sans règle (updateFencerDetails) */
export const FENCER_DETAIL_KEYS = [
  'lastName',
  'firstName',
  'birthDate',
  'gender',
  'nationality',
  'region',
  'department',
  'club',
  'license',
  'handedness',
  'photo',
] as const;

export function fencerFromDTO(d: FencerDTO): Fencer {
  const opt = <T>(v: T | null): T | undefined => (v === null ? undefined : v);
  return {
    id: d.id,
    ref: d.ref,
    lastName: d.lastName,
    firstName: d.firstName,
    birthDate: d.birthDate ? new Date(d.birthDate) : undefined,
    gender: d.gender as Gender,
    nationality: d.nationality,
    region: opt(d.region),
    department: opt(d.department),
    club: opt(d.club),
    license: opt(d.license),
    ranking: opt(d.ranking),
    handedness: opt(d.handedness),
    status: d.status as FencerStatus,
    exclusionReason: d.exclusionReason as ExclusionReason | null,
    seedNumber: opt(d.seedNumber),
    initialRanking: opt(d.initialRanking),
    finalRanking: opt(d.finalRanking),
    photo: opt(d.photo),
    // Dates de création non exposées par le contrat : sans usage à l'écran
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

const isoDay = (v: unknown): string | null => {
  if (!v) return null;
  const date = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};
/** Texte vide ou absent : effacé */
const text = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s : null;
};

/** Identité d'un tireur → entrée de updateFencerDetails (seuls les champs présents) */
export function detailsInput(updates: Partial<Fencer>): DetailsInput {
  const out: Record<string, unknown> = {};
  for (const key of FENCER_DETAIL_KEYS) {
    if (!(key in updates)) continue;
    const v = updates[key];
    if (key === 'birthDate') out.birthDate = isoDay(v);
    else if (key === 'lastName' || key === 'firstName') out[key] = String(v ?? '').trim();
    else if (key === 'gender' || key === 'handedness') {
      if (v) out[key] = v;
    } else if (key === 'nationality') {
      const n = text(v);
      if (n) out.nationality = n.toUpperCase();
    } else out[key] = text(v);
  }
  return out as DetailsInput;
}

/** Tireur saisi ou importé → entrée de registerFencers */
export function registerInput(f: Partial<Fencer>): RegisterInput {
  const details = detailsInput(f);
  return {
    ...details,
    lastName: String(f.lastName ?? '').trim(),
    firstName: String(f.firstName ?? '').trim(),
    ranking: typeof f.ranking === 'number' && f.ranking >= 1 ? Math.trunc(f.ranking) : null,
    status: f.status === 'P' ? 'P' : 'N',
  } as RegisterInput;
}
