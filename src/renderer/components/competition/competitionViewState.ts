/**
 * BPM - Escrime - États initiaux regroupés de CompetitionView (#1241)
 * Licensed under GPL-3.0
 */
import {
  DEFAULT_POOL_SIZE_MAX,
  DEFAULT_POOL_SIZE_MIN,
} from '../../../shared/domain/formula/formulaDraft';
import type { Arena } from '../../../shared/types/remote';
import type { Fencer, Referee } from '../../../shared/types';
import type {
  ConsolationBracket,
  FinalResult,
  TableauMatch,
} from '../../../shared/domain/tableau/tableauTypes';
import type { GroupTableau } from '../../../shared/domain/ranking/splitGroups';

export const CV_REMOTE_INIT = {
  isRemoteActive: false,
  remoteServerUrl: null as string | null,
  remoteArenaCount: 1,
};

export const CV_PLANNING_INIT = {
  minFencersPerPool: DEFAULT_POOL_SIZE_MIN,
  maxFencersPerPool: DEFAULT_POOL_SIZE_MAX,
  rankingChanged: false,
  rankingValidated: false,
  skipPoolPhase: false,
};

export const CV_SPLIT_INIT = {
  activeSplitGroup: null as string | null,
  pendingSplitOffGroup: null as string | null,
  splitOffInProgress: false,
  /** Tableaux des groupes lus dans l'état du moteur (docs/adr/0024) */
  groupTableaux: {} as Record<string, GroupTableau>,
};

export const CV_DATA_INIT = {
  arenaStates: [] as Arena[],
  tableauMatches: [] as TableauMatch[],
  consolationBrackets: [] as ConsolationBracket[],
  finalResults: [] as FinalResult[],
  appelFencers: [] as Fencer[],
  appelVisibleColumns: [] as string[],
  tableauEditUnlocked: false,
  referees: [] as Referee[],
};
