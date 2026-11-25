/**
 * BPM - Escrime - Schéma d'une épreuve dans le contrat d'API (#1981, docs/adr/0018)
 * Réglages (CompetitionSettings) en zod strict : sortie de getCompetition / listCompetitions,
 * entrée de createCompetition / updateCompetitionSettings (valeurs validées). La formule à la
 * carte garde son type sans validation de valeur, en attendant validateFormulaSettings
 * (docs/adr/0012).
 * Licensed under GPL-3.0
 */
import { z } from 'zod';
import {
  Category,
  Gender,
  Weapon,
  type CompetitionSettings,
  type CustomFormulaConfig,
} from '../types';
import type { FormulaV2 } from '../domain/formula/formulaV2';

const Count = z.number().int().min(0);
const Text = z.string().max(500);

const RefereeingSchema = z.strictObject({
  neutrality: z
    .strictObject({
      club: z.boolean().optional(),
      nationality: z.boolean().optional(),
      region: z.boolean().optional(),
    })
    .optional(),
  balance: z.boolean().optional(),
  maxConsecutiveMatches: Count.optional(),
  minRestTimeMinutes: Count.optional(),
});

const QuestConfigSchema = z.strictObject({
  enabled: z.boolean(),
  hasPreliminaryPools: z.boolean(),
  qualifiersCount: Count.optional(),
  fightsPerFencer: Count.optional(),
  availableTimeMinutes: Count.optional(),
  numberOfArenas: Count.optional(),
  opponentConstraint: z.enum(['none', 'club', 'region', 'nation']),
});

const FederalSchema = z.strictObject({
  id: Text.optional(),
  season: Text.optional(),
  championship: Text.optional(),
  federation: Text.optional(),
  domain: Text.optional(),
  weapon: Text.optional(),
  gender: Text.optional(),
  category: Text.optional(),
  date: Text.optional(),
  dateStart: Text.optional(),
  dateEnd: Text.optional(),
  fileDate: Text.optional(),
  type: z.enum(['I', 'E']).optional(),
  title: Text.optional(),
  shortTitle: Text.optional(),
  location: Text.optional(),
  organizer: Text.optional(),
  organizerUrl: Text.optional(),
  unlocked: z.boolean().optional(),
});

const ScheduleSchema = z.strictObject({
  checkIn: Text.optional(),
  scratch: Text.optional(),
  start: Text.optional(),
});

/** Formule à la carte : type conservé, valeurs validées plus tard (docs/adr/0012) */
const CustomFormulaSchema = z.custom<CustomFormulaConfig>(
  v => typeof v === 'object' && v !== null && (v as { version?: unknown }).version === 1,
  'Formule à la carte invalide (version 1 attendue)'
);

/** Réglages d'une épreuve : toutes les clés de CompetitionSettings, rien d'autre */
export const CompetitionSettingsSchema = z.strictObject({
  defaultPoolMaxScore: Count,
  defaultTableMaxScore: Count,
  defaultPoolTimerSeconds: Count,
  defaultTableTimerSeconds: Count,
  restTimeSeconds: Count.optional(),
  poolRounds: z.number().int().min(1),
  poolRoundQualifiers: z.array(Count).optional(),
  poolSizeMin: Count.optional(),
  poolSizeMax: Count.optional(),
  refereeing: RefereeingSchema.optional(),
  hasDirectElimination: z.boolean(),
  thirdPlaceMatch: z.boolean(),
  signTableauMatches: z.boolean().optional(),
  manualRanking: z.boolean(),
  defaultRanking: z.number(),
  randomScore: z.boolean(),
  minTeamSize: Count,
  teamReserveCount: Count.optional(),
  laserTeamMode: z.enum(['touches', 'points']).optional(),
  teamRelayStepSize: Count.optional(),
  teamFormat: z.enum(['fie-relay', 'laser-arena']).optional(),
  questConfig: QuestConfigSchema.optional(),
  refereeFeatureEnabled: z.boolean().optional(),
  blackCardEnabled: z.boolean().optional(),
  trainerCommentsEnabled: z.boolean().optional(),
  customFormula: CustomFormulaSchema.optional(),
  specialMode: z.enum(['rapieres']).optional(),
  /** Formule v2 (docs/adr/0034) : forme jugée par le domaine à l'écriture */
  formula: z
    .custom<FormulaV2>(
      v => typeof v === 'object' && v !== null && (v as { version?: unknown }).version === 2,
      'Formule invalide (version 2 attendue)'
    )
    .optional(),
  /** Modèle d'origine de la formule (docs/adr/0033) */
  formulaOrigin: z
    .strictObject({ templateId: z.string().min(1).max(200), season: z.string().max(40).optional() })
    .optional(),
  playAllPositions: z.boolean().optional(),
  expertMode: z.boolean().optional(),
  maxRefereesPerPool: Count.optional(),
  maxRefereesPerMatch: Count.optional(),
  poolWinnersOnly: z.boolean().optional(),
  postPoolSplitCriteria: z.enum(['gender']).optional(),
  splitOffCompetitionIds: z.record(z.string(), z.string().optional()).optional(),
  splitFromCompetitionId: z.string().optional(),
  federal: FederalSchema.optional(),
  schedule: ScheduleSchema.optional(),
  gregLevel: z.enum(['L', 'Z', 'CN', 'A', 'F', 'IE', 'X']).optional(),
  poolBoutOrder: z.enum(['fie', 'free']).optional(),
  /** Pistes dont l'appareil est ignoré pour cette épreuve (docs/adr/0023) */
  manualStrips: z.array(z.number().int().min(1).max(100)).max(100).optional(),
});

/** Fusion de réglages (createCompetition, updateCompetitionSettings) : clés connues, valeurs vérifiées */
export const CompetitionSettingsPatchSchema = CompetitionSettingsSchema.partial();

/** Épreuve exposée par le contrat : dates en ISO 8601, sans tireurs ni arbitres */
export const CompetitionSchema = z.object({
  id: z.string(),
  title: z.string(),
  shortTitle: z.string().nullable(),
  date: z.string(),
  location: z.string().nullable(),
  organizer: z.string().nullable(),
  weapon: z.enum(Weapon),
  gender: z.enum(Gender),
  category: z.enum(Category),
  championship: z.string().nullable(),
  color: z.string().nullable(),
  isTeamEvent: z.boolean(),
  status: z.enum(['draft', 'in_progress', 'completed', 'cancelled']).nullable(),
  fencerCount: z.number().int().nullable(),
  /** Réglages tels qu'enregistrés (anciennes épreuves : clés éventuellement absentes) */
  settings: CompetitionSettingsSchema.partial(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// Le schéma couvre exactement CompetitionSettings (vérifié à la compilation)
type SchemaKeys = keyof z.infer<typeof CompetitionSettingsSchema>;
type Exact = [SchemaKeys] extends [keyof CompetitionSettings]
  ? [keyof CompetitionSettings] extends [SchemaKeys]
    ? true
    : false
  : false;
export const settingsSchemaIsExact: Exact = true;
