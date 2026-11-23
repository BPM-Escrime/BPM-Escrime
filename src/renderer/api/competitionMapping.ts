/**
 * BPM - Escrime - Épreuves entre l'écran et le contrat (#1981, docs/adr/0018)
 * Le contrat transporte les dates en ISO 8601 et ne joint ni tireurs ni arbitres.
 * Licensed under GPL-3.0
 */
import type { BpmClient } from '../../shared/api/client';
import { ApiError } from '../../shared/api/client';
import type { Output } from '../../shared/api/contract';
import type { Competition, CompetitionSettings } from '../../shared/types';
import { fencerFromDTO } from './fencerMapping';

type CompetitionDTO = Output<'getCompetition'>;

export function competitionFromDTO(d: CompetitionDTO): Competition {
  return {
    id: d.id,
    title: d.title,
    ...(d.shortTitle !== null ? { shortTitle: d.shortTitle } : {}),
    date: new Date(d.date),
    ...(d.location !== null ? { location: d.location } : {}),
    ...(d.organizer !== null ? { organizer: d.organizer } : {}),
    weapon: d.weapon,
    gender: d.gender,
    category: d.category,
    ...(d.championship !== null ? { championship: d.championship } : {}),
    color: d.color ?? '#3B82F6',
    isTeamEvent: d.isTeamEvent,
    status: d.status ?? 'draft',
    ...(d.fencerCount !== null ? { fencerCount: d.fencerCount } : {}),
    // Anciennes épreuves : clés éventuellement absentes, comme avant la lecture par le contrat
    settings: d.settings as CompetitionSettings,
    fencers: [],
    referees: [],
    phases: [],
    currentPhaseIndex: 0,
    createdAt: new Date(d.createdAt),
    updatedAt: new Date(d.updatedAt),
  };
}

/** Épreuve par le contrat ; null si elle n'existe pas (ou plus) */
export async function loadCompetition(
  client: BpmClient,
  competitionId: string,
  options: { withFencers?: boolean } = {}
): Promise<Competition | null> {
  try {
    const comp = competitionFromDTO(await client.query('getCompetition', { competitionId }));
    if (options.withFencers) {
      comp.fencers = (await client.query('listFencers', { competitionId })).map(fencerFromDTO);
    }
    return comp;
  } catch (e) {
    if (e instanceof ApiError && e.code === 'competition_not_found') return null;
    throw e;
  }
}
