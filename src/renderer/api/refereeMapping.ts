/**
 * BellePoule Modern - Arbitres entre l'écran et le contrat (#1981, docs/adr/0018)
 * Licensed under GPL-3.0
 */
import type { Input, Output } from '../../shared/api/contract';
import type { Gender, Referee } from '../../shared/types';

type RefereeDTO = Output<'listReferees'>[number];
type RegisterInput = Input<'registerReferees'>['referees'][number];

export function refereeFromDTO(d: RefereeDTO): Referee {
  return {
    id: d.id,
    ref: d.ref,
    firstName: d.firstName,
    lastName: d.lastName,
    gender: d.gender as Gender,
    nationality: d.nationality ?? 'FRA',
    region: d.region ?? undefined,
    club: d.club ?? undefined,
    license: d.license ?? undefined,
    category: d.category ?? undefined,
    status: d.status,
    // Dates de création non exposées par le contrat : sans usage à l'écran
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

/** Nom saisi d'un bloc (« Prénom Nom ») : le dernier mot est le nom, comme en base */
export function splitRefereeName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/);
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] ?? '' };
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
}): RegisterInput {
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
