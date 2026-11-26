/**
 * BPM - Escrime - État de l'épreuve relu par l'écran (docs/adr/0017, 0024)
 * Seul le moteur écrit l'état (session_state, tables des équipes) ; l'écran le lit au
 * chargement par getCompetitionState, puis le relit sur les signaux de l'épreuve. L'état propre
 * au poste (onglet, groupe affiché, préparation) est dans posteUiState.
 * Licensed under GPL-3.0
 */

import { splitHistoryOf, type SplitHistoryEntry } from '../../shared/domain/formula/splitPlan';
import type { TableauStageRecord } from '../../shared/domain/tableau/tableauStage';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Fencer, Pool, PoolRanking } from '../../shared/types';
import { logger, LogCategory } from '@shared/services/logger';
import type { CompetitionStateDTO } from '../../shared/api/contract';
import { useBpmClient } from '../api/BpmClientContext';
import {
  TableauMatch,
  FinalResult,
  ConsolationBracket,
} from '../../shared/domain/tableau/tableauTypes';
import type {
  RapieresLegacyState,
  RapieresSession,
} from '../../shared/domain/rapieres/rapieres.types';
import type { GroupTableau } from '../../shared/domain/ranking/splitGroups';

export type Phase =
  | 'checkin'
  | 'poolprep'
  | 'pools'
  | 'ranking'
  | 'quest'
  | 'tableau'
  | 'results'
  | 'remote'
  | 'logs'
  | 'referees'
  // Compétition par équipes (#1085)
  | 'teams'
  | 'teampool'
  | 'teamtableau'
  | 'teamranking';

/** Numéro persistant de chaque phase (sessions sauvegardées) — ne jamais renuméroter */
const PHASE_NUMBERS: Record<Phase, number> = {
  checkin: 0,
  poolprep: 1,
  pools: 2,
  ranking: 3,
  quest: 4,
  tableau: 5,
  results: 6,
  remote: 7,
  logs: 8,
  referees: 9,
  teams: 10,
  teampool: 11,
  teamtableau: 12,
  teamranking: 13,
};
const PHASES_BY_NUMBER: Record<number, Phase> = Object.fromEntries(
  Object.entries(PHASE_NUMBERS).map(([phase, n]) => [n, phase as Phase])
);

/** Phase correspondant au numéro sauvegardé (undefined si inconnu) */
/** Numéro d'ordre d'une phase (onglet) */
export const phaseNumber = (phase: Phase): number => PHASE_NUMBERS[phase];

export const phaseFromNumber = (n: number | undefined): Phase | undefined =>
  PHASES_BY_NUMBER[n ?? 0];

export interface SessionState {
  currentPhase: number;
  pools: Pool[];
  poolHistory: Pool[][];
  /** Appel figé de chaque tour de poules terminé (#1051) */
  appelHistory?: Fencer[][];
  overallRanking: PoolRanking[];
  tableauMatches: TableauMatch[];
  finalResults: FinalResult[];
  consolationBrackets: ConsolationBracket[];
  currentPoolRound: number;
  skipPoolPhase: boolean;
  /** Poules lancées au moins une fois (#1499) ; absent des anciennes sessions */
  poolsLaunched?: boolean;
  remoteArenaCount?: number;
  /** Tournoi des rapières : composition des équipes et vagues (#1118) */
  rapieres?: RapieresSession | RapieresLegacyState;
  poolPrepParams: {
    poolCount: number;
    minFencersPerPool: number;
    maxFencersPerPool: number;
  };
  uiState: {
    currentPhase: Phase;
    currentPoolRound: number;
    pools: number;
  };
  /** Étapes closes : tableau arrêté à N tireurs (docs/adr/0037), lu seulement */
  stageHistory?: TableauStageRecord[];
  /** Scission faite : branches parties en compétitions filles (docs/adr/0039), lu seulement */
  splitHistory?: SplitHistoryEntry[];
  /** Tableaux séparés après les poules : un tableau par groupe, lu seulement (docs/adr/0024) */
  groupTableaux?: Record<string, GroupTableau>;
  /** Révision de l'état : incrémentée par la couche domaine (MCP, #1880) */
  revision?: number;
  /**
   * État relu après une écriture du moteur (pas le chargement de l'épreuve) : l'onglet
   * affiché n'est pas changé, c'est un état d'interface du poste (docs/adr/0017)
   */
  reloaded?: boolean;
}

interface UseCompetitionSessionProps {
  competitionId: string;
}

/** État lu : projection du moteur et ses révisions */
interface FetchedState {
  state: (Partial<CompetitionStateDTO> & Pick<CompetitionStateDTO, 'currentPoolRound'>) | null;
  sessionRevision: number;
  revision: number;
  /** Poules écrites en base par une version précédente (lecture seule) */
  preparedPools: Pool[];
}

