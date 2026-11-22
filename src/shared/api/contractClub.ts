/**
 * BellePoule Modern - Opérations du Mode Club (#1981 lot 2, docs/adr/0022)
 * Clubs, membres, maîtres d'armes, séances, exercices, combats libres, statistiques, inventaire,
 * tablettes du serveur d'entraînement, synchronisation et sauvegardes du poste.
 * Ce ne sont pas des faits de l'épreuve : aucun journal. Droits `club:read` / `club:write`,
 * jamais servis sur le réseau (WS_READ_PERMISSIONS) et pas d'outil MCP (docs/adr/0022).
 * Sorties typées par les interfaces de shared/types/club.ts (z.custom, sans contrôle à l'exécution).
 * Licensed under GPL-3.0
 */
import { z } from 'zod';
import { command, Id, query, subscription } from './contractDef';
import { Weapon } from '../types';
import type {
  Club,
  ClubBackupEntry,
  ClubBout,
  ClubCoach,
  ClubExercise,
  ClubExerciseInput,
  ClubItem,
  ClubItemBrandDef,
  ClubItemCategory,
  ClubItemCategoryDef,
  ClubLoan,
  ClubMember,
  ClubMemberFeedback,
  ClubMemberReport,
  ClubMemberStats,
  ClubScheduleResult,
  ClubSession,
  ClubSummary,
  ClubSyncStatus,
} from '../types/club';
import type { ClubImportResult } from '../utils/clubImport';
import type { ClubWeaponCode } from '../utils/clubWeapon';

// ─── Identifiants ────────────────────────────────────────────────────────────

const ClubId = Id.describe('Identifiant du club (listClubs)');
const MemberId = Id.describe('Identifiant du membre (listClubMembers)');
const CoachId = Id.describe('Identifiant du maître d’armes (listClubCoaches)');
const SessionId = Id.describe('Identifiant de la séance (listClubSessions)');
const BoutId = Id.describe('Identifiant du combat (listClubBouts)');
const ExerciseId = Id.describe('Identifiant de l’exercice (listClubExercises)');
const ItemId = Id.describe('Identifiant du matériel (listClubItems)');
const LoanId = Id.describe('Identifiant du prêt (listClubLoans)');
const CategoryId = Id.describe('Identifiant de la catégorie de matériel (listClubCategories)');
const BrandId = Id.describe('Identifiant de la marque (listClubBrands)');

// ─── Champs communs (bornes : celles des dépôts, qui restent seuls juges du contenu) ─────────

const Short = z.string().max(200);
const Text = z.string().max(2000);
const LongText = z.string().max(10_000);
/** AAAA-MM-JJ : le dépôt refuse une date invalide avec son message */
const IsoDate = z.string().max(10);
const WeaponEnum = z.enum(Weapon);
/** Arme d'un club, d'une séance ou d'un maître d'armes : arme de compétition ou « A » (artistique) */
const ClubWeapon = z.union([WeaponEnum, z.literal('A')]) satisfies z.ZodType<ClubWeaponCode>;
/** Image en data URL (plan de cours, exercice) : 1,4 M de caractères au plus comme le dépôt */
const Image = z.string().max(1_400_000);
const Count = z.number().int().min(0).max(1_000_000);
const Score = z.number().int().min(0).max(999);

const ExerciseCategory = z.enum([
  'warmup',
  'technique',
  'tactics',
  'bouts',
  'physical',
  'cooldown',
  'other',
]);

const ItemCondition = z.enum(['new', 'good', 'worn', 'damaged', 'out_of_service']);
const EntryMode = z.enum(['referee', 'self', 'master']);

// ─── Entrées des fiches ──────────────────────────────────────────────────────

const ClubUpdateSchema = z.object({
  name: Short.optional(),
  /** null efface le logo */
  logo: z.string().max(2_800_000).nullable().optional(),
  stripCount: z.number().int().min(1).max(99).optional(),
  weapon: ClubWeapon.nullable().optional(),
  weapons: z.array(z.string().max(2)).max(10).optional(),
});

