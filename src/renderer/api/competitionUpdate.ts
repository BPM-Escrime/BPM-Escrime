/**
 * BellePoule Modern - Écriture d'une épreuve modifiée à l'écran (#1981, docs/adr/0018)
 * Sépare les données sans règle (updateCompetitionDetails) de l'arme, du format et des
 * réglages (updateCompetitionSettings) ; seuls les champs qui changent sont envoyés.
 * Licensed under GPL-3.0
 */
import type { BpmClient } from '../../shared/api/client';
import type { Competition } from '../../shared/types';

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const isoDate = (d: unknown) => {
  const date = d instanceof Date ? d : new Date(String(d));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

export async function persistCompetitionUpdate(
  client: BpmClient,
  before: Competition,
  updates: Partial<Competition>
): Promise<void> {
  const competitionId = before.id;
  const details: Record<string, unknown> = {};
  if (updates.title !== undefined && updates.title !== before.title) details.title = updates.title;
  if (updates.date !== undefined && isoDate(updates.date) !== isoDate(before.date)) {
    details.date = isoDate(updates.date);
  }
  if (updates.location !== undefined && updates.location !== before.location) {
    details.location = updates.location || null;
  }
  if (updates.organizer !== undefined && updates.organizer !== before.organizer) {
    details.organizer = updates.organizer || null;
  }
  if (Object.keys(details).length > 0) {
    await client.call('updateCompetitionDetails', { competitionId, details });
  }

  const settings: Record<string, unknown> = {};
  const next = (updates.settings ?? {}) as unknown as Record<string, unknown>;
  const prev = (before.settings ?? {}) as unknown as Record<string, unknown>;
  for (const key of Object.keys(next)) {
    if (!same(next[key], prev[key])) settings[key] = next[key];
  }
  const rules = {
    ...(updates.weapon !== undefined && updates.weapon !== before.weapon
      ? { weapon: updates.weapon }
      : {}),
    ...(updates.gender !== undefined && updates.gender !== before.gender
      ? { gender: updates.gender }
      : {}),
    ...(updates.category !== undefined && updates.category !== before.category
      ? { category: updates.category }
      : {}),
    ...(updates.isTeamEvent !== undefined && updates.isTeamEvent !== !!before.isTeamEvent
      ? { isTeamEvent: updates.isTeamEvent }
      : {}),
  };
  if (Object.keys(rules).length > 0 || Object.keys(settings).length > 0) {
    await client.call('updateCompetitionSettings', {
      competitionId,
      ...rules,
      ...(Object.keys(settings).length > 0 ? { settings } : {}),
    });
  }
}