export const useCompetitionSession = (props: UseCompetitionSessionProps) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [restoredState, setRestoredState] = useState<Partial<SessionState> | null>(null);
  // Préparation écrite en base par une version précédente, lue au chargement (getCompetitionState)
  const [preparedPools, setPreparedPools] = useState<Pool[]>([]);
  // Révision du bloc chargé : une relecture sur signal ne l'applique que s'il a changé
  const revisionRef = useRef(0);
  // Révision du journal de l'état chargé (getCompetitionState, docs/adr/0017)
  const journalRevisionRef = useRef(0);
  const reloadInFlightRef = useRef<Promise<void> | null>(null);
  const reloadPendingRef = useRef(0);
  const client = useBpmClient();

  /**
   * État de l'épreuve tenu par le moteur (getCompetitionState, docs/adr/0017) avec sa révision
   * de journal ; null hors moteur (contrat indisponible).
   */
  const fetchState = useCallback(async (): Promise<FetchedState | null> => {
    try {
      const r = await client.query('getCompetitionState', { competitionId: props.competitionId });
      if (r && typeof r === 'object' && typeof r.revision === 'number') {
        return {
          state: r.state,
          sessionRevision: r.sessionRevision,
          revision: r.revision,
          preparedPools: Array.isArray(r.preparedPools) ? r.preparedPools : [],
        };
      }
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code !== 'unavailable' && code !== 'unknown_operation') throw e;
    }
    return null;
  }, [client, props.competitionId]);

  // Restaurer l'état
  // `onlyIfChanged` (relecture sur signal) : l'état n'est appliqué que si le moteur a réécrit le
  // bloc (révision de session changée) ; un pointage avance le journal sans toucher au bloc.
  const restoreState = useCallback(
    async (onlyIfChanged = false) => {
      try {
        const fetched = await fetchState();
        if (fetched) {
          journalRevisionRef.current = Math.max(journalRevisionRef.current, fetched.revision);
          if (onlyIfChanged && fetched.sessionRevision === revisionRef.current) return;
          revisionRef.current = fetched.sessionRevision;
          if (!onlyIfChanged) setPreparedPools(fetched.preparedPools);
        }
        const state = fetched?.state;
        if (state) {
          setRestoredState({
            // Relecture sur signal : l'onglet affiché reste celui du poste (docs/adr/0017)
            reloaded: onlyIfChanged,
            currentPhase: state.currentPhase,
            pools: state.pools || [],
            poolHistory: state.poolHistory || [],
            appelHistory: state.appelHistory || [],
            overallRanking: state.overallRanking || [],
            tableauMatches: state.tableauMatches || [],
            finalResults: state.finalResults || [],
            consolationBrackets: state.consolationBrackets || [],
            currentPoolRound: state.currentPoolRound || 1,
            skipPoolPhase: state.skipPoolPhase ?? false,
            poolsLaunched: state.poolsLaunched,
            remoteArenaCount: state.remoteArenaCount,
            rapieres: state.rapieres,
            stageHistory: state.stageHistory ?? [],
            splitHistory: splitHistoryOf(state.splitHistory),
            ...(state.groupTableaux ? { groupTableaux: state.groupTableaux } : {}),
            poolPrepParams: state.poolPrepParams || {
              poolCount: 0,
              minFencersPerPool: 5,
              maxFencersPerPool: 7,
            },
          });

          logger.debug(LogCategory.UI, 'Session state restored');
        }
      } catch (e) {
        logger.error(LogCategory.UI, 'Failed to restore session state', e as Error);
      } finally {
        setIsLoaded(true);
      }
    },
    [fetchState]
  );

  // Restaurer au chargement
  useEffect(() => {
    restoreState();
  }, [restoreState]);

  /**
   * Relecture coalescée (docs/adr/0017, étape 4a) : une relecture à la fois ; un signal reçu
   * pendant une relecture en déclenche une seule autre. `minRevision` (signal de journal) :
   * rien à faire si l'état lu est déjà à cette révision. L'état relu n'est appliqué que si le
   * moteur a réécrit le bloc ; il fait alors foi.
   */
  const requestReload = useCallback(
    (minRevision?: number) => {
      if (minRevision !== undefined && journalRevisionRef.current >= minRevision) return;
      if (reloadInFlightRef.current) {
        reloadPendingRef.current = Math.max(reloadPendingRef.current, minRevision ?? Infinity);
        return;
      }
      reloadInFlightRef.current = (async () => {
        try {
          do {
            reloadPendingRef.current = 0;
            await restoreState(true);
          } while (
            reloadPendingRef.current > 0 &&
            journalRevisionRef.current < reloadPendingRef.current
          );
        } finally {
          reloadInFlightRef.current = null;
        }
      })();
    },
    [restoreState]
  );

  // Signaux de l'épreuve par le contrat : journal:appended (révision du journal) et
  // session:changed (écritures du moteur pas encore journalisées, jusqu'à l'étape 4b).
  useEffect(() => {
    const competitionId = props.competitionId;
    try {
      return client.subscribe('onCompetitionEvents', { competitionId }, event => {
        if (event.competitionId && event.competitionId !== competitionId) return;
        if (event.type === 'journal:appended') requestReload(event.revision ?? Infinity);
        else if (event.type === 'session:changed') requestReload();
      });
    } catch {
      // Contrat indisponible (hors moteur) : pas de relecture sur signal
      return undefined;
    }
  }, [client, props.competitionId, requestReload]);

  return {
    isLoaded,
    restoredState,
    preparedPools,
    restoreState,
  };
};

export default useCompetitionSession;
