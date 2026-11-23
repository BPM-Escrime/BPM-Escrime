/**
 * BPM - Escrime - État de l'épreuve exposé par le contrat (#1980, docs/adr/0017, étape 4a)
 * Projection tenue par le moteur dans session_state, lue par getCompetitionState : l'écran la
 * relit quand le journal avance au lieu de relire le bloc par sa propre API.
 * Licensed under GPL-3.0
 */
import type { CompetitionStateDTO } from '../../../shared/api/contract';
import type { Competition } from '../../../shared/types';
import type { TeamsStateDTO } from '../../../shared/api/contractTeams';
import { sessionGroupTableaux } from '../../../shared/domain/ranking/splitGroups';
import { groupTableauxView } from './groupTableaux';

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/**
 * État d'une épreuve à partir du bloc de session ; null si l'épreuve n'a jamais été ouverte.
 * Tableaux séparés après les poules (docs/adr/0024) : un tableau par groupe dans
 * groupTableaux, tableau repris de la racine compris (rangé sous son groupe).
 */
export function competitionState(
  session: Record<string, unknown>,
  comp?: Competition,
  /** Épreuve par équipes : bloc lu dans les tables des équipes (docs/adr/0024) */
  teams?: TeamsStateDTO | null
): CompetitionStateDTO | null {
  // Épreuve par équipes jamais ouverte : son état est dans les tables des équipes
  if (Object.keys(session).length === 0 && !teams) return null;
  const groups = comp ? groupTableauxView(comp, session) : null;
  // Tableau repris lu dans son groupe : la racine ne le montre plus
  const rootMoved =
    !!groups &&
    Array.isArray(session.tableauMatches) &&
    session.tableauMatches.length > 0 &&
    Object.values(groups).some(g => g.tableauMatches === session.tableauMatches);
  const ui = (session.uiState ?? {}) as { currentPoolRound?: number };
  const prep = session.poolPrepParams as CompetitionStateDTO['poolPrepParams'];
  return {
    currentPhase: typeof session.currentPhase === 'number' ? session.currentPhase : 0,
    pools: arr(session.pools),
    poolHistory: arr(session.poolHistory),
    appelHistory: arr(session.appelHistory),
    overallRanking: arr(session.overallRanking),
    tableauMatches: rootMoved ? [] : arr(session.tableauMatches),
    finalResults: rootMoved ? [] : arr(session.finalResults),
    consolationBrackets: rootMoved ? [] : arr(session.consolationBrackets),
    // Tour courant : l'écran le range dans uiState, le moteur au premier niveau
    currentPoolRound: Number(ui.currentPoolRound ?? session.currentPoolRound ?? 1) || 1,
    skipPoolPhase: session.skipPoolPhase === true,
    ...(typeof session.poolsLaunched === 'boolean' ? { poolsLaunched: session.poolsLaunched } : {}),
    ...(typeof session.remoteArenaCount === 'number'
      ? { remoteArenaCount: session.remoteArenaCount }
      : {}),
    ...(typeof session.remoteStripStart === 'number'
      ? { remoteStripStart: session.remoteStripStart }
      : {}),
    ...(session.rapieres ? { rapieres: session.rapieres as CompetitionStateDTO['rapieres'] } : {}),
    ...(prep ? { poolPrepParams: prep } : {}),
    // Tableaux séparés après les poules (docs/adr/0024) : onglets de l'écran (lot A2)
    ...(groups
      ? { groupTableaux: groups }
      : session.groupTableaux && Object.keys(sessionGroupTableaux(session)).length > 0
        ? { groupTableaux: sessionGroupTableaux(session) }
        : {}),
    // Épreuve par équipes (docs/adr/0024) : équipes, rencontres, relais ; null : individuelle
    ...(teams !== undefined ? { teams } : {}),
  };
}
