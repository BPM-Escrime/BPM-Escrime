/**
 * BellePoule Modern - Mode Club : appels de l'écran au contrat d'API (#1981 lot 2, docs/adr/0022)
 * Un seul endroit traduit les appels de l'écran (arguments positionnels) en opérations du
 * contrat (entrées nommées, shared/api/contractClub.ts). Hors Electron, le client lève
 * ApiError('unavailable'). Photos ZIP et sauvegardes .bpclub (chemins de fichiers, ADR-0021)
 * restent dans window.electronAPI.club.
 * Licensed under GPL-3.0
 */
import { useMemo } from 'react';
import type { BpmClient } from '../../shared/api/client';
import type {
  ClubBoutFilter,
  ClubBoutInput,
  ClubBoutResult,
  ClubCoachInput,
  ClubDateRange,
  ClubExerciseInput,
  ClubItemInput,
  ClubLoanFilter,
  ClubLoanInput,
  ClubLoanReturn,
  ClubMemberInput,
  ClubPeriodKind,
  ClubRecurrence,
  ClubScheduleOptions,
  ClubSessionInput,
  ClubUpdate,
} from '../../shared/types/club';
import { useBpmClient } from './BpmClientContext';

export function createClubApi(client: BpmClient) {
  const q = client.query.bind(client);
  const c = client.call.bind(client);
  return {
    // Clubs
    listClubs: () => q('listClubs', {}),
    getClub: (clubId: string) => q('getClub', { clubId }),
    createClub: (data: { name: string; stripCount?: number }) => c('createClub', data),
    updateClub: (clubId: string, details: ClubUpdate) =>
      c('updateClubDetails', { clubId, details }),
    deleteClub: (clubId: string) => c('deleteClub', { clubId }),
    // Cartes
    findMemberByCardCode: (code: string, clubId?: string) =>
      q('getClubMemberByCard', { code, clubId }),
    regenerateCardCode: (memberId: string) => c('regenerateClubCardCode', { memberId }),
    // Membres
    listMembers: (clubId: string, includeInactive?: boolean) =>
      q('listClubMembers', { clubId, includeInactive }),
    createMember: (clubId: string, details: ClubMemberInput) =>
      c('registerClubMember', { clubId, details }),
    updateMember: (memberId: string, details: Partial<ClubMemberInput>) =>
      c('updateClubMemberDetails', { memberId, details }),
    deleteMember: (memberId: string) => c('removeClubMember', { memberId }),
    importMembers: (clubId: string, members: ClubMemberInput[]) =>
      c('importClubMembers', { clubId, members }),
    // Maîtres d'armes
    listCoaches: (clubId: string, includeInactive?: boolean) =>
      q('listClubCoaches', { clubId, includeInactive }),
    createCoach: (clubId: string, details: ClubCoachInput) =>
      c('registerClubCoach', { clubId, details }),
    updateCoach: (coachId: string, details: Partial<ClubCoachInput>) =>
      c('updateClubCoachDetails', { coachId, details }),
    deleteCoach: (coachId: string) => c('removeClubCoach', { coachId }),
    // Séances
    listSessions: (clubId: string, range: { from?: string; to?: string } = {}) =>
      q('listClubSessions', { clubId, ...range }),
    getSession: (sessionId: string) => q('getClubSession', { sessionId }),
    createSession: (clubId: string, details: ClubSessionInput) =>
      c('planClubSession', { clubId, details }),
    createSeries: (clubId: string, details: ClubSessionInput, recurrence: ClubRecurrence) =>
      c('planClubSessionSeries', { clubId, details, recurrence }),
    generateSessions: (clubId: string, details: ClubSessionInput, schedule: ClubScheduleOptions) =>
      c('generateClubSessions', { clubId, details, schedule }),
    deletePlannedInPeriods: (clubId: string, periods: ClubDateRange[]) =>
      c('cancelPlannedClubSessions', { clubId, periods }),
    updateSession: (sessionId: string, details: Partial<ClubSessionInput>) =>
      c('updateClubSessionDetails', { sessionId, details }),
    startSession: (sessionId: string) => c('startClubSession', { sessionId }),
    closeSession: (sessionId: string) => c('closeClubSession', { sessionId }),
    reopenSession: (sessionId: string) => c('reopenClubSession', { sessionId }),
    deleteSession: (sessionId: string) => c('deleteClubSession', { sessionId }),
    setAttendance: (sessionId: string, memberId: string, present: boolean) =>
      c('setClubAttendance', { sessionId, memberId, present }),
    setMemberFeedback: (sessionId: string, memberId: string, text: string) =>
      c('setClubMemberFeedback', { sessionId, memberId, text }),
    getMemberFeedback: (memberId: string) => q('listClubMemberFeedback', { memberId }),
    // Exercices
    listExercises: () => q('listClubExercises', {}),
    createExercise: (details: ClubExerciseInput) => c('createClubExercise', { details }),
    updateExercise: (exerciseId: string, details: Partial<ClubExerciseInput>) =>
      c('updateClubExerciseDetails', { exerciseId, details }),
    deleteExercise: (exerciseId: string) => c('deleteClubExercise', { exerciseId }),
    importExercises: (exercises: ClubExerciseInput[]) => c('importClubExercises', { exercises }),
    // Combats
    listBouts: (filter: ClubBoutFilter = {}) => q('listClubBouts', filter),
    createBout: (data: ClubBoutInput) => c('createClubBout', data),
    startBout: (boutId: string) => c('startClubBout', { boutId }),
    updateBoutScore: (boutId: string, scoreA: number, scoreB: number) =>
      c('recordClubBoutScore', { boutId, scoreA, scoreB }),
    finishBout: (boutId: string, result: ClubBoutResult) => c('finishClubBout', { boutId, result }),
    cancelBout: (boutId: string) => c('cancelClubBout', { boutId }),
    deleteBout: (boutId: string) => c('deleteClubBout', { boutId }),
    // Statistiques
    getLeaderboard: (filter: ClubBoutFilter = {}) => q('getClubLeaderboard', filter),
    getMemberReport: (memberId: string, filter: ClubBoutFilter = {}, groupBy?: ClubPeriodKind) =>
      q('getClubMemberReport', { ...filter, memberId, groupBy }),
    // Inventaire
    listItems: (clubId: string, includeRetired?: boolean) =>
      q('listClubItems', { clubId, includeRetired }),
    createItem: (clubId: string, details: ClubItemInput) => c('addClubItem', { clubId, details }),
    createItemSeries: (clubId: string, details: ClubItemInput, count: number) =>
      c('addClubItemSeries', { clubId, details, count }),
    updateItem: (itemId: string, details: Partial<ClubItemInput>) =>
      c('updateClubItemDetails', { itemId, details }),
    deleteItem: (itemId: string) => c('removeClubItem', { itemId }),
    listLoans: (clubId: string, filter: ClubLoanFilter = {}) =>
      q('listClubLoans', { clubId, ...filter }),
    lendItem: (data: ClubLoanInput) => c('lendClubItem', data),
    returnLoan: (loanId: string, data: ClubLoanReturn = {}) =>
      c('returnClubLoan', { loanId, ...data }),
    deleteLoan: (loanId: string) => c('deleteClubLoan', { loanId }),
    listCategories: (clubId: string) => q('listClubCategories', { clubId }),
    createCategory: (clubId: string, name: string) => c('createClubCategory', { clubId, name }),
    renameCategory: (categoryId: string, name: string) =>
      c('renameClubCategory', { categoryId, name }),
    deleteCategory: (categoryId: string) => c('deleteClubCategory', { categoryId }),
    listBrands: (clubId: string) => q('listClubBrands', { clubId }),
    createBrand: (clubId: string, name: string) => c('createClubBrand', { clubId, name }),
    renameBrand: (brandId: string, name: string) => c('renameClubBrand', { brandId, name }),
    deleteBrand: (brandId: string) => c('deleteClubBrand', { brandId }),
    getInventoryLock: (clubId: string) => q('getClubInventoryLock', { clubId }),
    setInventoryLock: (clubId: string, locked: boolean) =>
      c('setClubInventoryLock', { clubId, locked }),
    importItems: (clubId: string, items: ClubItemInput[]) =>
      c('importClubItems', { clubId, items }),
    // Tablettes (serveur d'entraînement)
    remoteStatus: () => q('getClubRemoteStatus', {}),
    pushBout: (boutId: string) => c('sendClubBoutToStrip', { boutId }),
    linkRemote: (sessionId: string | null) => c('linkClubSessionToStrips', { sessionId }),
    releaseBout: (boutId: string) => c('releaseClubBout', { boutId }),
    // Synchronisation et sauvegardes du poste
    syncStatus: (clubId: string) => q('getClubSyncStatus', { clubId }),
    syncEnable: (clubId: string) => c('enableClubSync', { clubId }),
    syncDisable: (clubId: string) => c('disableClubSync', { clubId }),
    syncNow: (clubId: string) => c('syncClubNow', { clubId }),
    syncResolve: (clubId: string, keep: 'file' | 'app') =>
      c('resolveClubSyncConflict', { clubId, keep }),
    backupList: (clubId: string) => q('listClubBackups', { clubId }),
    backupCreate: (clubId: string) => c('createClubBackup', { clubId }),
    backupRestore: (clubId: string, backupId: string) =>
      c('restoreClubBackup', { clubId, backupId }),
    /** Reprise du fichier par la synchro : la vue doit se recharger. Renvoie la désinscription. */
    onSynced: (callback: (clubId: string) => void) =>
      client.subscribe('onClubSynced', {}, e => callback(e.clubId)),
  };
}

export type ClubApi = ReturnType<typeof createClubApi>;

/** API du Mode Club de l'écran, sur le client du contrat (stable tant que le client l'est) */
export function useClubApi(): ClubApi {
  const client = useBpmClient();
  return useMemo(() => createClubApi(client), [client]);
}
