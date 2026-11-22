/**
 * Tests du Mode Club : simule le contrat d'API (docs/adr/0022) à partir de fonctions par
 * méthode de l'écran (`createClubApi`, src/renderer/api/clubApi.ts). Chaque opération du
 * contrat reçoit son entrée nommée et la rend en arguments positionnels à la méthode
 * correspondante : les tests vérifient les appels de l'écran, le contrat lui-même étant
 * couvert par src/main/engine/commands/club.test.ts.
 * Photos ZIP et sauvegardes .bpclub restent sur window.electronAPI.club (ADR-0021).
 * Licensed under GPL-3.0
 */
import type { ApiBridge } from '../../shared/api/client';
import { fakeApiBridge, type ApiHandlers } from './apiBridge';

/** Méthodes de l'écran simulées (vi.fn) : nom → fonction */
export type ClubMocks = Record<string, unknown>;

type Input = Record<string, unknown>;

/** Opérations du contrat → méthode de l'écran et arguments positionnels */
const MAPPING: Record<string, [method: string, args: (i: Input) => unknown[]]> = {
  listClubs: ['listClubs', () => []],
  getClub: ['getClub', i => [i.clubId]],
  createClub: ['createClub', i => [i]],
  updateClubDetails: ['updateClub', i => [i.clubId, i.details]],
  deleteClub: ['deleteClub', i => [i.clubId]],
  getClubMemberByCard: ['findMemberByCardCode', i => [i.code, i.clubId]],
  regenerateClubCardCode: ['regenerateCardCode', i => [i.memberId]],
  listClubMembers: ['listMembers', i => [i.clubId, i.includeInactive]],
  registerClubMember: ['createMember', i => [i.clubId, i.details]],
  updateClubMemberDetails: ['updateMember', i => [i.memberId, i.details]],
  removeClubMember: ['deleteMember', i => [i.memberId]],
  importClubMembers: ['importMembers', i => [i.clubId, i.members]],
  listClubCoaches: ['listCoaches', i => [i.clubId, i.includeInactive]],
  registerClubCoach: ['createCoach', i => [i.clubId, i.details]],
  updateClubCoachDetails: ['updateCoach', i => [i.coachId, i.details]],
  removeClubCoach: ['deleteCoach', i => [i.coachId]],
  listClubSessions: [
    'listSessions',
    ({ clubId, ...range }) => [clubId, Object.keys(range).length ? range : undefined],
  ],
  getClubSession: ['getSession', i => [i.sessionId]],
  planClubSession: ['createSession', i => [i.clubId, i.details]],
  planClubSessionSeries: ['createSeries', i => [i.clubId, i.details, i.recurrence]],
  generateClubSessions: ['generateSessions', i => [i.clubId, i.details, i.schedule]],
  cancelPlannedClubSessions: ['deletePlannedInPeriods', i => [i.clubId, i.periods]],
  updateClubSessionDetails: ['updateSession', i => [i.sessionId, i.details]],
  startClubSession: ['startSession', i => [i.sessionId]],
  closeClubSession: ['closeSession', i => [i.sessionId]],
  reopenClubSession: ['reopenSession', i => [i.sessionId]],
  deleteClubSession: ['deleteSession', i => [i.sessionId]],
  setClubAttendance: ['setAttendance', i => [i.sessionId, i.memberId, i.present]],
  setClubMemberFeedback: ['setMemberFeedback', i => [i.sessionId, i.memberId, i.text]],
  listClubMemberFeedback: ['getMemberFeedback', i => [i.memberId]],
  listClubExercises: ['listExercises', () => []],
  createClubExercise: ['createExercise', i => [i.details]],
  updateClubExerciseDetails: ['updateExercise', i => [i.exerciseId, i.details]],
  deleteClubExercise: ['deleteExercise', i => [i.exerciseId]],
  importClubExercises: ['importExercises', i => [i.exercises]],
  listClubBouts: ['listBouts', i => [i]],
  createClubBout: ['createBout', i => [i]],
  startClubBout: ['startBout', i => [i.boutId]],
  recordClubBoutScore: ['updateBoutScore', i => [i.boutId, i.scoreA, i.scoreB]],
  finishClubBout: ['finishBout', i => [i.boutId, i.result]],
  cancelClubBout: ['cancelBout', i => [i.boutId]],
  deleteClubBout: ['deleteBout', i => [i.boutId]],
  getClubLeaderboard: ['getLeaderboard', i => [i]],
  getClubMemberReport: [
    'getMemberReport',
    ({ memberId, groupBy, ...filter }) => [memberId, filter, groupBy],
  ],
  listClubItems: ['listItems', i => [i.clubId, i.includeRetired]],
  addClubItem: ['createItem', i => [i.clubId, i.details]],
  addClubItemSeries: ['createItemSeries', i => [i.clubId, i.details, i.count]],
  updateClubItemDetails: ['updateItem', i => [i.itemId, i.details]],
  removeClubItem: ['deleteItem', i => [i.itemId]],
  listClubLoans: [
    'listLoans',
    ({ clubId, ...filter }) => [clubId, Object.keys(filter).length ? filter : undefined],
  ],
  lendClubItem: ['lendItem', i => [i]],
  returnClubLoan: [
    'returnLoan',
    ({ loanId, ...data }) => [loanId, Object.keys(data).length ? data : undefined],
  ],
  deleteClubLoan: ['deleteLoan', i => [i.loanId]],
  listClubCategories: ['listCategories', i => [i.clubId]],
  createClubCategory: ['createCategory', i => [i.clubId, i.name]],
  renameClubCategory: ['renameCategory', i => [i.categoryId, i.name]],
  deleteClubCategory: ['deleteCategory', i => [i.categoryId]],
  listClubBrands: ['listBrands', i => [i.clubId]],
  createClubBrand: ['createBrand', i => [i.clubId, i.name]],
  renameClubBrand: ['renameBrand', i => [i.brandId, i.name]],
  deleteClubBrand: ['deleteBrand', i => [i.brandId]],
  getClubInventoryLock: ['getInventoryLock', i => [i.clubId]],
  setClubInventoryLock: ['setInventoryLock', i => [i.clubId, i.locked]],
  importClubItems: ['importItems', i => [i.clubId, i.items]],
  getClubRemoteStatus: ['remoteStatus', () => []],
  sendClubBoutToStrip: ['pushBout', i => [i.boutId]],
  linkClubSessionToStrips: ['linkRemote', i => [i.sessionId]],
  releaseClubBout: ['releaseBout', i => [i.boutId]],
  getClubSyncStatus: ['syncStatus', i => [i.clubId]],
  enableClubSync: ['syncEnable', i => [i.clubId]],
  disableClubSync: ['syncDisable', i => [i.clubId]],
  syncClubNow: ['syncNow', i => [i.clubId]],
  resolveClubSyncConflict: ['syncResolve', i => [i.clubId, i.keep]],
  listClubBackups: ['backupList', i => [i.clubId]],
  createClubBackup: ['backupCreate', i => [i.clubId]],
  restoreClubBackup: ['backupRestore', i => [i.clubId, i.backupId]],
};

