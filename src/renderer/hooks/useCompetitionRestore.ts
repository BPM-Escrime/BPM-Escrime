/**
 * BPM - Escrime - Restauration de l'état de la compétition à l'écran (extrait de
 * CompetitionView, #1599). L'état de l'épreuve est écrit par le moteur seul (docs/adr/0017,
 * 0024) ; l'écran le relit et garde l'état de son poste (posteUiState).
 * Licensed under GPL-3.0
 */
import { useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Pool, PoolRanking } from '../../shared/types';
import type {
  ConsolationBracket,
  FinalResult,
  TableauMatch,
} from '../../shared/domain/tableau/tableauTypes';
import type { SplitHistoryEntry } from '../../shared/domain/formula/splitPlan';
import type { TableauStageRecord } from '../../shared/domain/tableau/tableauStage';
import { inferPoolsLaunched } from '../components/poolLaunchState';
import type { useWavesSessionState } from '../../features/poolWaves/useWavesSessionState';
import { useCompetitionSession, phaseFromNumber, phaseNumber } from './useCompetitionSession';
import { readPoolDraft, readPosteUiState, tabToRestore, writePosteUiState } from './posteUiState';
import type { Phase, SessionState } from './useCompetitionSession';
import type { usePoolManagement } from './usePoolManagement';

type Setter<T> = Dispatch<SetStateAction<T>>;
type PoolManagement = ReturnType<typeof usePoolManagement>;

interface UseCompetitionRestoreParams {
  competitionId: string;
  /**
   * Tableaux séparés après les poules (docs/adr/0024) : l'état relu range un tableau par
   * groupe ; l'écran affiche celui du groupe choisi (useSplitGroups), pas la racine
   */
  onGroupTableaux?: (state: Partial<SessionState>) => void;
  currentPhase: Phase;
  setCurrentPhase: Setter<Phase>;
  setCurrentPoolRound: PoolManagement['setCurrentPoolRound'];
  pools: Pool[];
  setPools: Setter<Pool[]>;
  setPoolHistory: PoolManagement['setPoolHistory'];
  setAppelHistory: PoolManagement['setAppelHistory'];
  setOverallRanking: Setter<PoolRanking[]>;
  setTableauMatches: Setter<TableauMatch[]>;
  setFinalResults: Setter<FinalResult[]>;
  setConsolationBrackets: Setter<ConsolationBracket[]>;
  setSkipPoolPhase: Setter<boolean>;
  setRankingValidated: Setter<boolean>;
  remoteArenaCount: number;
  setRemoteArenaCount: Setter<number>;
  /** Piste de départ du plan des pistes, lue par le contrat (docs/adr/0015) */
  remoteStripStart: number;
  setRapieresState: ReturnType<typeof useWavesSessionState>['setRapieresState'];
  setWavesState: ReturnType<typeof useWavesSessionState>['setWavesState'];
  minFencersPerPool: number;
  maxFencersPerPool: number;
  setMinFencersPerPool: Setter<number>;
  setMaxFencersPerPool: Setter<number>;
  setPoolsLaunched: Setter<boolean>;
  /** Étapes closes (tableau arrêté, docs/adr/0037) */
  setStageHistory?: Setter<TableauStageRecord[]>;
  /** Scission faite (docs/adr/0039) */
  setSplitHistory?: Setter<SplitHistoryEntry[]>;
}

