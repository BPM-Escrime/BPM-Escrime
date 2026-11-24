/**
 * BPM - Escrime - Données du rapport d'exclusion (carton noir) pour la FFE (#1829)
 * Tireurs exclus par carton noir ; pour chacun, match de la sanction : celui du retrait au journal
 * (FencerWithdrawn, heure et source, #2190), sinon celui où la base porte un carton noir pour ce
 * tireur, sinon son dernier match joué (poule ou tableau).
 * Licensed under GPL-3.0
 */

import {
  CardGroup,
  MatchStatus,
  type Competition,
  type Fencer,
  type Pool,
} from '../../shared/types';
import type { TableauMatch } from '../../shared/domain/tableau/tableauTypes';
import type { BlackCardReportEntry } from '../../shared/utils/pdfExport/blackCardReportPdf';
import { isBlackCardExcluded } from '../../shared/domain/fencers/fencerStatus';
import { getReasonsByGroupForWeapon } from '../../shared/domain/penalties/cards';
import { CARD_REASON_LABELS } from '../../shared/utils/cardSystem';
import type { BpmClient } from '../../shared/api/client';
// Types seuls : le module des schémas (zod) reste hors du chargement initial (budget du bundle)
import type { EventSource } from '../../shared/api/events';
import { defaultBpmClient } from '../api/IpcClient';

interface Candidate {
  id: string;
  phase: string;
  fencerA: Fencer | null | undefined;
  fencerB: Fencer | null | undefined;
  scoreA?: number | null;
  scoreB?: number | null;
  strip?: number | null;
  referee?: string;
  at?: Date;
}

const fullName = (f?: Fencer | null): string =>
  f ? `${f.lastName.toUpperCase()} ${f.firstName ?? ''}`.trim() : '';

/** Règle unique : shared/domain/fencers/fencerStatus (#1979, lot 4) */
export const isBlackCardExclusion = (f: Fencer): boolean => isBlackCardExcluded(f);

/** Origine du carton, en clair sur le rapport fédéral (français) */
const SOURCE_LABELS: Record<EventSource, string> = {
  screen: 'Écran du directoire technique',
  tablet: 'Tablette d’arbitre',
  cyrano: 'Appareil de piste (Cyrano)',
  opp2: 'Appareil de piste (OPP2)',
  mcp: 'Agent (MCP)',
  engine: 'BPM - Escrime',
};

interface JournalBlackCard {
  matchId: string | null;
  at: Date;
  source: EventSource;
}

/** Dernière exclusion sur carton noir de chaque tireur, lue au journal ; vide hors moteur */
async function readJournalBlackCards(
  client: BpmClient,
  competitionId: string
): Promise<Map<string, JournalBlackCard>> {
  const found = new Map<string, JournalBlackCard>();
  const limit = 5000;
  let since = 0;
  for (;;) {
    const page = await client
      .query('getCompetitionEvents', { competitionId, since, limit })
      .catch(() => null);
    if (!page) return found;
    for (const ev of page.events) {
      if (ev.type !== 'FencerWithdrawn' || !ev.payload.blackCard) continue;
      found.set(ev.payload.fencerId, {
        matchId: ev.payload.matchId,
        at: new Date(ev.at),
        source: ev.source,
      });
    }
    if (page.events.length < limit) return found;
    since = page.events[page.events.length - 1].revision;
  }
}

export interface BlackCardEntriesOptions {
  /** Épreuve : heure, source et match du carton lus au journal (#2190) */
  competitionId?: string;
  /** Tireurs à joindre même si l'exclusion n'est pas encore enregistrée (appel DT) */
  fencerIds?: string[];
}

