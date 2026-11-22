/**
 * BellePoule Modern - Contrat d'API unique (#1981, lot 1)
 * Chaque opération est décrite une seule fois : entrée (validée par zod), sortie, droit requis,
 * exposition MCP. Les adaptateurs IPC (src/main/engine/api/ipcAdapter.ts) et MCP
 * (src/main/engine/api/mcpAdapter.ts) en sont dérivés ; l'écran appelle un BpmClient
 * (src/shared/api/client.ts) au lieu de window.electronAPI.
 * Le renderer n'importe que les types (import type) : zod reste dans le bundle main.
 * Licensed under GPL-3.0
 */
import { z } from 'zod';
import { JournalEventSchema } from './events';
import { Category, Gender, Weapon, type Fencer, type Pool, type PoolRanking } from '../types';
import type { ConsolationBracket, FinalResult, TableauMatch } from '../domain/tableau/tableauTypes';
import type { RapieresLegacyState, RapieresSession } from '../domain/rapieres/rapieres.types';

/** Droits (utilisés par le sous-ticket 4, rôles et permissions) */
export type Permission =
  | 'competition:read'
  | 'competition:write'
  | 'fencers:write'
  | 'score:write'
  | 'cards:read'
  | 'referees:write';

export type OperationKind = 'command' | 'query' | 'subscription';

/** Exposition comme outil MCP : écriture pour une commande, lecture pour une requête */
export interface McpExposure {
  name: string;
  title: string;
  destructive?: boolean;
  idempotent?: boolean;
}

export interface OperationDef<
  K extends OperationKind = OperationKind,
  I extends z.ZodType = z.ZodType,
  O extends z.ZodType = z.ZodType,
> {
  kind: K;
  /** Description (documentation, outil MCP) */
  description: string;
  input: I;
  output: O;
  permission: Permission;
  mcp?: McpExposure;
}

type Def<K extends OperationKind, I extends z.ZodType, O extends z.ZodType> = Omit<
  OperationDef<K, I, O>,
  'kind'
>;

export const command = <I extends z.ZodType, O extends z.ZodType>(d: Def<'command', I, O>) => ({
  kind: 'command' as const,
  ...d,
});
export const query = <I extends z.ZodType, O extends z.ZodType>(d: Def<'query', I, O>) => ({
  kind: 'query' as const,
  ...d,
});
export const subscription = <I extends z.ZodType, O extends z.ZodType>(
  d: Omit<Def<'subscription', I, O>, 'mcp'>
) => ({ kind: 'subscription' as const, ...d });

export type ApiContract = Record<string, OperationDef>;

// ─── Schémas communs ─────────────────────────────────────────────────────────

const Id = z.string().trim().min(1).max(200);
const CompetitionId = Id.describe('Identifiant de la compétition (list_competitions)');
const DryRun = z.boolean().optional().describe('Décrit le résultat sans rien écrire');
const Side = z.enum(['A', 'B']);
const FencerKey = z.union([Id, z.number().int().min(0)]);
const ExpectedRevision = z
  .number()
  .int()
  .min(0)
  .optional()
  .describe(
    'Révision attendue du journal de l’épreuve : refus « revision_conflict » si une autre commande du contrat a écrit entre-temps. Les écritures qui ne passent pas encore par le contrat (écran, tablettes) ne sont pas détectées.'
  );
const CommandId = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .optional()
  .describe(
    'Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau)'
  );
/** Révision du journal après la commande (absente si rien n'a été écrit) */
const Revision = z.number().int().optional();

const NeutralityCriterion = z.enum(['club', 'nationality', 'region']);
const Neutrality = z.object({
  club: z.boolean().optional().describe('Pas d’arbitre du club d’un tireur'),
  nationality: z.boolean().optional().describe('Pas d’arbitre de la nation d’un tireur'),
  region: z.boolean().optional().describe('Pas d’arbitre de la ligue d’un tireur'),
});
const ResolvedRefereeing = z.object({
  neutrality: z.object({ club: z.boolean(), nationality: z.boolean(), region: z.boolean() }),
  balance: z.boolean(),
  maxConsecutiveMatches: z.number(),
  minRestTimeMinutes: z.number(),
});

/**
 * État de l'épreuve (projection du moteur, docs/adr/0017). Les objets du domaine (poules,
 * matchs de tableau…) sont typés par leurs interfaces : z.custom, sans contrôle à l'exécution.
 * Les champs d'interface (phase affichée, paramètres de préparation, pistes) sortent à l'étape 4b.
 */
/** Écart entre le journal rejoué et l'état (compareWithState) : identifiants et nombres seulement */
const DivergenceSchema = z.object({
  kind: z.string(),
  id: z.string(),
  expected: z.unknown().optional(),
  actual: z.unknown().optional(),
});

/** Valeur de score d'une ligne du journal des matchs */
const ScoreValue = z.object({ value: z.number().nullable() }).nullable();

/** Statistiques d'un tireur dans son épreuve (touches, cartons, sorties d'arène, durées) */
const FencerStatsSchema = z.object({
  fencerId: z.string(),
  fencerLastName: z.string(),
  fencerFirstName: z.string(),
  fencerClub: z.string().optional(),
  competitionId: z.string(),
  touchesZoneA: z.number(),
  touchesZoneB: z.number(),
  touchesZoneC: z.number(),
  totalTouchPoints: z.number(),
  receivedZoneA: z.number(),
  receivedZoneB: z.number(),
  receivedZoneC: z.number(),
  receivedTouchPoints: z.number(),
  whiteCards: z.number(),
  yellowCards: z.number(),
  redCards: z.number(),
  blackCards: z.number().optional(),
  cardsByReason: z.record(z.string(), z.number()),
  arenaExits: z.number(),
  matchesPlayed: z.number(),
  totalDurationSeconds: z.number(),
  averageDurationSeconds: z.number(),
  matchesFinishedEarly: z.number(),
});