/** Relit l'état de l'épreuve (phase, poules, tableau…) et l'applique à l'écran. */
export function useCompetitionRestore({
  competitionId,
  onGroupTableaux,
  currentPhase,
  setCurrentPhase,
  setCurrentPoolRound,
  pools,
  setPools,
  setPoolHistory,
  setAppelHistory,
  setOverallRanking,
  setTableauMatches,
  setFinalResults,
  setConsolationBrackets,
  setSkipPoolPhase,
  setRankingValidated,
  remoteArenaCount,
  setRemoteArenaCount,
  remoteStripStart,
  setRapieresState,
  setWavesState,
  minFencersPerPool,
  maxFencersPerPool,
  setMinFencersPerPool,
  setMaxFencersPerPool,
  setPoolsLaunched,
  setStageHistory,
  setSplitHistory,
}: UseCompetitionRestoreParams) {
  // État de l'épreuve relu (getCompetitionState), écrit par le moteur seul
  const { isLoaded, restoredState, preparedPools } = useCompetitionSession({ competitionId });

  // Synchroniser le nombre d'arènes avec le nombre de poules.
  // Ne se déclenche que lorsque le nombre de poules change : un nombre de pistes choisi par
  // l'organisateur (ex. piste 10 à 20 pour 9 poules) n'est plus réécrasé (#1653).
  const prevPoolsLengthRef = useRef(0);
  useEffect(() => {
    if (!isLoaded) return;
    const prevLength = prevPoolsLengthRef.current;
    prevPoolsLengthRef.current = pools.length;
    if (pools.length === 0 || pools.length === prevLength) return;
    const maxStrip = remoteStripStart + pools.length - 1;
    if (!restoredState?.remoteArenaCount) {
      setRemoteArenaCount(maxStrip);
    } else if (prevLength > 0) {
      // Les poules ont rétréci pendant la session : clamp pour éviter des arènes fantômes.
      setRemoteArenaCount(count => (count > maxStrip ? maxStrip : count));
    }
  }, [isLoaded, pools.length, remoteStripStart]);

  // Réglages du poste (onglet, préparation, pistes) appliqués une fois par montage : un second
  // chargement complet (effets rejoués, chargements concurrents) relirait l'état du poste déjà
  // réécrit avec les valeurs d'avant la restauration et ramènerait l'écran à l'appel
  const posteAppliedRef = useRef(false);
  useEffect(() => {
    if (restoredState && isLoaded) {
      const restoredPhase = phaseFromNumber(restoredState.currentPhase);
      const firstLoad = !restoredState.reloaded && !posteAppliedRef.current;
      if (firstLoad) posteAppliedRef.current = true;
      // Onglet : seulement au chargement, celui du poste s'il ne devance pas la phase de
      // l'épreuve ; une relecture après une commande garde l'onglet affiché (docs/adr/0017)
      const poste = readPosteUiState(competitionId);
      if (firstLoad) {
        const tab = tabToRestore(poste.tab, restoredPhase, phaseNumber);
        if (tab) setCurrentPhase(tab);
      }
      if (
        ['tableau', 'results', 'remote', 'ranking'].includes(restoredPhase ?? '') ||
        (restoredState.tableauMatches && restoredState.tableauMatches.length > 0) ||
        Object.values(restoredState.groupTableaux ?? {}).some(g => g.tableauMatches.length > 0)
      ) {
        setRankingValidated(true);
      }
      if (restoredState.currentPoolRound) setCurrentPoolRound(restoredState.currentPoolRound);
      if (restoredState.pools) setPools(restoredState.pools);
      if (restoredState.poolHistory) setPoolHistory(restoredState.poolHistory || []);
      if (restoredState.appelHistory) setAppelHistory(restoredState.appelHistory);
      if (restoredState.overallRanking) setOverallRanking(restoredState.overallRanking);
      if (onGroupTableaux) onGroupTableaux(restoredState);
      else {
        if (restoredState.tableauMatches) setTableauMatches(restoredState.tableauMatches);
        if (restoredState.finalResults) setFinalResults(restoredState.finalResults);
        if (restoredState.consolationBrackets?.length)
          setConsolationBrackets(restoredState.consolationBrackets);
      }
      // Préparation des poules et pistes : réglages du poste d'abord (docs/adr/0017)
      if (firstLoad) {
        const min = poste.minFencersPerPool ?? restoredState.poolPrepParams?.minFencersPerPool;
        const max = poste.maxFencersPerPool ?? restoredState.poolPrepParams?.maxFencersPerPool;
        if (min !== undefined) setMinFencersPerPool(min);
        if (max !== undefined) setMaxFencersPerPool(max);
      }
      if (restoredState.skipPoolPhase) setSkipPoolPhase(restoredState.skipPoolPhase);
      setPoolsLaunched(
        restoredState.poolsLaunched ??
          inferPoolsLaunched(restoredPhase, restoredState.pools, restoredState.poolHistory)
      );
      if (firstLoad) {
        const arenas = poste.remoteArenaCount ?? restoredState.remoteArenaCount;
        if (arenas != null) setRemoteArenaCount(arenas);
      }
      if (restoredState.rapieres) setRapieresState(restoredState.rapieres);
      setWavesState(restoredState.waves);
      setStageHistory?.(restoredState.stageHistory ?? []);
      setSplitHistory?.(restoredState.splitHistory ?? []);
    }
  }, [restoredState, isLoaded]);

  // État d'interface du poste gardé dans le navigateur à chaque changement (docs/adr/0017)
  useEffect(() => {
    if (!isLoaded) return;
    writePosteUiState(competitionId, {
      tab: currentPhase,
      minFencersPerPool,
      maxFencersPerPool,
      remoteArenaCount,
    });
  }, [
    isLoaded,
    competitionId,
    currentPhase,
    minFencersPerPool,
    maxFencersPerPool,
    remoteArenaCount,
  ]);

  // Préparation non lancée : tirage du poste (posteUiState), sinon celui qu'une version
  // précédente écrivait en base (lecture seule : preparedPools de getCompetitionState).
  // Guard : pas si l'état relu a déjà des poules (appliquées par l'effet
  // [restoredState, isLoaded] dans le même cycle de rendu).
  useEffect(() => {
    if (!isLoaded || pools.length > 0) return;
    if (restoredState?.pools && restoredState.pools.length > 0) return;
    const draft = readPoolDraft<Pool>(competitionId);
    if (draft) {
      setPools(draft);
      return;
    }
    if (preparedPools.length > 0) setPools(preparedPools);
  }, [isLoaded, pools.length, competitionId, restoredState, preparedPools]);

  return { isLoaded, restoredState };
}