export async function buildBlackCardEntries(
  fencers: Fencer[],
  pools: Pool[] = [],
  tableauMatches: TableauMatch[] = [],
  client: BpmClient = defaultBpmClient,
  options: BlackCardEntriesOptions = {}
): Promise<BlackCardReportEntry[]> {
  const wanted = new Set(options.fencerIds ?? []);
  const excluded = fencers.filter(f =>
    wanted.size > 0 ? wanted.has(f.id) : isBlackCardExclusion(f)
  );
  if (excluded.length === 0) return [];
  const candidates: Candidate[] = [
    ...pools.flatMap(p =>
      (p.matches ?? [])
        .filter(m => m.status === MatchStatus.FINISHED)
        .map(m => ({
          id: m.id,
          phase: `Poule ${p.number}`,
          fencerA: m.fencerA,
          fencerB: m.fencerB,
          scoreA: m.scoreA?.value,
          scoreB: m.scoreB?.value,
          strip: m.strip ?? p.strip,
          referee: m.referee
            ? `${m.referee.lastName} ${m.referee.firstName ?? ''}`.trim()
            : undefined,
          at: m.updatedAt ? new Date(m.updatedAt) : undefined,
        }))
    ),
    ...tableauMatches
      .filter(m => !m.isBye && m.winner)
      .map(m => ({
        id: m.id,
        phase: m.round > 1 ? `Tableau de ${m.round}` : 'Finale',
        fencerA: m.fencerA,
        fencerB: m.fencerB,
        scoreA: m.scoreA,
        scoreB: m.scoreB,
        strip: m.arena,
        referee: m.referee ? `${m.referee.lastName} ${m.referee.firstName}`.trim() : undefined,
      })),
  ];
  // Contrat d'API (#1981) : requête getMatchCards ; hors Electron, repli sur le dernier match
  const getCards = (matchId: string) => client.query('getMatchCards', { matchId });
  const journal = options.competitionId
    ? await readJournalBlackCards(client, options.competitionId)
    : new Map<string, JournalBlackCard>();

  const entries: BlackCardReportEntry[] = [];
  for (const f of excluded) {
    const own = candidates.filter(c => c.fencerA?.id === f.id || c.fencerB?.id === f.id);
    const logged = journal.get(f.id);
    let match: Candidate | undefined = logged?.matchId
      ? own.find(c => c.id === logged.matchId)
      : undefined;
    let at: Date | undefined = logged?.at;
    for (const c of match ? [] : own) {
      const black = (await getCards(c.id).catch(() => [])).find(
        r => r.fencerId === f.id && r.cardType === 'black'
      );
      if (black) {
        match = c;
        at = new Date(black.timestamp);
        break;
      }
    }
    match ??= [...own].sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0))[0];
    const isA = match?.fencerA?.id === f.id;
    entries.push({
      fencer: { lastName: f.lastName, firstName: f.firstName, license: f.license, club: f.club },
      phase: match?.phase,
      opponent: match ? fullName(isA ? match.fencerB : match.fencerA) : undefined,
      score:
        match && match.scoreA != null && match.scoreB != null
          ? isA
            ? `${match.scoreA} – ${match.scoreB}`
            : `${match.scoreB} – ${match.scoreA}`
          : undefined,
      strip: match?.strip ?? undefined,
      referee: match?.referee,
      at: at ?? match?.at,
      source: logged ? SOURCE_LABELS[logged.source] : undefined,
    });
  }
  return entries;
}

/** Motifs du carton noir de l'arme (4e groupe), libellés français du rapport */
export const blackCardReasonLabels = (weapon: Competition['weapon']): string[] =>
  (getReasonsByGroupForWeapon(weapon)?.[CardGroup.GROUP_4] ?? []).map(r => CARD_REASON_LABELS[r]);

/**
 * Rapport d'exclusion pré-rempli (PDF) : tous les exclus sur carton noir, ou les tireurs donnés
 * (appel DT de la tablette, #2190). Rend le nombre de pages.
 */
export async function exportBlackCardReport(
  competition: Competition,
  fencers: Fencer[],
  pools: Pool[],
  tableauMatches: TableauMatch[],
  fencerIds?: string[],
  client: BpmClient = defaultBpmClient
): Promise<number> {
  const entries = await buildBlackCardEntries(fencers, pools, tableauMatches, client, {
    competitionId: competition.id,
    fencerIds,
  });
  if (entries.length === 0) return 0;
  const { exportBlackCardReportToPDF } =
    await import('../../shared/utils/pdfExport/blackCardReportPdf');
  await exportBlackCardReportToPDF(
    {
      title: competition.title,
      date: competition.date ? new Date(competition.date) : undefined,
      location: competition.location,
      organizer: competition.organizer,
      weapon: competition.weapon,
      category: competition.category,
      gender: competition.gender,
      reasons: blackCardReasonLabels(competition.weapon),
    },
    entries
  );
  return entries.length;
}
