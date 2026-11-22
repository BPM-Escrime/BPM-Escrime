/**
 * BellePoule Modern - Commandes et requêtes du Mode Club (#1981 lot 2, docs/adr/0022)
 * Reprise telle quelle de l'ancien ipc/clubHandlers.ts : mêmes dépôts (`db.club`,
 * `db.clubInventory`), mêmes statistiques. Pas de journal : ce ne sont pas des faits de l'épreuve.
 * Tablettes, synchro et sauvegardes : clubStation.ts (ports du CommandContext).
 * Licensed under GPL-3.0
 */
import type { z } from 'zod';
import type { clubOperations } from '../../../shared/api/contractClub';
import type { DatabaseManager } from '../../../database';
import type { ClubBoutFilter, ClubMemberReport, ClubPeriodKind } from '../../../shared/types/club';
import {
  computeHeadToHead,
  computeLeaderboard,
  computeMemberStats,
  statsByPeriod,
} from '../../../shared/utils/clubStats';
import { ApiError } from '../../../shared/api/client';
import { CommandError, type CommandContext } from './context';

type Ops = typeof clubOperations;

/** Gestionnaire d'une opération du Mode Club : types dérivés de son entrée et de sa sortie */
export type ClubHandler<N extends keyof Ops> = (
  ctx: CommandContext,
  input: z.output<Ops[N]['input']>
) => z.output<Ops[N]['output']> | Promise<z.output<Ops[N]['output']>>;

const PERIOD_KINDS: readonly ClubPeriodKind[] = ['day', 'month', 'quarter', 'season', 'year'];

/** Fiche statistique d'un membre sur la plage demandée */
export function buildMemberReport(
  db: DatabaseManager,
  memberId: string,
  filter: Omit<ClubBoutFilter, 'memberId' | 'includeUnfinished'> = {},
  groupBy: ClubPeriodKind = 'month'
): ClubMemberReport {
  const bouts = db.club.listBouts({ ...filter, memberId });
  return {
    stats: computeMemberStats(memberId, bouts),
    headToHead: computeHeadToHead(memberId, bouts),
    progression: statsByPeriod(memberId, bouts, PERIOD_KINDS.includes(groupBy) ? groupBy : 'month'),
  };
}

/**
 * Les dépôts du club refusent par une `Error` au message pour l'opérateur (« Séance fermée »,
 * « Matériel encore prêté »…) : le contrat la rend sous le code `club_refused`, message gardé
 * (sans cela l'écran n'afficherait que « Erreur interne »).
 */
export function refuse<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    throw asRefusal(e);
  }
}

export async function refuseAsync<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw asRefusal(e);
  }
}

function asRefusal(e: unknown): unknown {
  if (e instanceof CommandError || e instanceof ApiError) return e;
  return new CommandError('club_refused', e instanceof Error ? e.message : String(e));
}

const repo = (ctx: CommandContext) => ctx.db.club;
const inv = (ctx: CommandContext) => ctx.db.clubInventory;

/** Les opérations du Mode Club servies par la base (tablettes et synchro : clubStation.ts) */
type DbOps =
  | 'listClubs'
  | 'getClub'
  | 'createClub'
  | 'updateClubDetails'
  | 'deleteClub'
  | 'getClubMemberByCard'
  | 'regenerateClubCardCode'
  | 'listClubMembers'
  | 'registerClubMember'
  | 'updateClubMemberDetails'
  | 'removeClubMember'
  | 'importClubMembers'
  | 'listClubCoaches'
  | 'registerClubCoach'
  | 'updateClubCoachDetails'
  | 'removeClubCoach'
  | 'listClubSessions'
  | 'getClubSession'
  | 'planClubSession'
  | 'planClubSessionSeries'
  | 'generateClubSessions'
  | 'cancelPlannedClubSessions'
  | 'updateClubSessionDetails'
  | 'startClubSession'
  | 'closeClubSession'
  | 'reopenClubSession'
  | 'deleteClubSession'
  | 'setClubAttendance'
  | 'setClubMemberFeedback'
  | 'listClubMemberFeedback'
  | 'listClubExercises'
  | 'createClubExercise'
  | 'updateClubExerciseDetails'
  | 'deleteClubExercise'
  | 'importClubExercises'
  | 'listClubBouts'
  | 'createClubBout'
  | 'startClubBout'
  | 'recordClubBoutScore'
  | 'finishClubBout'
  | 'cancelClubBout'
  | 'deleteClubBout'
  | 'getClubLeaderboard'
  | 'getClubMemberReport'
  | 'listClubItems'
  | 'addClubItem'
  | 'addClubItemSeries'
  | 'updateClubItemDetails'
  | 'removeClubItem'
  | 'listClubLoans'
  | 'lendClubItem'
  | 'returnClubLoan'
  | 'deleteClubLoan'
  | 'listClubCategories'
  | 'createClubCategory'
  | 'renameClubCategory'
  | 'deleteClubCategory'
  | 'listClubBrands'
  | 'createClubBrand'
  | 'renameClubBrand'
  | 'deleteClubBrand'
  | 'getClubInventoryLock'
  | 'setClubInventoryLock'
  | 'importClubItems';

