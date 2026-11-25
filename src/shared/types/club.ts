/**
 * BPM - Escrime - Mode Club (#1872) : membres pré-enregistrés, séances libres,
 * combats sur pistes et statistiques par période.
 * Licensed under GPL-3.0
 */
import type { Weapon } from './index';
import type { ClubWeaponCode } from '../utils/clubWeapon';

export type Laterality = 'R' | 'L';

/** Membre du club, persistant d'une saison à l'autre */
export interface ClubMember {
  id: string;
  clubId: string;
  firstName: string;
  lastName: string;
  /** Surnom affiché à côté du nom (docs/adr/0034) */
  nickname?: string;
  license?: string;
  /** 'M' | 'F' | 'X' */
  gender?: string;
  birthYear?: number;
  /** Date de naissance AAAA-MM-JJ (fixe aussi birthYear) ; catégorie d'âge calculée */
  birthDate?: string;
  /** Armes pratiquées (vide = toutes) */
  weapons: Weapon[];
  laterality?: Laterality;
  category?: string;
  notes?: string;
  /** false = archivé (n'apparaît plus dans le pointage, stats conservées) */
  active: boolean;
  /** Code de la carte de club (QR `BPC1:M:<code>`), 10 hex ; régénérable si carte perdue */
  cardCode: string;
  /** Photo en data URL image (png, jpeg, webp) ; absente = initiales */
  photo?: string;
  createdAt: string;
  updatedAt: string;
}

export type ClubMemberInput = Partial<
  Omit<ClubMember, 'id' | 'clubId' | 'cardCode' | 'photo' | 'createdAt' | 'updatedAt'>
> & {
  firstName: string;
  lastName: string;
  /** null efface la photo */
  photo?: string | null;
};

