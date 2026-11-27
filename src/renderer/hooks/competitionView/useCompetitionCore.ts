/**
 * BPM - Escrime - État de base de la compétition : réglages, tireurs, poules, vue des poules
 * Licensed under GPL-3.0
 */

import { useStateGroup } from '../useStateGroup';
import {
  CV_REMOTE_INIT,
  CV_PLANNING_INIT,
  CV_SPLIT_INIT,
  CV_DATA_INIT,
} from '../../components/competition/competitionViewState';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { phaseSettings } from '../../../shared/domain/formula/formulaV2';
import type { SplitHistoryEntry } from '../../../shared/domain/formula/splitPlan';
import { formulaSegment } from '../../../shared/domain/formula/formulaSteps';
import {
  seedRankingForNextRound,
  type TableauStageRecord,
} from '../../../shared/domain/tableau/tableauStage';
import { getDefaultMaxScores } from '../../../shared/utils/defaultMaxScores';
import { Fencer, FencerStatus, Weapon } from '../../../shared/types';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { useTranslation } from '../useTranslation';
import { Phase } from '../useCompetitionSession';
import { useFencerManagement } from '../useFencerManagement';
import { usePoolManagement } from '../usePoolManagement';
import { useExport } from '../useExport';
import { useStripPlan } from '../useStripAvailability';
import { useCompetitionImport } from '../useCompetitionImport';
import { usePoolsWindowSize } from '../usePoolsWindowSize';
import { seedFencersFromRanking } from '../../../shared/utils/poolRounds';
import {
  getActiveFormula,
  isRapieresMode,
  resolveCompetitionSettings,
} from '../../../shared/utils/customFormulaSettings';
import { allowsVictoryTieBreak } from '../../../shared/utils/tieBreak';
import { useRapieresSessionState } from '../../../features/rapieres/useRapieresSessionState';
import { useColumnVisibility } from '../useColumnVisibility';
import { useModalFlags } from '../useModalFlags';
import { usePoolsViewSettings } from '../usePoolsViewSettings';
import { MODAL_FLAGS } from '../../components/competition/modalFlags';
import type { CompetitionViewProps } from '../../components/competition/competitionViewTypes';

type Ctx = CompetitionViewProps;

