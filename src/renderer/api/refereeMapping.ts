/**
 * BPM - Escrime - Arbitres entre l'écran et le contrat (#1981, docs/adr/0018)
 * Licensed under GPL-3.0
 */
import type { Output } from '../../shared/api/contract';
import type { BpmClient } from '../../shared/api/client';
import type { Gender, Referee } from '../../shared/types';

type RefereeDTO = Output<'listReferees'>[number];

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

/** Arbitres d'une épreuve lus par le contrat (listReferees), au format de l'écran */
export const loadCompetitionReferees = (client: BpmClient, competitionId: string) =>
  client.query('listReferees', { competitionId }).then(rows => rows.map(refereeFromDTO));

/** Nom saisi d'un bloc (« Prénom Nom ») : le dernier mot est le nom, comme en base */
export function splitRefereeName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/);
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] ?? '' };
}

export { registerRefereeInput } from '../../shared/api/registration';