/** Retire les `undefined` de queue : `f('c1')` et non `f('c1', undefined)` */
const trimmed = (args: unknown[]): unknown[] => {
  const out = [...args];
  while (out.length && out[out.length - 1] === undefined) out.pop();
  return out;
};

/** Gestionnaires du contrat pour `fakeApiBridge`, à partir des méthodes de l'écran simulées */
export function clubHandlers(mocks: ClubMocks): ApiHandlers {
  const handlers: ApiHandlers = {};
  for (const [op, [method, toArgs]] of Object.entries(MAPPING)) {
    handlers[op] = input => {
      const fn = mocks[method] as ((...args: unknown[]) => unknown) | undefined;
      if (!fn) throw new Error(`Méthode du club non simulée : ${method}`);
      return fn(...trimmed(toArgs(input)));
    };
  }
  return handlers;
}

/**
 * `window.electronAPI` d'un test du Mode Club : pont du contrat + fichiers du club.
 * `extra` ajoute d'autres opérations du contrat ou des groupes de l'API Electron.
 */
export function clubElectron(
  mocks: ClubMocks,
  extra: { api?: ApiHandlers; [group: string]: unknown } = {}
): { api: ApiBridge; club: Record<string, unknown>; [group: string]: unknown } {
  const { api: extraApi, ...rest } = extra;
  return {
    ...rest,
    api: fakeApiBridge({ ...clubHandlers(mocks), ...extraApi }),
    club: {
      importPhotos: mocks.importPhotos,
      exportBackup: mocks.exportBackup,
      importBackup: mocks.importBackup,
    },
  };
}