const MemberFields = {
  firstName: Short,
  lastName: Short,
  license: Short.optional(),
  /** 'M' | 'F' | 'X' */
  gender: z.string().max(10).optional(),
  birthYear: z.number().int().optional(),
  birthDate: IsoDate.optional(),
  /** Armes pratiquées (vide = toutes) */
  weapons: z.array(WeaponEnum).max(10).optional(),
  laterality: z.enum(['R', 'L']).optional(),
  category: z.string().max(20).optional(),
  notes: LongText.optional(),
  /** false = archivé */
  active: z.boolean().optional(),
  /** Data URL image (1 Mo au plus) ; null efface la photo */
  photo: z.string().max(1_400_000).nullable().optional(),
};
const ClubMemberInputSchema = z.object(MemberFields);
const ClubMemberPatchSchema = ClubMemberInputSchema.partial();

const CoachFields = {
  firstName: Short,
  lastName: Short,
  title: Short.optional(),
  phone: Short.optional(),
  email: Short.optional(),
  weapons: z.array(ClubWeapon).max(10).optional(),
  notes: LongText.optional(),
  active: z.boolean().optional(),
};
const ClubCoachInputSchema = z.object(CoachFields);
const ClubCoachPatchSchema = ClubCoachInputSchema.partial();

const PlanItemSchema = z.object({
  id: Id,
  title: Short,
  /** Durée prévue en minutes */
  minutes: z.number().min(0).max(100_000),
  details: LongText.optional(),
  done: z.boolean().optional(),
  category: ExerciseCategory.optional(),
  images: z.array(Image).max(3).optional(),
});

const SessionFields = {
  date: IsoDate,
  label: Short.optional(),
  /** HH:MM ; null ou vide efface l'heure */
  startTime: z.string().max(5).nullable().optional(),
  coachIds: z.array(Id).max(50).optional(),
  weapon: ClubWeapon.optional(),
  stripCount: z.number().int().min(1).max(99).optional(),
  objectives: LongText.optional(),
  plan: z.array(PlanItemSchema).max(50).optional(),
  notes: LongText.optional(),
  feedback: z
    .object({
      /** Note de la séance, 1 à 5 */
      rating: z.number().min(0).max(5).optional(),
      wentWell: LongText.optional(),
      toImprove: LongText.optional(),
    })
    .nullable()
    .optional(),
  /** Préparée à l'avance (statut planned), ouverte plus tard avec startClubSession */
  planned: z.boolean().optional(),
  /** Catégories d'âge du cours (U9 … V4) ; null efface la borne */
  ageFrom: z.string().max(10).nullable().optional(),
  ageTo: z.string().max(10).nullable().optional(),
};
const ClubSessionInputSchema = z.object(SessionFields);
const ClubSessionPatchSchema = ClubSessionInputSchema.partial();

const DateRangeSchema = z.object({ from: IsoDate, until: IsoDate });

const ExerciseFields = {
  title: Short,
  category: ExerciseCategory.optional(),
  minutes: z.number().min(0).max(100_000).optional(),
  details: LongText.optional(),
  images: z.array(Image).max(3).optional(),
  ageCategories: z.array(z.string().max(10)).max(20).optional(),
  weapons: z.array(z.string().max(2)).max(10).optional(),
};
const ClubExerciseInputSchema = z.object(ExerciseFields) satisfies z.ZodType<ClubExerciseInput>;
const ClubExercisePatchSchema = ClubExerciseInputSchema.partial();

