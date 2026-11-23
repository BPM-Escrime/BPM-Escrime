/**
 * BPM - Escrime - Création des tireurs, équipes et arbitres lus dans les fichiers
 * de l'extranet, juste après la création de la compétition (#1938)
 * Tireurs et arbitres par le contrat (registerFencers, registerReferees, docs/adr/0018) ;
 * équipes encore écrites par l'écran (épreuves par équipes hors moteur, #2100).
 * Licensed under GPL-3.0
 */
import type { BpmClient } from '../../shared/api/client';
import type { Fencer } from '../../shared/types';
import { fencerKey } from '../../shared/utils/fileParser/common';
import { logger, LogCategory } from '../../shared/services/logger';
import type { FederalCreationPayload } from '../hooks/useFederalImport';
import { fencerFromDTO, registerInput } from '../api/fencerMapping';
import { registerRefereeInput } from '../api/refereeMapping';

export interface FederalCreationCounts {
  fencers: number;
  teams: number;
  referees: number;
}

/**
 * Inscrit d'un bloc ; refus du bloc (une entrée invalide) : un par un, l'échec unitaire est
 * journalisé sans interrompre le reste. Rend les créés dans l'ordre (null : non créé).
 */
async function registerAll<T, R>(
  items: T[],
  send: (batch: T[]) => Promise<R[]>,
  label: string
): Promise<Array<R | null>> {
  if (items.length === 0) return [];
  try {
    return await send(items);
  } catch {
    const out: Array<R | null> = [];
    for (const item of items) {
      try {
        out.push((await send([item]))[0] ?? null);
      } catch (err) {
        logger.error(LogCategory.UI, `Federal import: ${label} not created`, err as Error);
        out.push(null);
      }
    }
    return out;
  }
}

/**
 * Crée tireurs, équipes (nom de l'extranet conservé ; titulaires dans l'ordre du fichier,
 * puis réservistes) et arbitres.
 */
export async function applyFederalImport(
  client: BpmClient,
  competitionId: string,
  payload: FederalCreationPayload,
  starters: number
): Promise<FederalCreationCounts> {
  const counts: FederalCreationCounts = { fencers: 0, teams: 0, referees: 0 };
  const created = new Map<string, Fencer>();

  const fencers = await registerAll(
    payload.fencers,
    async batch =>
      (
        await client.call('registerFencers', {
          competitionId,
          fencers: batch.map(registerInput),
        })
      ).fencers.map(fencerFromDTO),
    'fencer'
  );
  fencers.forEach((fencer, i) => {
    if (!fencer) return;
    created.set(fencerKey(payload.fencers[i]), fencer);
    counts.fencers++;
  });

  // Équipes : modèle de relais hors moteur, écrit par l'écran en attendant l'ADR de #2100
  const db = window.electronAPI?.db;
  for (const team of db ? payload.teams : []) {
    try {
      const { id } = await db!.createTeam(competitionId, team.name, team.club || team.name);
      counts.teams++;
      let order = 0;
      for (const key of team.members) {
        const fencer = created.get(key);
        if (!fencer) continue;
        order++;
        await db!.upsertTeamFencer(id, fencer.id, order, order > starters);
      }
    } catch (err) {
      logger.error(LogCategory.UI, 'Federal import: team not created', err as Error);
    }
  }

  const referees = await registerAll(
    payload.referees,
    async batch =>
      (
        await client.call('registerReferees', {
          competitionId,
          referees: batch.map(r => registerRefereeInput(r)),
        })
      ).referees,
    'referee'
  );
  counts.referees = referees.filter(Boolean).length;

  return counts;
}
