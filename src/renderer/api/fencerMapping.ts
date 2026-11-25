/**
 * BPM - Escrime - Tireurs entre l'écran et le contrat (#1981, docs/adr/0018)
 * Le contrat transporte les dates en ISO 8601 ; l'écran manipule des Date.
 * Licensed under GPL-3.0
 */
import type { Output } from '../../shared/api/contract';
import type { ExclusionReason, Fencer, FencerStatus, Gender } from '../../shared/types';
import { normalizeFencerCategory } from '../../shared/domain/fencers/fencerCategory';

type FencerDTO = Output<'listFencers'>[number];

export { FENCER_DETAIL_KEYS } from '../../shared/api/registration';

export function fencerFromDTO(d: FencerDTO): Fencer {
  const opt = <T>(v: T | null): T | undefined => (v === null ? undefined : v);
  return {
    id: d.id,
    ref: d.ref,
    lastName: d.lastName,
    firstName: d.firstName,
    birthDate: d.birthDate ? new Date(d.birthDate) : undefined,
    category: normalizeFencerCategory(d.category),
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

export { detailsInput, registerInput } from '../../shared/api/registration';