/** Ligne du journal d'un match (scores, touches, cartons, sorties d'arène) */
const MatchEventEntrySchema = z.object({
  id: z.string(),
  matchId: z.string(),
  eventType: z.enum(['score_change', 'touch', 'card', 'arena_exit']),
  timestamp: z.string(),
  fencerId: z.string().nullable(),
  fencerLastName: z.string().nullable(),
  fencerFirstName: z.string().nullable(),
  fencerSide: z.enum(['A', 'B']).nullable(),
  previousScoreA: ScoreValue,
  previousScoreB: ScoreValue,
  newScoreA: ScoreValue,
  newScoreB: ScoreValue,
  changedBy: z.string().nullable(),
  refereeName: z.string().nullable(),
  ipAddress: z.string().nullable(),
  changeReason: z.string().nullable(),
  zone: z.string().nullable(),
  points: z.number().nullable(),
  cardType: z.string().nullable(),
  cardReason: z.string().nullable(),
  cardGroup: z.number().nullable(),
  resultingExclusion: z.boolean().nullable(),
  exitType: z.string().nullable(),
});

/** Tireur exposé par le contrat (docs/adr/0018) : dates en ISO 8601 */
const FencerSchema = z.object({
  id: z.string(),
  ref: z.number(),
  lastName: z.string(),
  firstName: z.string(),
  birthDate: z.string().nullable(),
  gender: z.string(),
  nationality: z.string(),
  region: z.string().nullable(),
  department: z.string().nullable(),
  club: z.string().nullable(),
  license: z.string().nullable(),
  ranking: z.number().nullable(),
  handedness: z.enum(['R', 'L']).nullable(),
  status: z.string(),
  exclusionReason: z.string().nullable(),
  seedNumber: z.number().nullable(),
  initialRanking: z.number().nullable(),
  finalRanking: z.number().nullable(),
  photo: z.string().nullable(),
});

const Text = z.string().trim().max(200);
/** Identité d'un tireur, sans règle (updateFencerDetails, registerFencers) */
const FencerDetailsShape = {
  birthDate: z.string().date().nullable().optional().describe('AAAA-MM-JJ ; null : effacée'),
  gender: z.enum(['M', 'F', 'X']).optional(),
  nationality: z.string().trim().min(2).max(3).optional().describe('Code ISO (FRA)'),
  region: Text.nullable().optional(),
  department: z.string().trim().max(3).nullable().optional(),
  club: Text.nullable().optional(),
  license: z.string().trim().max(40).nullable().optional(),
  handedness: z.enum(['R', 'L']).optional(),
  photo: z.string().max(2_000_000).nullable().optional().describe('Image en base64'),
};

/** Arbitre exposé par le contrat (listReferees, commandes d'inscription, docs/adr/0018) */
const RefereeSchema = z.object({
  id: z.string(),
  ref: z.number(),
  firstName: z.string(),
  lastName: z.string(),
  gender: z.string(),
  club: z.string().nullable(),
  license: z.string().nullable(),
  nationality: z.string().nullable(),
  region: z.string().nullable(),
  category: z.string().nullable(),
  status: z.enum(['available', 'assigned', 'unavailable']),
});

/** Identité d'un arbitre, sans règle */
const RefereeDetailsShape = {
  firstName: Text.optional(),
  gender: z.enum(['M', 'F', 'X']).optional(),
  nationality: z.string().trim().min(2).max(3).optional().describe('Code ISO (FRA)'),
  club: Text.nullable().optional(),
  license: z.string().trim().max(40).nullable().optional(),
  category: Text.nullable().optional().describe('Niveau : régional, national, international…'),
};

const WeaponEnum = z.enum(Weapon);
const GenderEnum = z.enum(Gender);
const CategoryEnum = z.enum(Category);
/**
 * Réglages d'une épreuve (fusion de premier niveau) : clés de CompetitionSettings vérifiées par le
 * moteur (« unknown_setting »), valeurs libres tant que la formule n'a pas son schéma (ADR-0012)
 */
const SettingsPatch = z.record(z.string(), z.unknown());

const CompetitionStateSchema = z.object({
  currentPhase: z.number().int(),
  pools: z.array(z.custom<Pool>()),
  poolHistory: z.array(z.array(z.custom<Pool>())),
  appelHistory: z.array(z.array(z.custom<Fencer>())),
  overallRanking: z.array(z.custom<PoolRanking>()),
  tableauMatches: z.array(z.custom<TableauMatch>()),
  finalResults: z.array(z.custom<FinalResult>()),
  consolationBrackets: z.array(z.custom<ConsolationBracket>()),
  currentPoolRound: z.number().int(),
  skipPoolPhase: z.boolean(),
  poolsLaunched: z.boolean().optional(),
  remoteArenaCount: z.number().int().optional(),
  remoteStripStart: z.number().int().optional(),
  rapieres: z.custom<RapieresSession | RapieresLegacyState>().optional(),
  poolPrepParams: z
    .object({
      poolCount: z.number(),
      minFencersPerPool: z.number(),
      maxFencersPerPool: z.number(),
    })
    .optional(),
});
export type CompetitionStateDTO = z.infer<typeof CompetitionStateSchema>;

const RapieresFencerSchema = z.object({
  firstName: z.string().max(200),
  lastName: z.string().max(200),
  category: z.enum(['M20', 'SENIOR', 'V1', 'V2', 'V3', 'V4', 'HANDI']),
  gender: z.enum(['M', 'F']).optional(),
  birthDate: z.string().max(10).optional(),
});

const FencerRefSchema = z.object({
  id: z.string(),
  lastName: z.string(),
  firstName: z.string(),
  club: z.string().nullable(),
});

const MatchCard = z.object({
  id: z.string(),
  fencerId: z.string(),
  cardType: z.string(),
  reason: z.string(),
  cardGroup: z.number(),
  timestamp: z.string(),
  pointsAwarded: z.number(),
  resultingExclusion: z.boolean(),
});

// ─── Contrat ─────────────────────────────────────────────────────────────────