export const clubHandlers: { [N in DbOps]: ClubHandler<N> } = {
  // ── Clubs ──
  listClubs: ctx => refuse(() => repo(ctx).listClubs()),
  getClub: (ctx, { clubId }) => refuse(() => repo(ctx).getClub(clubId)),
  createClub: (ctx, input) => refuse(() => repo(ctx).createClub(input)),
  updateClubDetails: (ctx, { clubId, details }) =>
    refuse(() => repo(ctx).updateClub(clubId, details)),
  deleteClub: (ctx, { clubId }) => refuse(() => repo(ctx).deleteClub(clubId)),
  // ── Cartes ──
  getClubMemberByCard: (ctx, { code, clubId }) =>
    refuse(() => repo(ctx).findMemberByCardCode(code, clubId)),
  regenerateClubCardCode: (ctx, { memberId }) =>
    refuse(() => repo(ctx).regenerateCardCode(memberId)),
  // ── Membres ──
  listClubMembers: (ctx, { clubId, includeInactive }) =>
    refuse(() => repo(ctx).listMembers(clubId, includeInactive === true)),
  registerClubMember: (ctx, { clubId, details }) =>
    refuse(() => repo(ctx).createMember(clubId, details)),
  updateClubMemberDetails: (ctx, { memberId, details }) =>
    refuse(() => repo(ctx).updateMember(memberId, details)),
  removeClubMember: (ctx, { memberId }) => refuse(() => repo(ctx).deleteMember(memberId)),
  importClubMembers: (ctx, { clubId, members }) =>
    refuse(() => repo(ctx).importMembers(clubId, members)),
  // ── Maîtres d'armes ──
  listClubCoaches: (ctx, { clubId, includeInactive }) =>
    refuse(() => repo(ctx).listCoaches(clubId, includeInactive === true)),
  registerClubCoach: (ctx, { clubId, details }) =>
    refuse(() => repo(ctx).createCoach(clubId, details)),
  updateClubCoachDetails: (ctx, { coachId, details }) =>
    refuse(() => repo(ctx).updateCoach(coachId, details)),
  removeClubCoach: (ctx, { coachId }) => refuse(() => repo(ctx).deleteCoach(coachId)),
  // ── Séances ──
  listClubSessions: (ctx, { clubId, from, to }) =>
    refuse(() => repo(ctx).listSessions(clubId, { from, to })),
  getClubSession: (ctx, { sessionId }) => refuse(() => repo(ctx).getSession(sessionId)),
  planClubSession: (ctx, { clubId, details }) =>
    refuse(() => repo(ctx).createSession(clubId, details)),
  planClubSessionSeries: (ctx, { clubId, details, recurrence }) =>
    refuse(() => repo(ctx).createSeries(clubId, details, recurrence)),
  generateClubSessions: (ctx, { clubId, details, schedule }) =>
    refuse(() => repo(ctx).generateSessions(clubId, details, schedule)),
  cancelPlannedClubSessions: (ctx, { clubId, periods }) =>
    refuse(() => repo(ctx).deletePlannedInPeriods(clubId, periods)),
  updateClubSessionDetails: (ctx, { sessionId, details }) =>
    refuse(() => repo(ctx).updateSession(sessionId, details)),
  startClubSession: (ctx, { sessionId }) => refuse(() => repo(ctx).startSession(sessionId)),
  closeClubSession: (ctx, { sessionId }) =>
    refuse(() => {
      // Séance fermée : les tablettes ne lancent plus de combats pour elle
      if (ctx.club?.linkedSession() === sessionId) ctx.club.linkSession(null);
      return repo(ctx).closeSession(sessionId);
    }),
  reopenClubSession: (ctx, { sessionId }) => refuse(() => repo(ctx).reopenSession(sessionId)),
  deleteClubSession: (ctx, { sessionId }) => refuse(() => repo(ctx).deleteSession(sessionId)),
  setClubAttendance: (ctx, { sessionId, memberId, present }) =>
    refuse(() => repo(ctx).setAttendance(sessionId, memberId, present)),
  setClubMemberFeedback: (ctx, { sessionId, memberId, text }) =>
    refuse(() => repo(ctx).setMemberFeedback(sessionId, memberId, text)),
  listClubMemberFeedback: (ctx, { memberId }) =>
    refuse(() => repo(ctx).getMemberFeedback(memberId)),
  // ── Exercices ──
  listClubExercises: ctx => refuse(() => repo(ctx).listExercises()),
  createClubExercise: (ctx, { details }) => refuse(() => repo(ctx).createExercise(details)),
  updateClubExerciseDetails: (ctx, { exerciseId, details }) =>
    refuse(() => repo(ctx).updateExercise(exerciseId, details)),
  deleteClubExercise: (ctx, { exerciseId }) => refuse(() => repo(ctx).deleteExercise(exerciseId)),
  importClubExercises: (ctx, { exercises }) => refuse(() => repo(ctx).importExercises(exercises)),
  // ── Combats libres ──
  listClubBouts: (ctx, filter) => refuse(() => repo(ctx).listBouts(filter)),
  createClubBout: (ctx, input) => refuse(() => repo(ctx).createBout(input)),
  startClubBout: (ctx, { boutId }) => refuse(() => repo(ctx).startBout(boutId)),
  recordClubBoutScore: (ctx, { boutId, scoreA, scoreB }) =>
    refuse(() => repo(ctx).updateBoutScore(boutId, scoreA, scoreB)),
  finishClubBout: (ctx, { boutId, result }) => refuse(() => repo(ctx).finishBout(boutId, result)),
  cancelClubBout: (ctx, { boutId }) => refuse(() => repo(ctx).cancelBout(boutId)),
  deleteClubBout: (ctx, { boutId }) => refuse(() => repo(ctx).deleteBout(boutId)),
  // ── Statistiques ──
  getClubLeaderboard: (ctx, filter) =>
    refuse(() => computeLeaderboard(repo(ctx).listBouts({ ...filter, includeUnfinished: false }))),
  getClubMemberReport: (ctx, { memberId, groupBy, ...filter }) =>
    refuse(() => buildMemberReport(ctx.db, memberId, filter, groupBy ?? 'month')),
  // ── Inventaire ──
  listClubItems: (ctx, { clubId, includeRetired }) =>
    refuse(() => inv(ctx).listItems(clubId, includeRetired !== false)),
  addClubItem: (ctx, { clubId, details }) => refuse(() => inv(ctx).createItem(clubId, details)),
  addClubItemSeries: (ctx, { clubId, details, count }) =>
    refuse(() => inv(ctx).createItemSeries(clubId, details, count)),
  updateClubItemDetails: (ctx, { itemId, details }) =>
    refuse(() => inv(ctx).updateItem(itemId, details)),
  removeClubItem: (ctx, { itemId }) => refuse(() => inv(ctx).deleteItem(itemId)),
  listClubLoans: (ctx, { clubId, ...filter }) => refuse(() => inv(ctx).listLoans(clubId, filter)),
  lendClubItem: (ctx, input) => refuse(() => inv(ctx).lendItem(input)),
  returnClubLoan: (ctx, { loanId, ...data }) => refuse(() => inv(ctx).returnLoan(loanId, data)),
  deleteClubLoan: (ctx, { loanId }) => refuse(() => inv(ctx).deleteLoan(loanId)),
  listClubCategories: (ctx, { clubId }) => refuse(() => inv(ctx).listCategories(clubId)),
  createClubCategory: (ctx, { clubId, name }) =>
    refuse(() => inv(ctx).createCategory(clubId, name)),
  renameClubCategory: (ctx, { categoryId, name }) =>
    refuse(() => inv(ctx).renameCategory(categoryId, name)),
  deleteClubCategory: (ctx, { categoryId }) => refuse(() => inv(ctx).deleteCategory(categoryId)),
  listClubBrands: (ctx, { clubId }) => refuse(() => inv(ctx).listBrands(clubId)),
  createClubBrand: (ctx, { clubId, name }) => refuse(() => inv(ctx).createBrand(clubId, name)),
  renameClubBrand: (ctx, { brandId, name }) => refuse(() => inv(ctx).renameBrand(brandId, name)),
  deleteClubBrand: (ctx, { brandId }) => refuse(() => inv(ctx).deleteBrand(brandId)),
  getClubInventoryLock: (ctx, { clubId }) => refuse(() => inv(ctx).isInventoryLocked(clubId)),
  setClubInventoryLock: (ctx, { clubId, locked }) =>
    refuse(() => inv(ctx).setInventoryLock(clubId, locked)),
  importClubItems: (ctx, { clubId, items }) => refuse(() => inv(ctx).importItems(clubId, items)),
};