const ItemFields = {
  name: Short,
  /** Catégorie standard ou propre au club (`custom:<id>`) */
  category: z.custom<ClubItemCategory>(
    v => typeof v === 'string' && v.length > 0 && v.length <= 120,
    'Catégorie de matériel invalide'
  ),
  brand: Short.optional(),
  model: Short.optional(),
  serialNumber: Short.optional(),
  weapon: WeaponEnum.optional(),
  size: Short.optional(),
  color: Short.optional(),
  quantity: z.number().int().min(1).max(100_000).optional(),
  purchaseDate: IsoDate.optional(),
  purchasePrice: z.number().min(0).max(10_000_000).optional(),
  supplier: Short.optional(),
  invoiceRef: Short.optional(),
  /** Facture PDF en data URL (5 Mo au plus) */
  invoicePdf: z.string().max(7_200_000).optional(),
  /** Photo du matériel en data URL */
  image: z.string().max(3_000_000).optional(),
  warrantyUntil: IsoDate.optional(),
  condition: ItemCondition.optional(),
  location: Short.optional(),
  notes: Text.optional(),
  retired: z.boolean().optional(),
};
const ClubItemInputSchema = z.object(ItemFields);
const ClubItemPatchSchema = ClubItemInputSchema.partial();

/** Filtre des combats (bornes incluses) */
const BoutFilterFields = {
  clubId: ClubId.optional(),
  sessionId: SessionId.optional(),
  memberId: MemberId.optional(),
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  weapon: WeaponEnum.optional(),
};

const SyncStatusOut = z.custom<ClubSyncStatus>();
const Nothing = z.void();

