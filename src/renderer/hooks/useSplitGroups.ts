/**
 * BPM - Escrime - Compétition couplée : groupes du tableau et séparation en compétition
 * distincte (extrait de CompetitionView, #1599)
 * Tableaux séparés après les poules (docs/adr/0024, lot A2) : un tableau par groupe, tenu par
 * le moteur (state.groupTableaux, getCompetitionState) ; le groupe affiché est une préférence
 * du poste, comme l'onglet. L'écran ne garde aucun tableau en mémoire. Extraction d'un groupe
 * en épreuve séparée : commande splitOffGroup (lot A3) ; l'écran n'écrit rien.
 * Licensed under GPL-3.0
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Competition, PoolRanking } from '../../shared/types';
import { logger, LogCategory } from '@shared/services/logger';
import { ApiError } from '../../shared/api/client';
import { planSplitGroups, type GroupTableau } from '../../shared/domain/ranking/splitGroups';
import { useBpmClient } from '../api/BpmClientContext';
import type {
  ConsolationBracket,
  FinalResult,
  TableauMatch,
} from '../../shared/domain/tableau/tableauTypes';
import { useToast } from '../components/Toast';
import { readPosteUiState, writePosteUiState } from './posteUiState';
import type { Phase, SessionState } from './useCompetitionSession';

type GroupTableaux = Record<string, GroupTableau>;

interface UseSplitGroupsParams {
  competition: Competition;
  onUpdate: (competition: Competition) => void;
  onOpenCompetition?: (competitionId: string) => void;
  setCurrentPhase: Dispatch<SetStateAction<Phase>>;
  overallRanking: PoolRanking[];
  setTableauMatches: Dispatch<SetStateAction<TableauMatch[]>>;
  setConsolationBrackets: Dispatch<SetStateAction<ConsolationBracket[]>>;
  setFinalResults: Dispatch<SetStateAction<FinalResult[]>>;
  activeSplitGroup: string | null;
  setActiveSplitGroup: Dispatch<SetStateAction<string | null>>;
  groupTableaux: GroupTableaux;
  setGroupTableaux: Dispatch<SetStateAction<GroupTableaux>>;
  setPendingSplitOffGroup: Dispatch<SetStateAction<string | null>>;
  splitOffInProgress: boolean;
  setSplitOffInProgress: Dispatch<SetStateAction<boolean>>;
}

/**
 * Onglets des groupes : groupes restants après les poules (classement, groupes extraits
 * écartés) et groupes dont le tableau est tiré, dans l'ordre alphabétique.
 */
export function splitTabGroups(
  ranking: PoolRanking[],
  criteria: string | undefined,
  splitOffIds: Partial<Record<string, string>> | undefined,
  tableaux: GroupTableaux
): string[] {
  if (!criteria) return [];
  const groups = new Set(planSplitGroups(ranking, criteria, splitOffIds).map(g => g.group));
  for (const [g, t] of Object.entries(tableaux)) if (t.tableauMatches.length > 0) groups.add(g);
  return [...groups].sort();
}

