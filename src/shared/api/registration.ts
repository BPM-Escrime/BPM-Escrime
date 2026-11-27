/**
 * BPM - Escrime - Tireur ou arbitre saisi ou importé → entrée des commandes d'inscription
 * (registerFencers, registerReferees, updateFencerDetails ; docs/adr/0018). Partagé par
 * l'écran et les outils MCP (#2134) : un seul mapping vers le contrat.
 * Licensed under GPL-3.0
 */
import type { Input } from './contract';
import type { Fencer, FencerMember } from '../types';
import { normalizeFencerCategory } from '../domain/fencers/fencerCategory';

type RegisterFencer = Input<'registerFencers'>['fencers'][number];
type RegisterReferee = Input<'registerReferees'>['referees'][number];
type FencerDetails = Input<'updateFencerDetails'>['details'];

/** Champs d'identité, sans règle (updateFencerDetails) */
export const FENCER_DETAIL_KEYS = [
  'lastName',
  'firstName',
  'birthDate',
  'category',
  'gender',
  'nationality',
  'region',
  'department',
  'club',
  'license',
  'handedness',
  'photo',
  'members',
  'level',
  'handicap',
] as const;

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

/** Membre d'une équipe → entrée du contrat (champs vides omis) */
function memberInput(m: FencerMember): FencerMember {
  return {
    lastName: m.lastName.trim(),
    firstName: m.firstName.trim(),
    ...(m.gender ? { gender: m.gender } : {}),
    ...(m.birthDate ? { birthDate: m.birthDate.slice(0, 10) } : {}),
  };
}

/** Identité d'un tireur → entrée de updateFencerDetails (seuls les champs présents) */
export function detailsInput(updates: Partial<Fencer>): FencerDetails {
  const out: Record<string, unknown> = {};
  for (const key of FENCER_DETAIL_KEYS) {
    if (!(key in updates)) continue;
    const v = updates[key];
    if (key === 'birthDate') out.birthDate = isoDay(v);
    else if (key === 'lastName' || key === 'firstName') out[key] = String(v ?? '').trim();
    else if (key === 'category') out.category = normalizeFencerCategory(v) ?? null;
    else if (key === 'members') {
      const list = Array.isArray(v) ? (v as FencerMember[]) : [];
      out.members = list.length > 0 ? list.map(memberInput) : null;
    } else if (key === 'level') {
      out.level = Number.isInteger(v) && (v as number) >= 1 ? v : null;
    } else if (key === 'handicap') out.handicap = v == null ? null : !!v;
    else if (key === 'gender' || key === 'handedness') {
      if (v) out[key] = v;
    } else if (key === 'nationality') {
      const n = text(v);
      if (n) out.nationality = n.toUpperCase();
    } else out[key] = text(v);
  }
  return out as FencerDetails;
}

/** Tireur saisi ou importé → entrée de registerFencers */
export function registerInput(f: Partial<Fencer>): RegisterFencer {
  const details = detailsInput(f);
  return {
    ...details,
    lastName: String(f.lastName ?? '').trim(),
    firstName: String(f.firstName ?? '').trim(),
    ranking: typeof f.ranking === 'number' && f.ranking >= 1 ? Math.trunc(f.ranking) : null,
    status: f.status === 'P' ? 'P' : 'N',
  } as RegisterFencer;
}

const opt = (v: string | undefined | null) => {
  const s = (v ?? '').trim();
  return s || undefined;
};

/** Arbitre saisi ou importé → entrée de registerReferees */
export function registerRefereeInput(r: {
  firstName?: string;
  lastName: string;
  gender?: string;
  nationality?: string;
  club?: string;
  license?: string;
  category?: string;
}): RegisterReferee {
  const gender = r.gender === 'F' || r.gender === 'X' || r.gender === 'M' ? r.gender : undefined;
  const nationality = opt(r.nationality);
  return {
    lastName: r.lastName.trim(),
    firstName: opt(r.firstName),
    ...(gender ? { gender } : {}),
    ...(nationality && nationality.length <= 3 ? { nationality: nationality.toUpperCase() } : {}),
    club: opt(r.club) ?? null,
    license: opt(r.license) ?? null,
    category: opt(r.category) ?? null,
  };
}
