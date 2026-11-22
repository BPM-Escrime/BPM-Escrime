/**
 * Catalogue unique des codes d'erreur du contrat (docs/adr/0009-codes-erreur.md).
 *
 * Un code absent d'ici ne compile pas (`CommandError`, `ApiError`). Codes en snake_case,
 * stables, en anglais ; le message reste en français. Retirer ou renommer un code est un
 * changement cassant : le noter dans les notes de version et docs/API_CONTRACT.md.
 */

/** Sens d'un code pour le client (écran, agent MCP) */
export type ErrorCategory =
  /** Appel mal formé : corriger l'appel */
  | 'transport'
  /** Objet absent : relire les identifiants */
  | 'not_found'
  /** État changé : relire puis renvoyer */
  | 'conflict'
  /** Règle métier refusée : corriger la demande */
  | 'rule'
  /** Droit manquant */
  | 'permission'
  /** Panne, journalisée */
  | 'internal';

interface ErrorSpec {
  category: ErrorCategory;
  description: string;
}

const e = (category: ErrorCategory, description: string): ErrorSpec => ({ category, description });

export const ERRORS = {
  // ── transport ──
  invalid_input: e('transport', 'Entrée refusée par le schéma de l’opération'),
  unknown_operation: e('transport', 'Opération absente du contrat'),

  // ── not_found ──
  competition_not_found: e('not_found', 'Épreuve introuvable'),
  fencer_not_found: e('not_found', 'Tireur introuvable dans l’épreuve'),
  referee_not_found: e('not_found', 'Arbitre introuvable'),
  pool_not_found: e('not_found', 'Poule introuvable'),
  match_not_found: e('not_found', 'Match introuvable'),
  withdrawal_not_found: e('not_found', 'Aucun retrait à annuler pour ce tireur'),
  dir_not_found: e('not_found', 'Dossier introuvable'),

  // ── conflict ──
  revision_conflict: e('conflict', 'Révision attendue périmée : relire le journal puis renvoyer'),
  command_already_applied: e('conflict', 'Commande déjà appliquée (même commandId)'),
  bracket_exists: e('conflict', 'Tableau déjà construit'),
  bracket_has_scores: e('conflict', 'Tableau déjà commencé : scores saisis'),
  pools_have_scores: e('conflict', 'Poules déjà commencées : scores saisis'),
  next_match_played: e('conflict', 'Un match qui suit a déjà été joué'),
  round_closed: e('conflict', 'Tour de poules déjà clos'),
  draw_done: e('conflict', 'Tirage déjà fait'),
  already_withdrawn: e('conflict', 'Tireur déjà retiré'),
  referee_busy: e('conflict', 'Arbitre déjà occupé sur ce créneau'),
  file_exists: e('conflict', 'Fichier déjà présent'),

  // ── rule ──
  score_invalid: e('rule', 'Score non entier ou négatif'),
  score_above_max: e('rule', 'Score au-delà du score maximal'),
  tie_at_max: e('rule', 'Égalité au score maximal (o.17)'),
  draw_needs_winner: e('rule', 'Égalité : vainqueur ou priorité requis'),
  draw_not_allowed: e('rule', 'Égalité interdite (Sabre Laser)'),
  priority_not_allowed: e('rule', 'Priorité non prévue pour cette arme'),
  winner_required: e('rule', 'Vainqueur requis'),
  winner_contradicts_score: e('rule', 'Vainqueur contraire au score'),
  winner_unresolved: e('rule', 'Vainqueur impossible à déterminer'),
  correction_special_refused: e('rule', 'Correction après tirage : pas de statut spécial'),
  match_not_ready: e('rule', 'Match pas encore formé'),
  pools_not_complete: e('rule', 'Poules non terminées'),
  no_pools: e('rule', 'Aucune poule'),
  no_ranking: e('rule', 'Aucun classement'),
  no_direct_elimination: e('rule', 'Pas de tableau dans la formule'),
  no_final_results: e('rule', 'Résultats finals pas encore disponibles'),
  no_referees: e('rule', 'Aucun arbitre disponible'),
  not_enough_fencers: e('rule', 'Pas assez de tireurs'),
  not_enough_qualifiers: e('rule', 'Pas assez de qualifiés'),
  fencer_already_in_pool: e('rule', 'Tireur déjà dans une poule'),
  tableau_complete: e('rule', 'Tableau terminé'),
  invalid_composition: e('rule', 'Composition invalide'),
  invalid_pool_count: e('rule', 'Nombre de poules invalide'),
  invalid_pool_size: e('rule', 'Taille de poule invalide'),
  invalid_wave: e('rule', 'Vague invalide'),
  invalid_title: e('rule', 'Titre invalide'),
  invalid_date: e('rule', 'Date invalide'),
  invalid_name: e('rule', 'Nom invalide'),
  not_in_season: e('rule', 'Épreuve hors saison'),
  unknown_setting: e('rule', 'Réglage inconnu'),
  unsupported_format: e('rule', 'Format d’épreuve non pris en charge'),
  invalid_path: e('rule', 'Chemin invalide'),
  invalid_extension: e('rule', 'Extension de fichier refusée'),
  path_not_allowed: e('rule', 'Chemin hors des dossiers autorisés'),
  pdf_unavailable: e('rule', 'Export PDF indisponible dans ce mode'),
  unavailable: e('rule', 'Fonction indisponible dans ce mode'),

  // ── permission ──
  permission_denied: e('permission', 'Droit manquant pour cette opération'),

  // ── internal ──
  internal: e('internal', 'Panne interne, journalisée'),
  write_failed: e('internal', 'Écriture impossible'),
} as const satisfies Record<string, ErrorSpec>;

export type ApiErrorCode = keyof typeof ERRORS;

/** Données jointes à certains codes (`ApiError.data`) */
export interface ApiErrorDataByCode {
  revision_conflict: { revision: number; missing: unknown[] };
  command_already_applied: { revision: number; commandId: string };
}

export const isApiErrorCode = (code: unknown): code is ApiErrorCode =>
  typeof code === 'string' && Object.prototype.hasOwnProperty.call(ERRORS, code);

export const errorCategory = (code: ApiErrorCode): ErrorCategory => ERRORS[code].category;