/** État de base de la compétition : réglages, tireurs, poules, vue des poules (extrait de CompetitionView, #1599) */
export function useCompetitionCore(ctx: Ctx) {
  const { competition, requestPhase, onPhaseApplied, onRemoteServerChange, onUpdate } = ctx;

  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const { t, language } = useTranslation();

  // Settings avec valeurs par défaut (formule personnalisée prioritaire, #1125)
  const customFormula = getActiveFormula(competition.weapon, competition.settings);
  const effectiveSettings = resolveCompetitionSettings(competition.weapon, competition.settings);
  // Tableau arrêté à N tireurs (ADR-0037, D2) : tours et tableau de la partie en cours
  const [stageHistory, setStageHistory] = useState<TableauStageRecord[]>([]);
  // Scission faite (docs/adr/0039) : branches parties en compétitions filles
  const [splitHistory, setSplitHistory] = useState<SplitHistoryEntry[]>([]);
  const segment = competition.settings?.formula
    ? formulaSegment(competition.settings.formula, stageHistory.length)
    : null;
  const poolRounds = segment?.poolRounds ?? effectiveSettings?.poolRounds ?? 1;
  const poolRoundQualifiers = competition.settings?.poolRoundQualifiers;
  const hasDirectElimination =
    segment?.hasDirectElimination ?? effectiveSettings?.hasDirectElimination ?? true;
  const tableauStopAt = segment?.stopAt;
  const thirdPlaceMatch = effectiveSettings?.thirdPlaceMatch ?? false;
  const playAllPositions = competition.settings?.playAllPositions ?? false;
  const defaultScores = getDefaultMaxScores(competition.weapon, competition.category);
  // Score max des poules par tour (ADR-0036) : formule enregistrée, sinon réglage commun
  const storedFormula = competition.settings?.formula;
  const flatPoolMaxScore = effectiveSettings?.defaultPoolMaxScore ?? defaultScores.pool;
  const poolMaxScoreFor = useCallback(
    (round: number) =>
      storedFormula?.phases.some(p => p.kind === 'pool')
        ? phaseSettings(storedFormula, { kind: 'pool', round: round - 1 }).maxScore
        : flatPoolMaxScore,
    [storedFormula, flatPoolMaxScore]
  );
  const tableMaxScore = effectiveSettings?.defaultTableMaxScore ?? defaultScores.table;
  const isLaserSabre = competition.weapon === Weapon.LASER;
  const expertMode = competition.settings?.expertMode ?? true; // actif par défaut (#1501)
  // Arbitres simultanés par poule (principal + assistant/vidéo) : mode expert uniquement
  const maxRefereesPerPool = expertMode
    ? Math.max(1, competition.settings?.maxRefereesPerPool ?? 1)
    : 1;
  const maxRefereesPerMatch = expertMode
    ? Math.max(1, competition.settings?.maxRefereesPerMatch ?? 1)
    : 1;
  const poolWinnersOnly = effectiveSettings?.poolWinnersOnly ?? false;
  // Tournoi des rapières (#1118) : équipes = tireurs, poules en vagues
  const isRapieres = isRapieresMode(competition.weapon, competition.settings);
  /** Égalité tranchée par un vainqueur désigné (#1442) */
  const tieBreakByVictory = allowsVictoryTieBreak(competition.weapon, isRapieres);
  const postPoolSplitCriteria = competition.settings?.postPoolSplitCriteria;
  // Groupes déjà extraits dans une compétition séparée (genre → id compétition)
  const splitOffCompetitionIds = competition.settings?.splitOffCompetitionIds;

  const auditLogEnabled = localStorage.getItem('bellepoule-audit-log-enabled') !== 'false';
  const { getVisibleColumns } = useColumnVisibility();

  // États locaux
  const [currentPhase, setCurrentPhase] = useState<Phase>('checkin');

  useEffect(() => {
    if (requestPhase) {
      setCurrentPhase(requestPhase as Phase);
      onPhaseApplied?.();
    }
  }, [requestPhase]);

  // Modales / menus : un seul état (#1241)
  const modals = useModalFlags(MODAL_FLAGS);
  const { setShowConfetti, setShowActionsMenu } = modals;
  const {
    isRemoteActive,
    setIsRemoteActive,
    remoteServerUrl,
    setRemoteServerUrl,
    remoteArenaCount,
    setRemoteArenaCount,
  } = useStateGroup(CV_REMOTE_INIT);
  // Plan des pistes : donnée du moteur (docs/adr/0015), relue par le contrat
  const { start: remoteStripStart, setStart: setRemoteStripStart } = useStripPlan(competition.id);
  useEffect(() => {
    onRemoteServerChange?.(remoteServerUrl, remoteArenaCount);
  }, [remoteServerUrl, remoteArenaCount]);
  const {
    arenaStates,
    setArenaStates,
    tableauMatches,
    setTableauMatches,
    consolationBrackets,
    setConsolationBrackets,
    finalResults,
    setFinalResults,
    appelFencers,
    setAppelFencers,
    appelVisibleColumns,
    setAppelVisibleColumns,
    tableauEditUnlocked,
    setTableauEditUnlocked,
    referees,
    setReferees,
  } = useStateGroup(CV_DATA_INIT);
  const handleAppelStateChange = useCallback((f: Fencer[], cols: string[]) => {
    setAppelFencers(f);
    setAppelVisibleColumns(cols);
  }, []);

  // Tournoi des rapières : état de session et fenêtre d'équipe (#1241)
  const {
    rapieresState,
    setRapieresState,
    rapieresTeamModal,
    setRapieresTeamModal,
    rapieres,
    updateRapieres,
    setRapieresTeam,
  } = useRapieresSessionState();
  // Préparation des poules et classement (#1241)
  const {
    minFencersPerPool,
    setMinFencersPerPool,
    maxFencersPerPool,
    setMaxFencersPerPool,
    rankingChanged,
    setRankingChanged,
    rankingValidated,
    setRankingValidated,
    skipPoolPhase,
    setSkipPoolPhase,
  } = useStateGroup({
    ...CV_PLANNING_INIT,
    // Taille de poule cible portée par la formule (#2013) ; l'écran de préparation garde la main
    minFencersPerPool: competition.settings?.poolSizeMin ?? CV_PLANNING_INIT.minFencersPerPool,
    maxFencersPerPool: competition.settings?.poolSizeMax ?? CV_PLANNING_INIT.maxFencersPerPool,
  });

  // Compétition couplée (#1241)
  const {
    activeSplitGroup,
    setActiveSplitGroup,
    pendingSplitOffGroup,
    setPendingSplitOffGroup,
    splitOffInProgress,
    setSplitOffInProgress,
    groupTableaux,
    setGroupTableaux,
  } = useStateGroup(CV_SPLIT_INIT);

  // Hooks personnalisés
  const {
    fencers,
    loadFencers,
    addFencer,
    bulkAddFencers,
    updateFencer,
    updateFencers,
    deleteFencer,
    deleteAllFencers,
    toggleCheckIn,
    checkInAll,
    uncheckAll,
    computeCategories,
    getCheckedInFencers,
  } = useFencerManagement({ competition, onUpdate });

  const {
    importData,
    setImportData,
    handleImportFencers,
    handleOpenImportDialog,
    handleImportRanking,
    handleImportReferees,
  } = useCompetitionImport({ competition, onUpdate, bulkAddFencers, referees, setReferees });

  const {
    pools,
    setPools,
    poolHistory,
    setPoolHistory,
    appelHistory,
    setAppelHistory,
    currentPoolRound,
    setCurrentPoolRound,
    overallRanking,
    setOverallRanking,
    generatePools: generatePoolsHook,
    updateScore,
    resetMatch,
    cancelMatch,
    nextPoolRound,
    computePoolRanking,
    computeOverallRanking,
    areAllPoolsComplete,
    handleFencerForfeit,
    syncFencersToPool,
  } = usePoolManagement({ isLaserSabre, poolMaxScoreFor, showToast });
  const poolMaxScore = poolMaxScoreFor(currentPoolRound);

  // Formule modifiée, ou tour suivant : la taille de poule cible du tour remplace la valeur de
  // préparation (formule enregistrée : taille du tour, ADR-0036 ; sinon réglage commun)
  const roundPool = storedFormula?.phases.some(p => p.kind === 'pool')
    ? phaseSettings(storedFormula, { kind: 'pool', round: currentPoolRound - 1 })
    : undefined;
  const targetMin = roundPool?.sizeMin ?? competition.settings?.poolSizeMin;
  const targetMax = roundPool?.sizeMax ?? competition.settings?.poolSizeMax;
  const formulaPoolSize = `${targetMin ?? ''}-${targetMax ?? ''}`;
  const formulaPoolSizeRef = useRef(formulaPoolSize);
  useEffect(() => {
    if (formulaPoolSizeRef.current === formulaPoolSize) return;
    formulaPoolSizeRef.current = formulaPoolSize;
    if (targetMin) setMinFencersPerPool(targetMin);
    if (targetMax) setMaxFencersPerPool(targetMax);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- formulaPoolSize résume la taille cible du tour : suit la formule et le tour, pas la préparation
  }, [formulaPoolSize]);

  // Affichage des poules : grille (toutes les poules) ou poule unique avec navigation
  const {
    poolCardSize,
    setPoolCardSize,
    poolsViewMode,
    setPoolsViewMode,
    singlePoolIndex,
    setSinglePoolIndex,
  } = usePoolsViewSettings(pools.length);

  // Tours de poules (#1051) : seed du tirage = classement du tour précédent
  // Premier tour après un tableau arrêté clos : restants par rang d'entrée au tableau (Q5,
  // ADR-0037), comme le moteur (closeTableauStage)
  const storedFormulaForSeed = competition.settings?.formula;
  const previousRoundRanking = useMemo(() => {
    if (currentPoolRound <= 1 || poolHistory.length === 0) return null;
    return seedRankingForNextRound({
      formula: storedFormulaForSeed,
      history: poolHistory,
      stages: stageHistory,
      isLaserSabre,
    });
  }, [currentPoolRound, poolHistory, isLaserSabre, storedFormulaForSeed, stageHistory]);
  const getSeededCheckedInFencers = useCallback(() => {
    const checkedIn = getCheckedInFencers();
    return previousRoundRanking
      ? seedFencersFromRanking(checkedIn, previousRoundRanking)
      : checkedIn;
  }, [getCheckedInFencers, previousRoundRanking]);
  // Tour consulté (null = tour courant)
  const [viewedPoolRound, setViewedPoolRound] = useState<number | null>(null);
  const [showRapieresTableauDialog, setShowRapieresTableauDialog] = useState(false);
  // Appel du tour courant : éliminés des tours précédents retirés (#1051)
  const currentAppelFencers = useMemo(
    () =>
      currentPoolRound > 1 ? fencers.filter(f => f.status !== FencerStatus.ELIMINATED) : fencers,
    [fencers, currentPoolRound]
  );
  // Appel figé d'un tour terminé consulté
  const viewedRoundAppel =
    viewedPoolRound !== null && viewedPoolRound < currentPoolRound
      ? (appelHistory[viewedPoolRound - 1] ?? null)
      : null;
  const viewedRoundPools =
    viewedPoolRound !== null && viewedPoolRound < currentPoolRound
      ? (poolHistory[viewedPoolRound - 1] ?? null)
      : null;

  // Ajuste la taille de la fenêtre à l'entrée en vue "poule unique" (colonnes choisies
  // + nb de tireurs de la poule affichée) pour éviter les ascenseurs. Ne se redéclenche
  // pas à chaque changement de poule : naviguer d'une poule à l'autre ne doit pas
  // réinitialiser la taille de fenêtre choisie par l'utilisateur (cf. bug dimension reset).
  const poolsRef = useRef(pools);
  poolsRef.current = pools;
  const handleFencerForfeitRef = useRef(handleFencerForfeit);
  handleFencerForfeitRef.current = handleFencerForfeit;

  usePoolsWindowSize({
    poolsViewMode,
    currentPhase,
    pools,
    singlePoolIndex,
    getVisibleColumns,
    isLaserSabre,
  });

  const exports = useExport({
    competition,
    showToast,
    tableauMatches,
    fencers,
    referees,
  });
  const { exportPoolsPDF, printPoolsPDF, exportResultsXML } = exports;

  return {
    confirm,
    showToast,
    t,
    language,
    customFormula,
    effectiveSettings,
    poolRounds,
    poolRoundQualifiers,
    hasDirectElimination,
    stageHistory,
    setStageHistory,
    splitHistory,
    setSplitHistory,
    tableauStopAt,
    thirdPlaceMatch,
    playAllPositions,
    poolMaxScore,
    tableMaxScore,
    isLaserSabre,
    expertMode,
    maxRefereesPerPool,
    maxRefereesPerMatch,
    poolWinnersOnly,
    isRapieres,
    tieBreakByVictory,
    postPoolSplitCriteria,
    splitOffCompetitionIds,
    auditLogEnabled,
    currentPhase,
    setCurrentPhase,
    modals,
    setShowConfetti,
    setShowActionsMenu,
    isRemoteActive,
    setIsRemoteActive,
    remoteServerUrl,
    setRemoteServerUrl,
    remoteArenaCount,
    setRemoteArenaCount,
    remoteStripStart,
    setRemoteStripStart,
    arenaStates,
    setArenaStates,
    tableauMatches,
    setTableauMatches,
    consolationBrackets,
    setConsolationBrackets,
    finalResults,
    setFinalResults,
    appelFencers,
    appelVisibleColumns,
    tableauEditUnlocked,
    setTableauEditUnlocked,
    referees,
    setReferees,
    handleAppelStateChange,
    rapieresState,
    setRapieresState,
    rapieresTeamModal,
    setRapieresTeamModal,
    rapieres,
    updateRapieres,
    setRapieresTeam,
    minFencersPerPool,
    setMinFencersPerPool,
    maxFencersPerPool,
    setMaxFencersPerPool,
    rankingChanged,
    setRankingChanged,
    rankingValidated,
    setRankingValidated,
    skipPoolPhase,
    setSkipPoolPhase,
    activeSplitGroup,
    setActiveSplitGroup,
    pendingSplitOffGroup,
    setPendingSplitOffGroup,
    splitOffInProgress,
    setSplitOffInProgress,
    groupTableaux,
    setGroupTableaux,
    fencers,
    loadFencers,
    addFencer,
    bulkAddFencers,
    updateFencer,
    updateFencers,
    deleteFencer,
    deleteAllFencers,
    toggleCheckIn,
    checkInAll,
    uncheckAll,
    computeCategories,
    getCheckedInFencers,
    importData,
    setImportData,
    handleImportFencers,
    handleOpenImportDialog,
    handleImportRanking,
    handleImportReferees,
    pools,
    setPools,
    poolHistory,
    setPoolHistory,
    appelHistory,
    setAppelHistory,
    currentPoolRound,
    setCurrentPoolRound,
    overallRanking,
    setOverallRanking,
    generatePoolsHook,
    updateScore,
    resetMatch,
    cancelMatch,
    nextPoolRound,
    computePoolRanking,
    computeOverallRanking,
    areAllPoolsComplete,
    handleFencerForfeit,
    syncFencersToPool,
    poolCardSize,
    setPoolCardSize,
    poolsViewMode,
    setPoolsViewMode,
    singlePoolIndex,
    setSinglePoolIndex,
    getSeededCheckedInFencers,
    viewedPoolRound,
    setViewedPoolRound,
    showRapieresTableauDialog,
    setShowRapieresTableauDialog,
    currentAppelFencers,
    viewedRoundAppel,
    viewedRoundPools,
    poolsRef,
    handleFencerForfeitRef,
    exports,
    exportPoolsPDF,
    printPoolsPDF,
    exportResultsXML,
  };
}