/** Maître d'armes / éducateur du club : encadre les séances (pas un tireur) */
export interface ClubCoach {
  id: string;
  clubId: string;
  firstName: string;
  lastName: string;
  /** Diplôme ou fonction : Maître d'armes, Prévôt, Éducateur… */
  title?: string;
  phone?: string;
  email?: string;
  /** Armes enseignées (vide = toutes) ; « A » = escrime artistique */
  weapons: ClubWeaponCode[];
  notes?: string;
  /** false = archivé (n'est plus proposé sur les séances, historique conservé) */
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ClubCoachInput = Partial<
  Omit<ClubCoach, 'id' | 'clubId' | 'createdAt' | 'updatedAt'>
> & {
  firstName: string;
  lastName: string;
};

/** Club (plusieurs clubs possibles, #1872) */
export interface Club {
  id: string;
  name: string;
  logo?: string;
  stripCount: number;
  /** Arme par défaut des séances (règles de la saisie distante) : 1re arme de compétition de `weapons` */
  weapon?: ClubWeaponCode;
  /** Armes du club (codes E, F, S, L, A = escrime artistique) ; vide = non renseigné */
  weapons?: string[];
  createdAt: string;
  updatedAt: string;
}

/** Club vu depuis l'accueil : effectif et séances ouvertes */
export interface ClubSummary extends Club {
  membersCount: number;
  /** Date de la séance ouverte la plus récente */
  openSessionDate: string | null;
  /** Nombre de séances ouvertes (plusieurs possibles) */
  openSessionCount: number;
}

export interface ClubUpdate {
  name?: string;
  logo?: string | null;
  stripCount?: number;
  weapon?: ClubWeaponCode | null;
  weapons?: string[];
}

/** Identité du club : en-tête des cartes de membre */
export interface ClubSettings {
  name: string;
  weapon?: ClubWeaponCode;
  weapons?: string[];
  /** Logo en data URL image (png, jpeg, webp, svg) ; absent = pas de logo */
  logo?: string;
  /** Nombre de pistes de la salle (QR des pistes, séances) ; 1 par défaut */
  stripCount: number;
}

/** planned : préparée à l'avance ; open : en cours ; closed : terminée */
export type ClubSessionStatus = 'planned' | 'open' | 'closed';

/** Bilan d'une séance : ressenti global et pistes d'amélioration */
export interface ClubSessionFeedback {
  /** Note de la séance, 1 à 5 */
  rating?: number;
  wentWell?: string;
  toImprove?: string;
}

/** Remarque reçue par un tireur lors d'une séance */
export interface ClubMemberFeedback {
  sessionId: string;
  date: string;
  label?: string;
  text: string;
}

/** Exercice du plan de cours d'une séance */
export interface ClubPlanItem {
  id: string;
  title: string;
  /** Durée prévue en minutes */
  minutes: number;
  /** Consignes, matériel, variantes */
  details?: string;
  /** Coché pendant la séance */
  done?: boolean;
  /** Famille d'exercice (reprise de la bibliothèque) */
  category?: ClubExerciseCategory;
  /** Schémas / photos (data URL png, jpeg, webp ; 3 max) */
  images?: string[];
}

/** Familles d'exercices de la bibliothèque */
export type ClubExerciseCategory =
  'warmup' | 'technique' | 'tactics' | 'bouts' | 'physical' | 'cooldown' | 'other';

/** Exercice de la bibliothèque (partagée entre clubs, exportable / importable) */
export interface ClubExercise {
  id: string;
  title: string;
  category: ClubExerciseCategory;
  minutes: number;
  details?: string;
  images: string[];
  /** Catégories d'âge visées (U9 … V4) ; vide = commun à tous */
  ageCategories: string[];
  /** Armes visées (absent ou vide = toutes armes) */
  weapons?: string[];
  createdAt: string;
  updatedAt: string;
}

export type ClubExerciseInput = Pick<ClubExercise, 'title'> &
  Partial<
    Pick<ClubExercise, 'category' | 'minutes' | 'details' | 'images' | 'ageCategories' | 'weapons'>
  >;

/** Séance d'entraînement (une date, N pistes) */
export interface ClubSession {
  id: string;
  clubId: string;
  /** Date ISO AAAA-MM-JJ */
  date: string;
  label?: string;
  /** Heure de début (HH:MM, optionnelle, ex. 20:30) */
  startTime?: string;
  weapon?: ClubWeaponCode;
  stripCount: number;
  status: ClubSessionStatus;
  openedAt: string;
  closedAt?: string;
  /** Membres pointés présents */
  attendeeIds: string[];
  /** Maîtres d'armes encadrant la séance */
  coachIds: string[];
  /** Objectifs pédagogiques de la séance */
  objectives?: string;
  /** Plan de cours */
  plan: ClubPlanItem[];
  /** Notes / compte rendu du maître d'armes */
  notes?: string;
  /** Bilan de la séance */
  feedback?: ClubSessionFeedback;
  /** Remarque du maître d'armes par tireur présent (memberId → texte) */
  memberFeedback: Record<string, string>;
  /** Catégories d'âge du cours (bornes incluses, U9 … V4) ; absentes = toutes */
  ageFrom?: string;
  ageTo?: string;
  /** Série de séances récurrentes (même cours chaque semaine / tous les X jours) */
  seriesId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClubSessionInput {
  date: string;
  label?: string;
  /** Heure de début HH:MM ; null ou vide efface l'heure */
  startTime?: string | null;
  /** Maîtres d'armes de la séance (ids du club) */
  coachIds?: string[];
  weapon?: ClubWeaponCode;
  stripCount?: number;
  objectives?: string;
  plan?: ClubPlanItem[];
  notes?: string;
  feedback?: ClubSessionFeedback | null;
  /** Préparée à l'avance (statut planned), ouverte plus tard avec startSession */
  planned?: boolean;
  /** Catégories d'âge du cours ; null efface la borne */
  ageFrom?: string | null;
  ageTo?: string | null;
}

/** Répétition d'une séance préparée : tous les `everyDays` jours, `count` fois ou jusqu'à `until` */
export interface ClubRecurrence {
  everyDays: number;
  count?: number;
  until?: string;
}

/** Période du / au (AAAA-MM-JJ, bornes incluses) */
export interface ClubDateRange {
  from: string;
  until: string;
}

/** Séances automatiques sur jours d'ouverture : jours 0 (dim) … 6 (sam), une ou plusieurs périodes */
export interface ClubScheduleOptions {
  weekdays: number[];
  periods: ClubDateRange[];
}

/** Résultat d'une génération sur jours d'ouverture (dates déjà occupées ignorées) */
export interface ClubScheduleResult {
  created: ClubSession[];
  skipped: number;
}

/** Combat lancé depuis une tablette arbitre (cartes scannées) */
export type ClubIdentifyResult =
  | { ok: true; recorded: boolean; nameA: string; nameB: string }
  | {
      ok: false;
      error: 'no_session' | 'no_arena' | 'busy' | 'unknown_card' | 'same_member';
      side?: 'A' | 'B';
    };

export type ClubBoutStatus = 'pending' | 'in_progress' | 'finished' | 'cancelled';

/** Qui a saisi le score */
export type ClubEntryMode = 'referee' | 'self' | 'master';

/** Combat libre sur une piste */
export interface ClubBout {
  id: string;
  sessionId: string;
  /** Date de la séance (dénormalisée pour les filtres par période) */
  date: string;
  strip?: number;
  memberAId: string;
  memberBId: string;
  scoreA: number;
  scoreB: number;
  maxScore: number;
  /** Vainqueur (égalité possible : null) */
  winnerId: string | null;
  status: ClubBoutStatus;
  entryMode: ClubEntryMode;
  weapon?: Weapon;
  startedAt?: string;
  finishedAt?: string;
  /** Durée en secondes */
  duration?: number;
  /**
   * Zones des touches portées par A / B (Sabre Laser, tablette) : une lettre A/B/C par touche,
   * dans l'ordre. Absent : zones inconnues (docs/adr/0031)
   */
  zonesA?: string;
  zonesB?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClubBoutInput {
  sessionId: string;
  memberAId: string;
  memberBId: string;
  strip?: number;
  maxScore?: number;
  entryMode?: ClubEntryMode;
}

export interface ClubBoutResult {
  scoreA: number;
  scoreB: number;
  /** Vainqueur explicite (touche décisive / priorité) ; sinon déduit du score */
  winnerId?: string | null;
  entryMode?: ClubEntryMode;
  duration?: number;
  /** Zones des touches portées par A / B (tablette, docs/adr/0031) ; absent : inchangées */
  zonesA?: readonly string[];
  zonesB?: readonly string[];
}

/** Filtre des combats (bornes incluses, dates AAAA-MM-JJ) */
export interface ClubBoutFilter {
  clubId?: string;
  sessionId?: string;
  memberId?: string;
  from?: string;
  to?: string;
  weapon?: Weapon;
  /** Inclure combats non terminés (défaut : false) */
  includeUnfinished?: boolean;
}

export type ClubPeriodKind = 'day' | 'month' | 'quarter' | 'season' | 'year';

export interface ClubPeriod {
  kind: ClubPeriodKind;
  from: string;
  to: string;
  /** Libellé court : 2026-11-16, 2026-11, 2026-T4, 2026-2027, 2026 */
  key: string;
}

/** Statistiques d'un membre sur un ensemble de combats terminés */
export interface ClubMemberStats {
  memberId: string;
  bouts: number;
  victories: number;
  defeats: number;
  draws: number;
  /** Victoires / combats (0..1) */
  winRate: number;
  touchesScored: number;
  touchesReceived: number;
  /** TD - TR */
  indice: number;
  /** Nombre de séances distinctes avec au moins un combat */
  sessions: number;
  /** Touches portées / reçues par zone (Sabre Laser, combats dont les zones sont connues) */
  zonesScored: ClubZoneCounts;
  zonesReceived: ClubZoneCounts;
}

/** Nombre de touches par zone (A = 1 pt, B = 3 pts, C = 5 pts) */
export interface ClubZoneCounts {
  A: number;
  B: number;
  C: number;
}

/** Face-à-face entre deux membres */
export interface ClubHeadToHead {
  opponentId: string;
  bouts: number;
  victories: number;
  defeats: number;
  draws: number;
  touchesScored: number;
  touchesReceived: number;
}

/** Fiche statistique d'un membre du club (#1872) */
export interface ClubMemberReport {
  stats: ClubMemberStats;
  headToHead: ClubHeadToHead[];
  progression: Array<{ period: ClubPeriod; stats: ClubMemberStats }>;
}

/** Catégorie de matériel (inventaire du club) */
/** Catégorie standard (fixe) */
export type ClubItemCategoryStandard =
  | 'weapon'
  | 'blade'
  | 'mask'
  | 'jacket'
  | 'plastron'
  | 'glove'
  | 'breeches'
  | 'cable'
  | 'electric'
  | 'bag'
  | 'other';

/** Catégorie propre au club, clé `custom:<id>` (voir ClubItemCategoryDef) */
export type ClubItemCategoryCustom = `custom:${string}`;

/** Catégorie de matériel : standard ou propre au club */
export type ClubItemCategory = ClubItemCategoryStandard | ClubItemCategoryCustom;

/** Catégorie créée par le club, réutilisable dans les menus de l'inventaire */
export interface ClubItemCategoryDef {
  /** Clé d'affectation : `custom:${id}` */
  key: ClubItemCategoryCustom;
  id: string;
  clubId: string;
  name: string;
  /** Nombre de fiches rangées dans cette catégorie (calculé) */
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

/** État physique d'un matériel (à l'achat, au retour de prêt, à la réforme) */
export type ClubItemCondition = 'new' | 'good' | 'worn' | 'damaged' | 'out_of_service';

/** Ligne d'inventaire : un modèle de matériel, en `quantity` exemplaires (lot possible) */
export interface ClubItem {
  id: string;
  clubId: string;
  name: string;
  category: ClubItemCategory;
  brand?: string;
  model?: string;
  /** Numéro de série (exemplaire unique) */
  serialNumber?: string;
  weapon?: Weapon;
  size?: string;
  color?: string;
  /** Nombre d'exemplaires possédés (≥ 1) */
  quantity: number;
  /** Date d'achat AAAA-MM-JJ */
  purchaseDate?: string;
  /** Prix unitaire d'achat, en euros */
  purchasePrice?: number;
  supplier?: string;
  /** Référence de facture */
  invoiceRef?: string;
  /** Facture PDF importée (data URL application/pdf, 5 Mo max) */
  invoicePdf?: string;
  /** Photo du matériel (data URL JPEG/PNG, redimensionnée à 720 px de haut) */
  image?: string;
  /** Fin de garantie AAAA-MM-JJ */
  warrantyUntil?: string;
  condition: ClubItemCondition;
  /** Emplacement de rangement (armoire, sac, bac…) */
  location?: string;
  notes?: string;
  /** Réformé : n'est plus prêtable, reste dans l'historique */
  retired: boolean;
  /** Exemplaires actuellement prêtés (calculé) */
  lentQuantity: number;
  /** Exemplaires disponibles au prêt (calculé) */
  availableQuantity: number;
  createdAt: string;
  updatedAt: string;
}

export type ClubItemInput = Pick<ClubItem, 'name' | 'category'> &
  Partial<
    Pick<
      ClubItem,
      | 'brand'
      | 'model'
      | 'serialNumber'
      | 'weapon'
      | 'size'
      | 'color'
      | 'quantity'
      | 'purchaseDate'
      | 'purchasePrice'
      | 'supplier'
      | 'invoiceRef'
      | 'invoicePdf'
      | 'image'
      | 'warrantyUntil'
      | 'condition'
      | 'location'
      | 'notes'
      | 'retired'
    >
  >;

/** Prêt d'un matériel à un tireur du club (`returnedAt` absent = prêt en cours) */
export interface ClubLoan {
  id: string;
  clubId: string;
  itemId: string;
  itemName: string;
  /** Null si le tireur a été effacé (RGPD) alors que le matériel était encore prêté */
  memberId: string | null;
  memberName: string | null;
  quantity: number;
  /** Date et heure du prêt (ISO) */
  lentAt: string;
  /** Date de retour prévue AAAA-MM-JJ */
  dueDate?: string;
  returnedAt?: string;
  conditionOut: ClubItemCondition;
  conditionIn?: ClubItemCondition;
  notes?: string;
  /** Prêt en cours et échéance dépassée (calculé) */
  overdue: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ClubLoanInput {
  itemId: string;
  memberId: string;
  quantity?: number;
  dueDate?: string;
  /** Défaut : état actuel du matériel */
  conditionOut?: ClubItemCondition;
  notes?: string;
}

export interface ClubLoanReturn {
  /** Défaut : maintenant */
  returnedAt?: string;
  /** Si fourni, devient l'état du matériel */
  conditionIn?: ClubItemCondition;
  notes?: string;
}

export interface ClubLoanFilter {
  memberId?: string;
  itemId?: string;
  /** true = prêts en cours seulement ; false = rendus seulement */
  open?: boolean;
}

/** Marque du catalogue du club, réutilisable dans les fiches de matériel */
export interface ClubItemBrandDef {
  id: string;
  clubId: string;
  name: string;
  /** Nombre de fiches portant la marque (calculé) */
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export type ClubSyncState = 'off' | 'synced' | 'conflict' | 'error';

export interface ClubBackupEntry {
  /** Nom du fichier : identifiant pour la restauration */
  id: string;
  /** Date de création (ISO) */
  createdAt: string;
}

export interface ClubSyncStatus {
  clubId: string;
  state: ClubSyncState;
  dir: string | null;
  fileName: string | null;
  lastSync: string | null;
  error: string | null;
}