/** Groupes disponibles, bascule entre groupes du tableau et extraction d'un groupe. */
export function useSplitGroups({
  competition,
  onUpdate,
  onOpenCompetition,
  setCurrentPhase,
  overallRanking,
  setTableauMatches,
  setConsolationBrackets,
  setFinalResults,
  activeSplitGroup,
  setActiveSplitGroup,
  groupTableaux,
  setGroupTableaux,
  setPendingSplitOffGroup,
  splitOffInProgress,
  setSplitOffInProgress,
}: UseSplitGroupsParams) {
  const { showToast } = useToast();
  const client = useBpmClient();
  const postPoolSplitCriteria = competition.settings?.postPoolSplitCriteria;
  const splitOffCompetitionIds = competition.settings?.splitOffCompetitionIds;
  // Lus par les rappels stables (relecture de l'état, changement d'onglet)
  const tableauxRef = useRef(groupTableaux);
  const activeRef = useRef(activeSplitGroup);
  useLayoutEffect(() => {
    tableauxRef.current = groupTableaux;
    activeRef.current = activeSplitGroup;
  }, [groupTableaux, activeSplitGroup]);

  // Groupes disponibles pour la séparation (onglets du tableau)
  const splitGroups = useMemo(
    () =>
      splitTabGroups(overallRanking, postPoolSplitCriteria, splitOffCompetitionIds, groupTableaux),
    [postPoolSplitCriteria, overallRanking, splitOffCompetitionIds, groupTableaux]
  );

  /** Groupe affiché et son tableau, lu dans l'état du moteur (aucune copie locale) */
  const showSplitGroup = useCallback(
    (group: string | null, tableaux: GroupTableaux = tableauxRef.current) => {
      activeRef.current = group;
      setActiveSplitGroup(group);
      const t = group ? tableaux[group] : undefined;
      setTableauMatches(t?.tableauMatches ?? []);
      setConsolationBrackets(t?.consolationBrackets ?? []);
      setFinalResults(t?.finalResults ?? []);
    },
    [setActiveSplitGroup, setTableauMatches, setConsolationBrackets, setFinalResults]
  );

  /**
   * État relu (chargement, signal du journal) : tableaux des groupes rangés, groupe affiché
   * gardé s'il existe encore, sinon celui du poste, sinon le premier.
   */
  const applyGroupTableaux = useCallback(
    (state: Partial<SessionState>) => {
      const tableaux = state.groupTableaux ?? {};
      tableauxRef.current = tableaux;
      setGroupTableaux(tableaux);
      const groups = splitTabGroups(
        state.overallRanking ?? [],
        postPoolSplitCriteria,
        splitOffCompetitionIds,
        tableaux
      );
      const preferred = activeRef.current ?? readPosteUiState(competition.id).splitGroup;
      const group = preferred && groups.includes(preferred) ? preferred : (groups[0] ?? null);
      showSplitGroup(group, tableaux);
    },
    [
      competition.id,
      postPoolSplitCriteria,
      splitOffCompetitionIds,
      setGroupTableaux,
      showSplitGroup,
    ]
  );

  // Groupes apparus après le chargement (classement après poules) ou groupe extrait : un
  // groupe est toujours affiché, sinon le tableau tirerait tous les tireurs ensemble
  useEffect(() => {
    if (!postPoolSplitCriteria || splitGroups.length === 0) return;
    if (activeSplitGroup && splitGroups.includes(activeSplitGroup)) return;
    const preferred = readPosteUiState(competition.id).splitGroup;
    showSplitGroup(preferred && splitGroups.includes(preferred) ? preferred : splitGroups[0]);
  }, [postPoolSplitCriteria, splitGroups, activeSplitGroup, competition.id, showSplitGroup]);

  // Groupe affiché : préférence du poste, comme l'onglet (docs/adr/0017 §4)
  useEffect(() => {
    if (activeSplitGroup) writePosteUiState(competition.id, { splitGroup: activeSplitGroup });
  }, [competition.id, activeSplitGroup]);

  // Basculer vers un autre groupe dans un tableau déjà ouvert
  const handleSwitchSplitGroup = (newGroup: string) => {
    if (newGroup === activeSplitGroup) return;
    showSplitGroup(newGroup);
    // Revenir au tableau si le groupe choisi n'a pas de résultats
    if (!groupTableaux[newGroup]?.finalResults.length) setCurrentPhase('tableau');
  };

  const handleSplitOff = (group: string) => {
    const existingId = splitOffCompetitionIds?.[group];
    if (existingId) {
      onOpenCompetition?.(existingId);
      return;
    }
    setPendingSplitOffGroup(group);
  };

  const createSplitOffCompetition = async (group: string, title: string) => {
    if (splitOffInProgress) return;
    setSplitOffInProgress(true);
    try {
      // Épreuve séparée créée par le moteur, en une transaction (docs/adr/0024, lot A3)
      const created = await client.call('splitOffGroup', {
        competitionId: competition.id,
        group,
        title,
      });
      const targetId = created.competitionId!;
      const settings = {
        ...competition.settings,
        splitOffCompetitionIds: { ...splitOffCompetitionIds, [group]: targetId },
      };
      onUpdate({ ...competition, settings } as Competition);
      if (activeSplitGroup === group) setActiveSplitGroup(null);
      setPendingSplitOffGroup(null);
      showToast(`Compétition « ${title.trim()} » créée (${created.fencers} tireurs)`, 'success');
      onOpenCompetition?.(targetId);
    } catch (e) {
      logger.error(
        LogCategory.DATABASE,
        'Split-off competition creation failed',
        e instanceof Error ? e : undefined
      );
      showToast(
        e instanceof ApiError ? e.message : 'Erreur lors de la création de la compétition séparée',
        'error'
      );
    } finally {
      setSplitOffInProgress(false);
    }
  };

  return {
    splitGroups,
    showSplitGroup,
    applyGroupTableaux,
    handleSwitchSplitGroup,
    handleSplitOff,
    createSplitOffCompetition,
  };
}