export const contract = {
  checkIn: command({
    description:
      'Pointe (présent) ou dépointe des tireurs d’une épreuve, par identifiant ou numéro de dossard (ref).',
    input: z.object({
      competitionId: CompetitionId,
      fencers: z.array(FencerKey).min(1).max(1000).describe('Identifiants ou numéros (ref)'),
      present: z.boolean().describe('true : présent ; false : absent'),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      status: z.string(),
      matched: z.number(),
      updated: z.number(),
      skipped: z.number(),
      unknown: z.array(z.union([z.string(), z.number()])),
      revision: Revision,
    }),
    permission: 'fencers:write',
    mcp: { name: 'check_in', title: 'Pointer des tireurs', idempotent: true },
  }),

  recordScore: command({
    description:
      'Score d’un match de poule (tour courant) ou de tableau, tableaux de classement compris (matchId : list_matches), mêmes contrôles que l’écran : score maximum, égalité tranchée par « winner » (ou « priority » en poule), statut spécial du perdant. ' +
      'Classements recalculés ; au tableau, le vainqueur passe au tour suivant. Ne saisir que des scores donnés par le DT ; « dryRun: true » contrôle le score sans l’écrire.',
    input: z.object({
      competitionId: CompetitionId,
      matchId: Id.describe('Identifiant du match (list_matches)'),
      scoreA: z.number().int().min(0).max(99).describe('Touches du tireur A'),
      scoreB: z.number().int().min(0).max(99).describe('Touches du tireur B'),
      winner: Side.optional().describe('Vainqueur imposé'),
      specialStatus: z
        .enum(['abandon', 'forfait', 'exclusion'])
        .optional()
        .describe('Statut du perdant'),
      blackCard: z
        .boolean()
        .optional()
        .describe('Exclusion sur carton noir (motif du rapport fédéral)'),
      correction: z
        .object({
          reason: z
            .string()
            .trim()
            .min(1)
            .max(300)
            .describe('Motif, inscrit au journal des scores'),
          rebuildTableau: z
            .boolean()
            .optional()
            .describe('Retirer le tableau pour le refaire sur le classement corrigé'),
        })
        .optional()
        .describe('Correction d’un score de poule après le tirage du tableau (#1996)'),
      priority: Side.optional().describe('Égalité en poule : prioritaire'),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.looseObject({
      dryRun: z.boolean(),
      kind: z.enum(['pool', 'bracket']),
      revision: Revision,
    }),
    permission: 'score:write',
    mcp: { name: 'record_score', title: 'Saisir un score', idempotent: true },
  }),

  generatePools: command({
    description:
      'Poules du tour courant, lancées (phase Poules). Sans « composition » : tirage sur les tireurs pointés par la même fonction que l’écran (serpentin sur le classement, puis clubs et régions séparés, ou les critères de « separation »), poule n sur la piste n ; épreuve individuelle, un tour de poules. ' +
      'Avec « composition » : poules et ordre des matchs retenus par le DT à la préparation, tels quels (tous formats individuels, tours multiples compris). ' +
      '« replace: true » efface des poules déjà jouées ou un tableau : accord du DT indispensable.',
    input: z.object({
      competitionId: CompetitionId,
      poolCount: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe('Nombre de poules (défaut : optimal)'),
      minPerPool: z
        .number()
        .int()
        .min(3)
        .max(12)
        .optional()
        .describe('Tireurs par poule, minimum (défaut 5)'),
      maxPerPool: z
        .number()
        .int()
        .min(3)
        .max(12)
        .optional()
        .describe('Tireurs par poule, maximum (défaut 7)'),
      separation: z
        .array(z.enum(['byRanking', 'byClub', 'byRegion', 'byNation']))
        .optional()
        .describe(
          'Critères actifs, par priorité (comme l’écran) : avant « byRanking », ils priment sur le classement ; après, échanges dans le chapeau. Défaut : ["byRanking", "byClub", "byRegion"]'
        ),
      composition: z
        .array(
          z.object({
            poolId: Id,
            number: z.number().int().min(1),
            strip: z.number().int().min(1).nullable().optional(),
            fencerIds: z.array(Id).min(2).max(30),
            matches: z.array(z.object({ matchId: Id, fencerAId: Id, fencerBId: Id })).max(500),
          })
        )
        .min(1)
        .max(200)
        .optional()
        .describe('Poules préparées par le DT (écran) : pas de tirage'),
      replace: z.boolean().optional().describe('Remplacer des poules ou un tableau existants'),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      round: z.number().int(),
      fencerCount: z.number().int(),
      poolCount: z.number().int(),
      pools: z.array(
        z.object({
          number: z.number().int(),
          strip: z.number().int().nullable(),
          fencers: z.array(
            z.object({
              id: z.string(),
              lastName: z.string(),
              firstName: z.string(),
              club: z.string().nullable(),
              ranking: z.number().nullable(),
            })
          ),
          matchCount: z.number().int(),
        })
      ),
      revision: Revision,
    }),
    permission: 'score:write',
    mcp: { name: 'generate_pools', title: 'Générer les poules', destructive: true },
  }),

  addPoolFencer: command({
    description:
      'Ajoute un tireur à une poule lancée (tireur arrivé en retard) : un match contre chaque tireur de la poule, à la suite des matchs existants. Refus si le tableau est tiré ou si le tireur est déjà placé.',
    input: z.object({
      competitionId: CompetitionId,
      poolId: Id.describe('Identifiant de la poule'),
      fencerId: Id.describe('Identifiant du tireur'),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      poolId: z.string(),
      poolNumber: z.number().int(),
      fencerId: z.string(),
      matchIds: z.array(z.string()),
      revision: Revision,
    }),
    permission: 'score:write',
    mcp: { name: 'add_pool_fencer', title: 'Ajouter un tireur à une poule' },
  }),

  closePoolRound: command({
    description:
      'Clôt le tour de poules courant (toutes les poules terminées) : qualifiés selon le classement du tour (formule, puis réglage du nombre de qualifiés, ou « qualifierCount »), non-qualifiés éliminés, tour archivé ; le tour suivant se pointe puis se tire. ' +
      '« dryRun: true » donne le nombre de qualifiés et d’éliminés sans rien écrire. Refus sous 4 qualifiés.',
    input: z.object({
      competitionId: CompetitionId,
      qualifierCount: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .optional()
        .describe('Nombre de qualifiés imposé'),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      round: z.number().int(),
      nextRound: z.number().int(),
      qualifierCount: z.number().int().nullable(),
      qualified: z.number().int(),
      eliminated: z.number().int(),
      revision: Revision,
    }),
    permission: 'score:write',
    mcp: { name: 'close_pool_round', title: 'Clore le tour de poules', destructive: true },
  }),

  generateTableau: command({
    description:
      'Tableau d’élimination directe. Sans « composition » : construit depuis le classement après poules (tireurs éliminés, abandons, forfaits et exclus écartés), avec ou sans petite finale (épreuve individuelle, un tour, tableau simple). ' +
      'Avec « composition » : placement calculé par l’écran (barrages, exemptions, rangs de sortie de poules), tel quel. « replace: true » efface un tableau déjà joué : accord du DT indispensable.',
    input: z.object({
      competitionId: CompetitionId,
      thirdPlaceMatch: z.boolean().optional().describe('Match pour la 3e place'),
      composition: z
        .array(
          z.object({
            matchId: Id,
            round: z.number().int().min(2).max(1024),
            position: z.number().int().min(0).max(1024),
            fencerAId: Id.nullable(),
            fencerBId: Id.nullable(),
            isBye: z.boolean(),
            seedA: z.number().int().nullable().optional(),
            seedB: z.number().int().nullable().optional(),
          })
        )
        .min(1)
        .max(2048)
        .optional()
        .describe('Placement calculé par l’écran : pas de planification'),
      rapieresTableauMode: z
        .enum(['normal', 'third', 'all', 'semis'])
        .optional()
        .describe('Tournoi des rapières : mode de tableau choisi'),
      replace: z.boolean().optional().describe('Remplacer un tableau existant'),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      size: z.number().int(),
      qualified: z.number().int(),
      thirdPlaceMatch: z.boolean(),
      firstRound: z.array(
        z.object({
          id: z.string(),
          round: z.number().int(),
          position: z.number().int(),
          fencerA: FencerRefSchema.nullable(),
          fencerB: FencerRefSchema.nullable(),
          scoreA: z.number().nullable(),
          scoreB: z.number().nullable(),
          winner: FencerRefSchema.nullable(),
          isBye: z.boolean(),
          state: z.enum(['pending', 'ready', 'done']),
          strip: z.number().nullable(),
        })
      ),
      revision: Revision,
    }),
    permission: 'score:write',
    // Nom de l'outil publié en 2.0 conservé (docs/adr/0008)
    mcp: { name: 'build_bracket', title: 'Construire le tableau', destructive: true },
  }),

  launchRapieresWave: command({
    description:
      'Tournoi des rapières : lance la vague « wave » (ses matchs deviennent ceux à tirer ; 0 = aucune vague lancée).',
    input: z.object({
      competitionId: CompetitionId,
      wave: z.number().int().min(0).max(200).describe('Vague à lancer (0 : aucune)'),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      wave: z.number().int(),
      matchIds: z.array(z.string()),
      revision: Revision,
    }),
    permission: 'score:write',
    mcp: { name: 'launch_rapieres_wave', title: 'Lancer une vague (rapières)' },
  }),

  setRapieresTeams: command({
    description:
      'Tournoi des rapières : composition des équipes (binômes ; l’équipe est un tireur de l’épreuve) : niveau, deux tireurs, club, région.',
    input: z.object({
      competitionId: CompetitionId,
      teams: z
        .array(
          z.object({
            fencerId: Id.describe('Tireur de l’épreuve portant l’équipe'),
            info: z.object({
              level: z.enum(['beginner', 'intermediate', 'expert']),
              fencers: z.tuple([RapieresFencerSchema, RapieresFencerSchema]),
              club: z.string().max(200).optional(),
              region: z.string().max(200).optional(),
            }),
          })
        )
        .min(1)
        .max(1000),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({ dryRun: z.boolean(), teams: z.number().int(), revision: Revision }),
    permission: 'fencers:write',
    mcp: {
      name: 'set_rapieres_teams',
      title: 'Composition des équipes (rapières)',
      idempotent: true,
    },
  }),

  endRapieresWaves: command({
    description:
      'Tournoi des rapières : arrête les vagues avant leur terme (« ended: true », passage au classement sur les matchs joués) ou les reprend (« ended: false »).',
    input: z.object({
      competitionId: CompetitionId,
      ended: z.boolean().describe('true : vagues arrêtées ; false : reprises'),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({ dryRun: z.boolean(), ended: z.boolean(), revision: Revision }),
    permission: 'score:write',
    mcp: { name: 'end_rapieres_waves', title: 'Arrêter ou reprendre les vagues (rapières)' },
  }),

  clearScore: command({
    description:
      'Annule le score d’un match : match de poule remis à jouer (classements recalculés), ou match de tableau rouvert (vainqueur retiré du tour suivant). Refus si le tour suivant est joué, ou pour une poule une fois le tableau tiré.',
    input: z.object({
      competitionId: CompetitionId,
      matchId: Id.describe('Identifiant du match (list_matches)'),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      kind: z.enum(['pool', 'bracket']),
      matchId: z.string(),
      revision: Revision,
    }),
    permission: 'score:write',
    mcp: { name: 'clear_score', title: 'Annuler un score', destructive: true },
  }),

  assignMatches: command({
    description:
      'Arbitres et pistes : d’une poule (« pools » : piste, arbitres principal en tête, l’arbitre principal passant sur les matchs de la poule) ou d’un match (« matches » : arbitre principal ; piste pour un match de tableau). Seuls les champs fournis changent.',
    input: z.object({
      competitionId: CompetitionId,
      pools: z
        .array(
          z.object({
            poolId: Id,
            strip: z.number().int().min(1).max(999).nullable().optional(),
            refereeIds: z.array(Id).max(10).optional(),
          })
        )
        .max(200)
        .optional(),
      matches: z
        .array(
          z.object({
            matchId: Id,
            strip: z.number().int().min(1).max(999).nullable().optional(),
            refereeId: Id.nullable().optional(),
          })
        )
        .max(2000)
        .optional(),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      pools: z.number().int(),
      matches: z.number().int(),
      revision: Revision,
    }),
    permission: 'referees:write',
    mcp: {
      name: 'assign_matches',
      title: 'Arbitres et pistes des poules et des matchs',
      idempotent: true,
    },
  }),

  adjustRanking: command({
    description:
      'Classement après poules ajusté par le DT : rang (et points Quest) de chaque tireur, répercutés dans les classements de poule. Le classement complet est fourni, dans l’ordre.',
    input: z.object({
      competitionId: CompetitionId,
      ranking: z
        .array(
          z.object({
            fencerId: Id,
            rank: z.number().int().min(1),
            questPoints: z.number().optional(),
          })
        )
        .min(1)
        .max(2000),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({ dryRun: z.boolean(), fencers: z.number().int(), revision: Revision }),
    permission: 'score:write',
    mcp: { name: 'adjust_ranking', title: 'Ajuster le classement après poules', destructive: true },
  }),

  skipPools: command({
    description:
      'Épreuve sans poules : classement initial sur les tireurs pointés (ordre fourni, sinon classement d’entrée), puis tableau.',
    input: z.object({
      competitionId: CompetitionId,
      fencerIds: z.array(Id).min(2).max(2000).optional().describe('Ordre du classement initial'),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({ dryRun: z.boolean(), fencers: z.number().int(), revision: Revision }),
    permission: 'score:write',
    mcp: { name: 'skip_pools', title: 'Passer les poules', destructive: true },
  }),

  clearTableau: command({
    description:
      'Retire le tableau (et les tableaux de classement) : il est refait sur le classement courant à l’ouverture de l’onglet Tableau. Accord du DT indispensable si des matchs sont joués.',
    input: z.object({
      competitionId: CompetitionId,
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({ dryRun: z.boolean(), cleared: z.number().int(), revision: Revision }),
    permission: 'score:write',
    mcp: { name: 'clear_tableau', title: 'Retirer le tableau', destructive: true },
  }),

  rebuildCompetitionState: command({
    description:
      'Maintenance (docs/adr/0017) : rejoue le journal de l’épreuve et le compare à son état. ' +
      '« dryRun: true » (conseillé d’abord) rend les écarts sans rien écrire. Sinon l’état est aligné sur le journal pour les faits rejouables : ' +
      'statuts des tireurs, scores de poule du tour courant, décisions du tableau et des tableaux de classement, vagues des rapières ; classements et classement final recalculés. ' +
      'Les écarts de structure (poules, tours, placement du tableau) et les abandons sans touches restent dans « remaining ». Journal incomplet (épreuve antérieure) : statuts seuls.',
    input: z.object({
      competitionId: CompetitionId,
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      /** Journal complet : il commence par un tirage (sinon les tables font foi) */
      complete: z.boolean(),
      revision: Revision,
      divergences: z.array(DivergenceSchema),
      repaired: z.array(z.object({ kind: z.string(), id: z.string() })),
      remaining: z.array(DivergenceSchema),
    }),
    permission: 'score:write',
    mcp: {
      name: 'rebuild_competition_state',
      title: 'Vérifier et réparer l’état d’une épreuve',
      destructive: true,
    },
  }),

  createCompetition: command({
    description:
      'Crée une épreuve (docs/adr/0018) : réglages par défaut calculés par le moteur pour l’arme et la catégorie, puis réglages choisis fusionnés (« settings »).',
    input: z.object({
      title: Text.min(1),
      date: z.string().describe('AAAA-MM-JJ ou ISO 8601'),
      weapon: WeaponEnum,
      gender: GenderEnum,
      category: CategoryEnum,
      location: Text.optional(),
      color: z.string().max(20).optional(),
      isTeamEvent: z.boolean().optional(),
      settings: SettingsPatch.optional(),
      dryRun: DryRun,
      commandId: CommandId,
    }),
    output: z.object({ dryRun: z.boolean(), competitionId: z.string().nullable() }),
    permission: 'competition:write',
  }),

  updateCompetitionDetails: command({
    description: 'Titre, date, lieu et organisateur d’une épreuve : données sans règle.',
    input: z.object({
      competitionId: CompetitionId,
      details: z.strictObject({
        title: Text.min(1).optional(),
        date: z.string().optional(),
        location: Text.nullable().optional(),
        organizer: Text.nullable().optional(),
      }),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      competitionId: z.string(),
      changed: z.array(z.string()),
      revision: Revision,
    }),
    permission: 'competition:write',
  }),

  updateCompetitionSettings: command({
    description:
      'Arme, sexe, catégorie, format par équipes et réglages (fusion de premier niveau, clé inconnue refusée). ' +
      'Arme, format par équipes, mode spécial et formule à la carte figés (« draw_done ») après le tirage. Tablettes prévenues.',
    input: z.object({
      competitionId: CompetitionId,
      weapon: WeaponEnum.optional(),
      gender: GenderEnum.optional(),
      category: CategoryEnum.optional(),
      isTeamEvent: z.boolean().optional(),
      settings: SettingsPatch.optional(),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      competitionId: z.string(),
      changed: z.array(z.string()),
      revision: Revision,
    }),
    permission: 'competition:write',
  }),

  deleteCompetition: command({
    description:
      'Supprime une épreuve et toutes ses données (RGPD) ; sa saisie distante est arrêtée. Résultats déjà versés au classement de saison conservés.',
    input: z.object({
      competitionId: CompetitionId,
      dryRun: DryRun,
      commandId: CommandId,
    }),
    output: z.object({ dryRun: z.boolean(), competitionId: z.string() }),
    permission: 'competition:write',
  }),

  registerFencers: command({
    description:
      'Inscrit un ou plusieurs tireurs (docs/adr/0018). Statut initial : non pointé (défaut) ou pointé. ' +
      'Doublons (même licence, sinon mêmes nom et prénom) signalés dans « duplicates », pas refusés.',
    input: z.object({
      competitionId: CompetitionId,
      fencers: z
        .array(
          z.object({
            lastName: Text.min(1),
            firstName: Text.min(1),
            ...FencerDetailsShape,
            ranking: z.number().int().min(1).nullable().optional(),
            status: z.enum(['N', 'P']).optional(),
          })
        )
        .min(1)
        .max(2000),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      fencers: z.array(FencerSchema),
      duplicates: z.array(z.object({ index: z.number().int(), fencerId: z.string() })),
      revision: Revision,
    }),
    permission: 'fencers:write',
  }),

  updateFencerDetails: command({
    description:
      'Identité d’un tireur : nom, prénom, naissance, sexe, nation, ligue, club, licence, latéralité, photo. ' +
      'Jamais le statut, le classement ni un score (docs/adr/0018).',
    input: z.object({
      competitionId: CompetitionId,
      fencerId: Id,
      // Strict : statut, classement ou score refusés à l'entrée (docs/adr/0018)
      details: z.strictObject({
        lastName: Text.min(1).optional(),
        firstName: Text.min(1).optional(),
        ...FencerDetailsShape,
      }),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({ dryRun: z.boolean(), fencer: FencerSchema, revision: Revision }),
    permission: 'fencers:write',
  }),

  setFencerRankings: command({
    description:
      'Classement d’entrée des tireurs (null : sans classement). Refusé (« draw_done ») une fois les poules tirées ou le tableau généré.',
    input: z.object({
      competitionId: CompetitionId,
      rankings: z
        .array(z.object({ fencerId: Id, ranking: z.number().int().min(1).nullable() }))
        .min(1)
        .max(5000),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      updated: z.number().int(),
      unknown: z.array(z.string()),
      revision: Revision,
    }),
    permission: 'fencers:write',
  }),

  unregisterFencers: command({
    description:
      'Désinscrit des tireurs (« fencerIds ») ou tous (« all »). Avant le tirage seulement ; après, retirer le tireur (withdrawFencer).',
    input: z.object({
      competitionId: CompetitionId,
      fencerIds: z.array(Id).max(5000).optional(),
      all: z.boolean().optional(),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      removed: z.array(z.string()),
      unknown: z.array(z.string()),
      revision: Revision,
    }),
    permission: 'fencers:write',
  }),

  registerReferees: command({
    description:
      'Inscrit un ou plusieurs arbitres, non pointés (docs/adr/0018). Doublons (licence, ou nom et prénom) signalés dans « duplicates », pas refusés.',
    input: z.object({
      competitionId: CompetitionId,
      referees: z
        .array(z.object({ lastName: Text.min(1), ...RefereeDetailsShape }))
        .min(1)
        .max(1000),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      referees: z.array(RefereeSchema),
      duplicates: z.array(z.object({ index: z.number().int(), refereeId: z.string() })),
      revision: Revision,
    }),
    permission: 'referees:write',
  }),

  updateRefereeDetails: command({
    description:
      'Identité d’un arbitre : nom, prénom, sexe, nation, club, licence, niveau. Jamais sa disponibilité (setRefereeAvailability).',
    input: z.object({
      competitionId: CompetitionId,
      refereeId: Id,
      details: z.strictObject({ lastName: Text.min(1).optional(), ...RefereeDetailsShape }),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({ dryRun: z.boolean(), referee: RefereeSchema, revision: Revision }),
    permission: 'referees:write',
  }),

  setRefereeAvailability: command({
    description:
      'Pointage des arbitres : disponibles (« available: true ») ou non pointés. Même effet que l’appel distant.',
    input: z.object({
      competitionId: CompetitionId,
      refereeIds: z.array(Id).min(1).max(1000),
      available: z.boolean(),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      status: z.enum(['available', 'unavailable']),
      updated: z.number().int(),
      unknown: z.array(z.string()),
      revision: Revision,
    }),
    permission: 'referees:write',
  }),

  unregisterReferee: command({
    description: 'Désinscrit un arbitre. Refusé (« referee_busy ») s’il arbitre un match en cours.',
    input: z.object({
      competitionId: CompetitionId,
      refereeId: Id,
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({ dryRun: z.boolean(), refereeId: z.string(), revision: Revision }),
    permission: 'referees:write',
  }),

  withdrawFencer: command({
    description:
      'Retire un tireur de l’épreuve : abandon (médical), forfait ou exclusion (« blackCard » : carton noir). ' +
      'À l’appel : statut seul. En poules : ses matchs non disputés sont perdus (DNS s’il n’a commencé aucun match). ' +
      'Au tableau : son match en cours est perdu, l’adversaire passe. Refus si le tableau est terminé ou si l’adversaire n’est pas encore connu. ' +
      '« dryRun: true » donne les matchs perdus sans rien écrire. Annulation : reinstate_fencer.',
    input: z.object({
      competitionId: CompetitionId,
      fencerId: Id.describe('Identifiant du tireur'),
      reason: z.enum(['abandon', 'forfait', 'exclusion']).describe('Motif du retrait'),
      blackCard: z.boolean().optional().describe('Exclusion sur carton noir (rapport fédéral)'),
      matchId: Id.optional().describe('Match où le retrait a lieu (carton, abandon sur la piste)'),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      fencerId: z.string(),
      status: z.string(),
      exclusionReason: z.enum(['black_card', 'dns']).nullable(),
      phase: z.enum(['checkin', 'pools', 'tableau']),
      forfeitedMatchIds: z.array(z.string()),
      revision: Revision,
    }),
    permission: 'fencers:write',
    mcp: { name: 'withdraw_fencer', title: 'Retirer un tireur', destructive: true },
  }),

  reinstateFencer: command({
    description:
      'Annule le retrait d’un tireur (abandon, forfait, exclusion) : statut et matchs d’avant le retrait. ' +
      'Refus si un match qui suit a été joué depuis, ou si le tableau a été tiré après un retrait en poules.',
    input: z.object({
      competitionId: CompetitionId,
      fencerId: Id.describe('Identifiant du tireur'),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      fencerId: z.string(),
      status: z.string(),
      restoredMatchIds: z.array(z.string()),
      revision: Revision,
    }),
    permission: 'fencers:write',
    mcp: { name: 'reinstate_fencer', title: 'Réintégrer un tireur' },
  }),

  setRefereeingSettings: command({
    description:
      'Réglages d’affectation des arbitres de l’épreuve (neutralité club / nation / ligue, équilibrage de la charge, rotation). Seuls les champs fournis changent ; les autres réglages de l’épreuve sont conservés.',
    input: z.object({
      competitionId: CompetitionId,
      neutrality: Neutrality.optional(),
      balance: z.boolean().optional().describe('Équilibrer la charge entre arbitres'),
      maxConsecutiveMatches: z.number().int().min(1).max(20).optional(),
      minRestTimeMinutes: z.number().int().min(0).max(240).optional(),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({ dryRun: z.boolean(), refereeing: ResolvedRefereeing, revision: Revision }),
    permission: 'referees:write',
    mcp: {
      name: 'set_refereeing_settings',
      title: 'Réglages d’affectation des arbitres',
      idempotent: true,
    },
  }),

  assignReferees: command({
    description:
      'Un arbitre principal par poule sans arbitre, parmi les arbitres pointés, par le même moteur que l’écran (affectation optimale, neutralité selon les réglages de l’épreuve ; un arbitre peut enchaîner plusieurs poules). Une poule sans arbitre neutre reste sans arbitre : « unassigned » donne les arbitres écartés et leurs raisons, « warnings » le résumé. « replace: true » réaffecte toutes les poules.',
    input: z.object({
      competitionId: CompetitionId,
      replace: z.boolean().optional().describe('Réaffecter toutes les poules'),
      includeUnchecked: z.boolean().optional().describe('Accepter les arbitres non pointés'),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      assignments: z.array(
        z.object({ poolNumber: z.number(), referee: z.string(), refereeId: z.string() })
      ),
      unassigned: z.array(
        z.object({
          poolNumber: z.number(),
          conflicts: z.array(
            z.object({
              referee: z.string(),
              refereeId: z.string(),
              reasons: z.array(NeutralityCriterion),
            })
          ),
        })
      ),
      warnings: z.array(z.string()),
      revision: Revision,
    }),
    permission: 'referees:write',
    mcp: { name: 'assign_referees', title: 'Arbitres des poules', idempotent: true },
  }),

  assignReferee: command({
    description:
      'Arbitre d’une poule choisi à la main : il remplace l’arbitre principal et passe sur les matchs de la poule. Un arbitre non neutre est accepté et signalé (« conflicts »). « refereeId: null » retire l’arbitre.',
    input: z.object({
      competitionId: CompetitionId,
      poolNumber: z.number().int().min(1).describe('Numéro de la poule'),
      refereeId: Id.nullable().describe('Identifiant de l’arbitre (list_referees), ou null'),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      poolNumber: z.number(),
      referee: z.string().nullable(),
      conflicts: z.array(NeutralityCriterion),
      warnings: z.array(z.string()),
      revision: Revision,
    }),
    permission: 'referees:write',
    mcp: { name: 'assign_referee', title: 'Arbitre d’une poule (à la main)', idempotent: true },
  }),

  listFencers: query({
    description: 'Tireurs inscrits à une épreuve, dans l’ordre des dossards (dates en ISO 8601).',
    input: z.object({ competitionId: CompetitionId }),
    output: z.array(FencerSchema),
    permission: 'competition:read',
  }),

  listReferees: query({
    description:
      'Arbitres d’une épreuve : identité, club, nationalité, niveau et disponibilité (« unavailable » : non pointé). Écran : choix de l’arbitre d’une poule ou d’un match.',
    input: z.object({ competitionId: CompetitionId }),
    output: z.array(RefereeSchema),
    permission: 'competition:read',
  }),

  listRefereeMatches: query({
    description:
      'Matchs de poule d’une épreuve avec leur arbitre : historique des arbitrages (numéro, poule, tireurs, score, statut).',
    input: z.object({ competitionId: CompetitionId }),
    output: z.array(
      z.object({
        matchId: z.string(),
        matchNumber: z.number(),
        poolName: z.string().nullable(),
        fencerAName: z.string(),
        fencerBName: z.string(),
        scoreA: z.number().nullable(),
        scoreB: z.number().nullable(),
        status: z.string(),
        refereeId: z.string().nullable(),
        refereeName: z.string().nullable(),
      })
    ),
    permission: 'competition:read',
  }),

  getMatchTimeline: query({
    description:
      'Journal d’un match en ordre chronologique : changements de score (auteur, motif), touches, cartons, sorties d’arène.',
    input: z.object({ matchId: Id }),
    output: z.array(MatchEventEntrySchema),
    permission: 'competition:read',
  }),

  getCompetitionTimeline: query({
    description: 'Journal de tous les matchs d’une épreuve, en ordre chronologique.',
    input: z.object({ competitionId: CompetitionId }),
    output: z.array(MatchEventEntrySchema),
    permission: 'competition:read',
  }),

  getPoolSignatures: query({
    description: 'Signatures de la feuille d’une poule (tablette) : une image par tireur.',
    input: z.object({ poolId: Id }),
    output: z.array(z.object({ fencerId: z.string(), signatureData: z.string() })),
    permission: 'competition:read',
  }),

  listFencerStats: query({
    description:
      'Statistiques de chaque tireur d’une épreuve : touches par zone, touches reçues, cartons, sorties d’arène, durée des matchs. Écran : onglet Statistiques, rapport de fin de tournoi.',
    input: z.object({ competitionId: CompetitionId }),
    output: z.array(FencerStatsSchema),
    permission: 'competition:read',
  }),

  getFencerStats: query({
    description: 'Statistiques d’un tireur (null si le tireur n’existe pas).',
    input: z.object({ fencerId: Id }),
    output: FencerStatsSchema.nullable(),
    permission: 'competition:read',
  }),

  getFencerHistory: query({
    description:
      'Historique d’un tireur : ses matchs (adversaire, scores, durée), avec touches et cartons de chacun.',
    input: z.object({ fencerId: Id }),
    output: z.object({
      matches: z.array(
        z.object({
          matchId: z.string(),
          number: z.number(),
          opponentId: z.string().nullable(),
          opponentLastName: z.string().nullable(),
          opponentFirstName: z.string().nullable(),
          scoreA: z.string().nullable(),
          scoreB: z.string().nullable(),
          side: z.enum(['A', 'B']),
          status: z.string(),
          startTime: z.string().nullable(),
          endTime: z.string().nullable(),
          duration: z.number().nullable(),
          poolId: z.string().nullable(),
          tableId: z.string().nullable(),
          round: z.number().nullable(),
          touches: z.array(
            z.object({
              id: z.string(),
              zone: z.string(),
              points: z.number(),
              timestamp: z.string(),
              isValidInSuddenDeath: z.boolean(),
              isReversed: z.boolean(),
            })
          ),
          cards: z.array(
            z.object({
              id: z.string(),
              cardType: z.string(),
              reason: z.string(),
              cardGroup: z.number(),
              timestamp: z.string(),
              pointsAwarded: z.number(),
              resultingExclusion: z.boolean(),
            })
          ),
        })
      ),
    }),
    permission: 'competition:read',
  }),

  listRefereeStats: query({
    description:
      'Statistiques des arbitres d’une épreuve : matchs arbitrés, durée moyenne, cartons, appels au DT, repos moyen entre deux matchs.',
    input: z.object({ competitionId: CompetitionId }),
    output: z.array(
      z.object({
        refereeId: z.string(),
        refereeName: z.string(),
        matchesCount: z.number(),
        averageDuration: z.number(),
        cardsYellow: z.number(),
        cardsRed: z.number(),
        cardsBlack: z.number(),
        dtCalls: z.number(),
        averageRestSeconds: z.number(),
      })
    ),
    permission: 'competition:read',
  }),

  listMatchTimings: query({
    description:
      'Horodatage des matchs d’une épreuve (début, fin, durée, piste, arbitre) pour les indicateurs d’organisation.',
    input: z.object({ competitionId: CompetitionId }),
    output: z.array(
      z.object({
        matchId: z.string(),
        poolId: z.string().nullable(),
        tableId: z.string().nullable(),
        fencerAId: z.string().nullable(),
        fencerBId: z.string().nullable(),
        status: z.string(),
        strip: z.number().nullable(),
        refereeId: z.string().nullable(),
        startTime: z.string().nullable(),
        endTime: z.string().nullable(),
        duration: z.number().nullable(),
      })
    ),
    permission: 'competition:read',
  }),

  listRemoteEvents: query({
    description:
      'Événements des saisies distantes d’une épreuve : appels au DT, déconnexions, synchronisations hors ligne, erreurs de synchronisation.',
    input: z.object({ competitionId: CompetitionId }),
    output: z.array(
      z.object({
        id: z.string(),
        competitionId: z.string(),
        type: z.enum(['dt_call', 'disconnect', 'offline_sync', 'sync_error']),
        arenaId: z.string().nullable(),
        matchId: z.string().nullable(),
        refereeId: z.string().nullable(),
        detail: z.string().nullable(),
        createdAt: z.string(),
      })
    ),
    permission: 'competition:read',
  }),

  getMatchCards: query({
    description: 'Cartons d’un match, en ordre chronologique.',
    input: z.object({ matchId: Id }),
    output: z.array(MatchCard),
    permission: 'cards:read',
  }),

  getCardsByMatchIds: query({
    description: 'Cartons de plusieurs matchs (feuilles imprimées), en ordre chronologique.',
    input: z.object({ matchIds: z.array(z.string()).max(5000) }),
    output: z.array(z.object({ matchId: z.string(), fencerId: z.string(), cardType: z.string() })),
    permission: 'cards:read',
  }),

  getCompetitionEvents: query({
    description:
      'Journal d’une épreuve (#1980) : événements postérieurs à la révision « since » (resynchronisation, audit), auteur, source et heure. Identifiants seulement, pas de noms.',
    input: z.object({
      competitionId: CompetitionId,
      since: z.number().int().min(0).optional().describe('Dernière révision connue (0 : tout)'),
      limit: z.number().int().min(1).max(5000).optional().describe('Nombre maximum (1000)'),
    }),
    output: z.object({ revision: z.number(), events: z.array(JournalEventSchema) }),
    permission: 'competition:read',
    mcp: { name: 'get_competition_events', title: 'Journal d’une épreuve' },
  }),

  getCompetitionState: query({
    description:
      'État de l’épreuve tenu par le moteur (docs/adr/0017) : poules, tours, tableau, tableaux de classement, classements, phase. ' +
      '« revision » : révision du journal, à comparer au signal journal:appended pour savoir s’il faut relire.',
    input: z.object({ competitionId: CompetitionId }),
    output: z.object({
      revision: z.number().int(),
      /** Compteur de l'état de session (sauvegarde de l'écran, jusqu'à l'étape 4c de l'ADR-0017) */
      sessionRevision: z.number().int(),
      state: CompetitionStateSchema.nullable(),
    }),
    permission: 'competition:read',
  }),

  getMatchHistory: query({
    description:
      'Historique d’un match dans le journal de l’épreuve : auteur, source, heure de chaque score passé par recordScore (écran, tablettes, appareils de piste, agent). ' +
      'Retraits et réintégrations de tireurs (abandon, forfait, exclusion, carton noir) compris. Corrections de poule après tirage du tableau comprises. Pas encore journalisés (ADR-0005) : épreuves par équipes, tableaux séparés.',
    input: z.object({ competitionId: CompetitionId, matchId: Id }),
    output: z.array(JournalEventSchema),
    permission: 'competition:read',
  }),

  onCompetitionEvents: subscription({
    description: 'Événements de données (tireurs, matchs, session…) d’une épreuve ou de toutes.',
    input: z.object({ competitionId: Id.optional() }),
    output: z.object({
      type: z.string(),
      competitionId: z.string().optional(),
      /** journal:appended : nouvelle révision du journal (#1980) */
      revision: z.number().optional(),
    }),
    permission: 'competition:read',
  }),
} satisfies ApiContract;

// ─── Types dérivés ───────────────────────────────────────────────────────────

export type Contract = typeof contract;
export type OperationName = keyof Contract;
type OfKind<K extends OperationKind> = {
  [N in OperationName]: Contract[N]['kind'] extends K ? N : never;
}[OperationName];
export type CommandName = OfKind<'command'>;
export type QueryName = OfKind<'query'>;
export type SubscriptionName = OfKind<'subscription'>;
/** Entrée telle que l'appelant la fournit (champs optionnels compris) */
export type Input<N extends OperationName> = z.input<Contract[N]['input']>;
/** Entrée après validation (valeurs par défaut appliquées) */
export type ParsedInput<N extends OperationName> = z.output<Contract[N]['input']>;
export type Output<N extends OperationName> = z.output<Contract[N]['output']>;
