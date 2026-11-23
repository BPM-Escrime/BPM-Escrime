/**
 * BPM - Escrime - Rejeu des faits d'une épreuve par équipes (docs/adr/0024, lots E1 et E2)
 * Poules d'équipes, tableau, rencontres et leurs relais, score de chaque relais, rencontres
 * terminées, remplaçants. Les dérivés (cumul, classement de poule, avancement du tableau) se
 * recalculent ; seul le retrait de la rencontre suivante à la réouverture d'un relais suit la
 * règle du moteur (reopenRelay : rencontre suivante pas encore commencée, donc retirée).
 * Licensed under GPL-3.0
 */
import { JOURNAL_EVENT, type JournalEventBody } from '../../api/events';
import type { TeamsFact } from './projectCompetition';

type TeamEvent = Extract<
  JournalEventBody,
  {
    type:
      | typeof JOURNAL_EVENT.teamPoolsGenerated
      | typeof JOURNAL_EVENT.teamMatchScheduled
      | typeof JOURNAL_EVENT.teamTableauGenerated
      | typeof JOURNAL_EVENT.relayScoreRecorded
      | typeof JOURNAL_EVENT.relayReopened
      | typeof JOURNAL_EVENT.teamMatchDecided
      | typeof JOURNAL_EVENT.teamFencerSubstituted;
  }
>;

const empty = (): TeamsFact => ({
  pools: [],
  matches: [],
  tableau: null,
  relayResults: {},
  decisions: {},
});

/** Rencontres retirées avec leurs résultats */
function dropMatches(teams: TeamsFact, drop: (m: TeamsFact['matches'][number]) => boolean) {
  const gone = new Set(teams.matches.filter(drop).map(m => m.matchId));
  if (gone.size === 0) return;
  teams.matches = teams.matches.filter(m => !gone.has(m.matchId));
  for (const [relayId, r] of Object.entries(teams.relayResults)) {
    if (gone.has(r.matchId)) delete teams.relayResults[relayId];
  }
  for (const id of gone) delete teams.decisions[id];
}

/** Applique un fait d'équipe ; rend les faits mis à jour */
export function projectTeamEvent(current: TeamsFact | null, event: TeamEvent): TeamsFact {
  const teams = current ?? empty();
  switch (event.type) {
    case JOURNAL_EVENT.teamPoolsGenerated:
      // Nouveau tirage : il remplace les poules et leurs rencontres
      teams.pools = event.payload.pools.map(p => ({ number: p.number, teamIds: [...p.teamIds] }));
      dropMatches(teams, m => m.pool !== null);
      break;
    case JOURNAL_EVENT.teamTableauGenerated:
      // Nouveau tableau : il remplace les rencontres du tableau précédent
      teams.tableau = { size: event.payload.size, slots: event.payload.slots.map(s => ({ ...s })) };
      dropMatches(teams, m => m.pool === null);
      break;
    case JOURNAL_EVENT.teamMatchScheduled: {
      const p = event.payload;
      dropMatches(teams, m => m.matchId === p.matchId);
      teams.matches.push({ ...p, relays: p.relays.map(r => ({ ...r })) });
      break;
    }
    case JOURNAL_EVENT.relayScoreRecorded: {
      const { matchId, relayId, scoreA, scoreB } = event.payload;
      teams.relayResults[relayId] = { matchId, scoreA, scoreB };
      break;
    }
    case JOURNAL_EVENT.relayReopened: {
      const { matchId, relayId } = event.payload;
      delete teams.relayResults[relayId];
      if (!(matchId in teams.decisions)) break;
      delete teams.decisions[matchId];
      // Tableau : la rencontre suivante, formée avec le vainqueur, est retirée
      const m = teams.matches.find(x => x.matchId === matchId);
      if (m && m.pool === null && m.round !== null && m.position !== null && m.round > 1) {
        const round = m.round / 2;
        const position = Math.floor(m.position / 2);
        dropMatches(teams, x => x.pool === null && x.round === round && x.position === position);
      }
      break;
    }
    case JOURNAL_EVENT.teamMatchDecided:
      teams.decisions[event.payload.matchId] = event.payload.winnerTeamId;
      break;
    case JOURNAL_EVENT.teamFencerSubstituted: {
      const { matchId, teamId, inFencerId, relayIds } = event.payload;
      const m = teams.matches.find(x => x.matchId === matchId);
      if (!m) break;
      const key = teamId === m.teamAId ? 'fencerAId' : 'fencerBId';
      for (const r of m.relays) if (relayIds.includes(r.relayId)) r[key] = inFencerId;
      break;
    }
  }
  return teams;
}