export const clubOperations = {
  // ── Clubs ──
  listClubs: query({
    description: 'Clubs du Mode Club, avec effectif et séances ouvertes (accueil).',
    input: z.object({}),
    output: z.custom<ClubSummary[]>(),
    permission: 'club:read',
  }),
  getClub: query({
    description: 'Fiche d’un club ; null s’il n’existe pas.',
    input: z.object({ clubId: ClubId }),
    output: z.custom<Club | null>(),
    permission: 'club:read',
  }),
  createClub: command({
    description: 'Crée un club (nom, nombre de pistes).',
    input: z.object({ name: Short, stripCount: z.number().int().min(1).max(99).optional() }),
    output: z.custom<Club>(),
    permission: 'club:write',
  }),
  updateClubDetails: command({
    description: 'Modifie l’identité d’un club : nom, logo (null l’efface), pistes, armes.',
    input: z.object({ clubId: ClubId, details: ClubUpdateSchema }),
    output: z.custom<Club | null>(),
    permission: 'club:write',
  }),
  deleteClub: command({
    description: 'Supprime un club et toutes ses données : membres, séances, combats, matériel.',
    input: z.object({ clubId: ClubId }),
    output: Nothing,
    permission: 'club:write',
  }),

  // ── Cartes ──
  getClubMemberByCard: query({
    description:
      'Membre actif d’après le code lu sur sa carte de club ; null si inconnu. clubId limite à un club.',
    input: z.object({ code: z.string().max(100), clubId: ClubId.optional() }),
    output: z.custom<ClubMember | null>(),
    permission: 'club:read',
  }),
  regenerateClubCardCode: command({
    description: 'Nouveau code de carte d’un membre : l’ancienne carte devient invalide.',
    input: z.object({ memberId: MemberId }),
    output: z.custom<ClubMember | null>(),
    permission: 'club:write',
  }),

  // ── Membres ──
  listClubMembers: query({
    description: 'Membres d’un club ; archivés inclus si includeInactive.',
    input: z.object({ clubId: ClubId, includeInactive: z.boolean().optional() }),
    output: z.custom<ClubMember[]>(),
    permission: 'club:read',
  }),
  registerClubMember: command({
    description: 'Inscrit un membre au club.',
    input: z.object({ clubId: ClubId, details: ClubMemberInputSchema }),
    output: z.custom<ClubMember>(),
    permission: 'club:write',
  }),
  updateClubMemberDetails: command({
    description: 'Modifie la fiche d’un membre (photo null : effacée ; active false : archivé).',
    input: z.object({ memberId: MemberId, details: ClubMemberPatchSchema }),
    output: z.custom<ClubMember | null>(),
    permission: 'club:write',
  }),
  removeClubMember: command({
    description:
      'Efface définitivement un membre (RGPD) : présences et combats compris. Archiver = active false.',
    input: z.object({ memberId: MemberId }),
    output: Nothing,
    permission: 'club:write',
  }),
  importClubMembers: command({
    description:
      'Import en lot : nouveaux membres créés, existants complétés (licence puis nom), doublons ignorés.',
    input: z.object({ clubId: ClubId, members: z.array(ClubMemberInputSchema).max(5000) }),
    output: z.custom<ClubImportResult>(),
    permission: 'club:write',
  }),

  // ── Maîtres d'armes ──
  listClubCoaches: query({
    description: 'Maîtres d’armes d’un club ; archivés inclus si includeInactive.',
    input: z.object({ clubId: ClubId, includeInactive: z.boolean().optional() }),
    output: z.custom<ClubCoach[]>(),
    permission: 'club:read',
  }),
  registerClubCoach: command({
    description: 'Ajoute un maître d’armes au club.',
    input: z.object({ clubId: ClubId, details: ClubCoachInputSchema }),
    output: z.custom<ClubCoach>(),
    permission: 'club:write',
  }),
  updateClubCoachDetails: command({
    description: 'Modifie la fiche d’un maître d’armes (active false : archivé).',
    input: z.object({ coachId: CoachId, details: ClubCoachPatchSchema }),
    output: z.custom<ClubCoach | null>(),
    permission: 'club:write',
  }),
  removeClubCoach: command({
    description: 'Supprime définitivement un maître d’armes : il est retiré des séances.',
    input: z.object({ coachId: CoachId }),
    output: Nothing,
    permission: 'club:write',
  }),

  // ── Séances ──
  listClubSessions: query({
    description: 'Séances d’un club, éventuellement entre deux dates (AAAA-MM-JJ).',
    input: z.object({ clubId: ClubId, from: IsoDate.optional(), to: IsoDate.optional() }),
    output: z.custom<ClubSession[]>(),
    permission: 'club:read',
  }),
  getClubSession: query({
    description: 'Une séance : plan de cours, présents, bilan ; null si inconnue.',
    input: z.object({ sessionId: SessionId }),
    output: z.custom<ClubSession | null>(),
    permission: 'club:read',
  }),
  planClubSession: command({
    description: 'Crée une séance, ouverte ou préparée à l’avance (planned).',
    input: z.object({ clubId: ClubId, details: ClubSessionInputSchema }),
    output: z.custom<ClubSession>(),
    permission: 'club:write',
  }),
  planClubSessionSeries: command({
    description:
      'Prépare une série de séances (même plan) tous les N jours, N fois ou jusqu’à une date.',
    input: z.object({
      clubId: ClubId,
      details: ClubSessionInputSchema,
      recurrence: z.object({
        everyDays: z.number().int().min(0).max(366),
        count: z.number().int().min(0).max(1000).optional(),
        until: IsoDate.optional(),
      }),
    }),
    output: z.custom<ClubSession[]>(),
    permission: 'club:write',
  }),
  generateClubSessions: command({
    description:
      'Prépare des séances sur les jours d’ouverture (0 dimanche … 6 samedi) d’une ou plusieurs périodes ; dates déjà occupées ignorées.',
    input: z.object({
      clubId: ClubId,
      details: ClubSessionInputSchema,
      schedule: z.object({
        weekdays: z.array(z.number().int().min(0).max(6)).max(7),
        periods: z.array(DateRangeSchema).max(100),
      }),
    }),
    output: z.custom<ClubScheduleResult>(),
    permission: 'club:write',
  }),
  cancelPlannedClubSessions: command({
    description:
      'Fermeture du club : supprime les séances préparées (ni ouvertes ni closes) des périodes ; renvoie leur nombre.',
    input: z.object({ clubId: ClubId, periods: z.array(DateRangeSchema).max(100) }),
    output: z.number(),
    permission: 'club:write',
  }),
  updateClubSessionDetails: command({
    description: 'Modifie une séance : intitulé, plan, objectifs, notes, bilan, bornes d’âge.',
    input: z.object({ sessionId: SessionId, details: ClubSessionPatchSchema }),
    output: z.custom<ClubSession | null>(),
    permission: 'club:write',
  }),
  startClubSession: command({
    description: 'Ouvre une séance préparée (une seule séance ouverte par club).',
    input: z.object({ sessionId: SessionId }),
    output: z.custom<ClubSession | null>(),
    permission: 'club:write',
  }),
  closeClubSession: command({
    description: 'Ferme la séance : combats non terminés annulés, tablettes déliées de la séance.',
    input: z.object({ sessionId: SessionId }),
    output: z.custom<ClubSession | null>(),
    permission: 'club:write',
  }),
  reopenClubSession: command({
    description: 'Rouvre une séance fermée.',
    input: z.object({ sessionId: SessionId }),
    output: z.custom<ClubSession | null>(),
    permission: 'club:write',
  }),
  deleteClubSession: command({
    description: 'Supprime une séance avec ses présences et ses combats.',
    input: z.object({ sessionId: SessionId }),
    output: Nothing,
    permission: 'club:write',
  }),
  setClubAttendance: command({
    description: 'Pointe un membre présent ou absent à une séance ; renvoie les présents.',
    input: z.object({ sessionId: SessionId, memberId: MemberId, present: z.boolean() }),
    output: z.array(z.string()),
    permission: 'club:write',
  }),
  setClubMemberFeedback: command({
    description: 'Remarque du maître d’armes pour un membre présent à la séance (vide : effacée).',
    input: z.object({ sessionId: SessionId, memberId: MemberId, text: LongText }),
    output: Nothing,
    permission: 'club:write',
  }),
  listClubMemberFeedback: query({
    description: 'Remarques reçues par un membre, les plus récentes d’abord.',
    input: z.object({ memberId: MemberId }),
    output: z.custom<ClubMemberFeedback[]>(),
    permission: 'club:read',
  }),

  // ── Exercices ──
  listClubExercises: query({
    description: 'Bibliothèque d’exercices, partagée entre les clubs.',
    input: z.object({}),
    output: z.custom<ClubExercise[]>(),
    permission: 'club:read',
  }),
  createClubExercise: command({
    description: 'Ajoute un exercice à la bibliothèque.',
    input: z.object({ details: ClubExerciseInputSchema }),
    output: z.custom<ClubExercise>(),
    permission: 'club:write',
  }),
  updateClubExerciseDetails: command({
    description: 'Modifie un exercice de la bibliothèque.',
    input: z.object({ exerciseId: ExerciseId, details: ClubExercisePatchSchema }),
    output: z.custom<ClubExercise | null>(),
    permission: 'club:write',
  }),
  deleteClubExercise: command({
    description: 'Supprime un exercice de la bibliothèque.',
    input: z.object({ exerciseId: ExerciseId }),
    output: Nothing,
    permission: 'club:write',
  }),
  importClubExercises: command({
    description: 'Import d’un fichier partagé : doublons (même titre et famille) ignorés.',
    input: z.object({ exercises: z.array(ClubExerciseInputSchema).max(1000) }),
    output: z.object({ created: z.number(), skipped: z.number() }),
    permission: 'club:write',
  }),

  // ── Combats libres ──
  listClubBouts: query({
    description:
      'Combats libres, filtrés par club, séance, membre, période ou arme ; non terminés seulement si includeUnfinished.',
    input: z.object({ ...BoutFilterFields, includeUnfinished: z.boolean().optional() }),
    output: z.custom<ClubBout[]>(),
    permission: 'club:read',
  }),
  createClubBout: command({
    description: 'Crée un combat libre entre deux membres sur une piste d’une séance ouverte.',
    input: z.object({
      sessionId: SessionId,
      memberAId: MemberId,
      memberBId: MemberId,
      strip: z.number().int().min(1).max(99).optional(),
      maxScore: z.number().int().min(1).max(99).optional(),
      entryMode: EntryMode.optional(),
    }),
    output: z.custom<ClubBout>(),
    permission: 'club:write',
  }),
  startClubBout: command({
    description: 'Démarre un combat.',
    input: z.object({ boutId: BoutId }),
    output: z.custom<ClubBout | null>(),
    permission: 'club:write',
  }),
  recordClubBoutScore: command({
    description: 'Met à jour le score d’un combat en cours, sans le terminer.',
    input: z.object({ boutId: BoutId, scoreA: Score, scoreB: Score }),
    output: z.custom<ClubBout | null>(),
    permission: 'club:write',
  }),
  finishClubBout: command({
    description:
      'Termine un combat : score final, vainqueur explicite (touche décisive) sinon déduit du score.',
    input: z.object({
      boutId: BoutId,
      result: z.object({
        scoreA: Score,
        scoreB: Score,
        winnerId: Id.nullable().optional(),
        entryMode: EntryMode.optional(),
        /** Durée en secondes */
        duration: z.number().min(0).max(86_400).optional(),
      }),
    }),
    output: z.custom<ClubBout | null>(),
    permission: 'club:write',
  }),
  cancelClubBout: command({
    description: 'Annule un combat.',
    input: z.object({ boutId: BoutId }),
    output: z.custom<ClubBout | null>(),
    permission: 'club:write',
  }),
  deleteClubBout: command({
    description: 'Supprime un combat.',
    input: z.object({ boutId: BoutId }),
    output: Nothing,
    permission: 'club:write',
  }),

  // ── Statistiques ──
  getClubLeaderboard: query({
    description:
      'Classement des membres sur les combats terminés du filtre : victoires, touches, indice.',
    input: z.object(BoutFilterFields),
    output: z.custom<ClubMemberStats[]>(),
    permission: 'club:read',
  }),
  getClubMemberReport: query({
    description:
      'Fiche statistique d’un membre : bilan, face-à-face, progression par jour, mois, trimestre, saison ou année (mois par défaut).',
    input: z.object({
      ...BoutFilterFields,
      memberId: MemberId,
      groupBy: z.enum(['day', 'month', 'quarter', 'season', 'year']).optional(),
    }),
    output: z.custom<ClubMemberReport>(),
    permission: 'club:read',
  }),

  // ── Inventaire ──
  listClubItems: query({
    description: 'Matériel du club ; réformés inclus sauf includeRetired false.',
    input: z.object({ clubId: ClubId, includeRetired: z.boolean().optional() }),
    output: z.custom<ClubItem[]>(),
    permission: 'club:read',
  }),
  addClubItem: command({
    description: 'Ajoute une fiche de matériel (un modèle, en plusieurs exemplaires possibles).',
    input: z.object({ clubId: ClubId, details: ClubItemInputSchema }),
    output: z.custom<ClubItem>(),
    permission: 'club:write',
  }),
  addClubItemSeries: command({
    description: 'Ajoute count fiches « Nom-01 … » d’un exemplaire chacune, sans doublon de nom.',
    input: z.object({
      clubId: ClubId,
      details: ClubItemInputSchema,
      count: z.number().int().min(1).max(1000),
    }),
    output: z.custom<ClubItem[]>(),
    permission: 'club:write',
  }),
  updateClubItemDetails: command({
    description:
      'Modifie une fiche de matériel ; la quantité ne passe pas sous les exemplaires prêtés.',
    input: z.object({ itemId: ItemId, details: ClubItemPatchSchema }),
    output: z.custom<ClubItem | null>(),
    permission: 'club:write',
  }),
  removeClubItem: command({
    description:
      'Supprime un matériel (refusé s’il est prêté) et l’historique de ses prêts rendus.',
    input: z.object({ itemId: ItemId }),
    output: Nothing,
    permission: 'club:write',
  }),
  listClubLoans: query({
    description: 'Prêts de matériel du club, les plus récents d’abord ; open : en cours ou rendus.',
    input: z.object({
      clubId: ClubId,
      memberId: MemberId.optional(),
      itemId: ItemId.optional(),
      open: z.boolean().optional(),
    }),
    output: z.custom<ClubLoan[]>(),
    permission: 'club:read',
  }),
  lendClubItem: command({
    description: 'Prête des exemplaires d’un matériel à un membre, dans la limite des disponibles.',
    input: z.object({
      itemId: ItemId,
      memberId: MemberId,
      quantity: z.number().int().min(1).max(100_000).optional(),
      /** Retour prévu AAAA-MM-JJ */
      dueDate: IsoDate.optional(),
      conditionOut: ItemCondition.optional(),
      notes: Text.optional(),
    }),
    output: z.custom<ClubLoan>(),
    permission: 'club:write',
  }),
  returnClubLoan: command({
    description: 'Enregistre le retour d’un prêt ; conditionIn devient l’état du matériel.',
    input: z.object({
      loanId: LoanId,
      /** Date et heure ISO ; défaut : maintenant */
      returnedAt: z.string().max(40).optional(),
      conditionIn: ItemCondition.optional(),
      notes: Text.optional(),
    }),
    output: z.custom<ClubLoan | null>(),
    permission: 'club:write',
  }),
  deleteClubLoan: command({
    description:
      'Supprime un prêt rendu (correction de saisie) ; un prêt en cours se rend d’abord.',
    input: z.object({ loanId: LoanId }),
    output: Nothing,
    permission: 'club:write',
  }),
  listClubCategories: query({
    description: 'Catégories de matériel créées par le club, triées par nom.',
    input: z.object({ clubId: ClubId }),
    output: z.custom<ClubItemCategoryDef[]>(),
    permission: 'club:read',
  }),
  createClubCategory: command({
    description: 'Crée une catégorie de matériel (nom unique dans le club, casse ignorée).',
    input: z.object({ clubId: ClubId, name: Short }),
    output: z.custom<ClubItemCategoryDef>(),
    permission: 'club:write',
  }),
  renameClubCategory: command({
    description: 'Renomme une catégorie de matériel.',
    input: z.object({ categoryId: CategoryId, name: Short }),
    output: z.custom<ClubItemCategoryDef | null>(),
    permission: 'club:write',
  }),
  deleteClubCategory: command({
    description: 'Supprime une catégorie de matériel (refusé si des fiches l’utilisent).',
    input: z.object({ categoryId: CategoryId }),
    output: Nothing,
    permission: 'club:write',
  }),
  listClubBrands: query({
    description: 'Marques du catalogue du club, triées par nom.',
    input: z.object({ clubId: ClubId }),
    output: z.custom<ClubItemBrandDef[]>(),
    permission: 'club:read',
  }),
  createClubBrand: command({
    description: 'Crée une marque du catalogue (nom unique dans le club).',
    input: z.object({ clubId: ClubId, name: Short }),
    output: z.custom<ClubItemBrandDef>(),
    permission: 'club:write',
  }),
  renameClubBrand: command({
    description: 'Renomme une marque : les fiches qui la portent prennent le nouveau nom.',
    input: z.object({ brandId: BrandId, name: Short }),
    output: z.custom<ClubItemBrandDef | null>(),
    permission: 'club:write',
  }),
  deleteClubBrand: command({
    description: 'Supprime une marque du catalogue (refusé si des fiches la portent).',
    input: z.object({ brandId: BrandId }),
    output: Nothing,
    permission: 'club:write',
  }),
  getClubInventoryLock: query({
    description: 'Inventaire verrouillé (consultation seule) ou modifiable.',
    input: z.object({ clubId: ClubId }),
    output: z.boolean(),
    permission: 'club:read',
  }),
  setClubInventoryLock: command({
    description: 'Verrouille l’inventaire (consultation seule) ou le rend modifiable.',
    input: z.object({ clubId: ClubId, locked: z.boolean() }),
    output: z.boolean(),
    permission: 'club:write',
  }),
  importClubItems: command({
    description: 'Import CSV ou Excel : fiches ajoutées, doublons de numéro de série ignorés.',
    input: z.object({ clubId: ClubId, items: z.array(ClubItemInputSchema).max(2000) }),
    output: z.object({ created: z.number(), skipped: z.number() }),
    permission: 'club:write',
  }),

  // ── Tablettes (serveur d'entraînement) ──
  getClubRemoteStatus: query({
    description: 'Saisie distante des tablettes : serveur d’entraînement actif, adresse, pistes.',
    input: z.object({}),
    output: z.object({ active: z.boolean(), url: z.string().nullable(), strips: z.number() }),
    permission: 'club:read',
  }),
  sendClubBoutToStrip: command({
    description: 'Envoie le combat à la tablette arbitre de sa piste.',
    input: z.object({ boutId: BoutId }),
    output: z.enum(['ok', 'no_server', 'no_arena', 'busy']),
    permission: 'club:write',
  }),
  linkClubSessionToStrips: command({
    description:
      'Séance dont les tablettes lancent des combats par scan des cartes ; null : aucune.',
    input: z.object({ sessionId: SessionId.nullable() }),
    output: Nothing,
    permission: 'club:write',
  }),
  releaseClubBout: command({
    description: 'Combat annulé : libère l’arène de sa piste.',
    input: z.object({ boutId: BoutId }),
    output: Nothing,
    permission: 'club:write',
  }),

  // ── Synchronisation et sauvegardes du poste ──
  getClubSyncStatus: query({
    description: 'État de la synchronisation d’un club vers un dossier (Drive, Dropbox…).',
    input: z.object({ clubId: ClubId }),
    output: SyncStatusOut,
    permission: 'club:read',
  }),
  enableClubSync: command({
    description:
      'Active la synchronisation d’un club : sélecteur de dossier du poste puis première passe ; null si annulé.',
    input: z.object({ clubId: ClubId }),
    output: z.custom<ClubSyncStatus | null>(),
    permission: 'club:write',
  }),
  disableClubSync: command({
    description: 'Désactive la synchronisation d’un club.',
    input: z.object({ clubId: ClubId }),
    output: SyncStatusOut,
    permission: 'club:write',
  }),
  syncClubNow: command({
    description: 'Lance tout de suite une passe de synchronisation.',
    input: z.object({ clubId: ClubId }),
    output: SyncStatusOut,
    permission: 'club:write',
  }),
  resolveClubSyncConflict: command({
    description: 'Conflit de synchronisation : « file » garde le fichier, « app » garde ce poste.',
    input: z.object({ clubId: ClubId, keep: z.enum(['file', 'app']) }),
    output: SyncStatusOut,
    permission: 'club:write',
  }),
  listClubBackups: query({
    description: 'Sauvegardes locales du club (deux au plus), les plus récentes d’abord.',
    input: z.object({ clubId: ClubId }),
    output: z.custom<ClubBackupEntry[]>(),
    permission: 'club:read',
  }),
  createClubBackup: command({
    description: 'Crée une sauvegarde locale du club (la plus ancienne est supprimée).',
    input: z.object({ clubId: ClubId }),
    output: z.custom<ClubBackupEntry[]>(),
    permission: 'club:write',
  }),
  restoreClubBackup: command({
    description: 'Restaure une sauvegarde locale : remplace les données du club sur ce poste.',
    input: z.object({ clubId: ClubId, backupId: z.string().min(1).max(200) }),
    output: z.object({ clubName: z.string() }),
    permission: 'club:write',
  }),
  onClubSynced: subscription({
    description:
      'Reprise du fichier de synchronisation ou sauvegarde restaurée : les vues du club se rechargent.',
    input: z.object({}),
    output: z.object({ clubId: z.string() }),
    permission: 'club:read',
  }),
};
