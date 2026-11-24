/**
 * BPM - Escrime - Éditeur de thème : variables, valeurs par défaut et préréglages par écran
 * Extrait de ThemeEditor.tsx (#2200).
 * Licensed under GPL-3.0
 */
import type { CustomTheme, ThemeTargetType } from '../../../shared/types/remote';
import { REFEREE_DARK_MATCH_VARS } from '../../../shared/utils/trainingThemes';

// ──────────────────────────────────────────────────────────────────────────────
// Valeurs par défaut (thème dark)
// ──────────────────────────────────────────────────────────────────────────────
export const DARK_DEFAULTS: Record<string, string> = {
  '--bg': 'linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)',
  '--text': '#ffffff',
  '--header-bg': 'rgba(0,0,0,0.4)',
  '--match-bg': 'rgba(255,255,255,0.95)',
  '--fencer-name-color': '#1f2937',
  '--fencer-club-color': '#6b7280',
  '--green-side-bg': 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
  '--green-side-border': '#16a34a',
  '--red-side-bg': 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)',
  '--red-side-border': '#dc2626',
  '--score-bg': '#0c0c09',
  '--score-green': '#00e640',
  '--score-green-glow': 'rgba(0,230,64,0.65), rgba(0,230,64,0.3)',
  '--score-red': '#ff2200',
  '--score-red-glow': 'rgba(255,34,0,0.65), rgba(255,34,0,0.3)',
  '--timer-bg': '#0a0800',
  '--timer-color': '#ffaa00',
  '--timer-glow': 'rgba(255,170,0,0.9), rgba(255,170,0,0.45)',
  '--timer-border': 'rgba(255,170,0,0.18)',
  '--timer-run-color': '#00e640',
  '--timer-run-glow': 'rgba(0,230,64,0.95), rgba(0,230,64,0.5)',
  '--timer-run-border': 'rgba(0,230,64,0.5)',
  '--waiting-color': '#ffffff',
  '--idle-number-color': 'rgba(255,255,255,0.9)',
  '--idle-label-color': 'rgba(255,255,255,0.5)',
  '--score-font-size': 'clamp(7rem, 23vw, 44vh)',
  '--timer-font-size': 'clamp(3.5rem, 11vw, 18vh)',
  '--fencer-name-font-size': 'clamp(1rem, 3.5vw, 5vh)',
  '--score-font-family': 'monospace',
  '--timer-font-family': 'monospace',
  '--fencer-name-font-family': 'system-ui, sans-serif',
  '--vs-color': '#ef4444',
  '--vs-font-family': 'system-ui, sans-serif',
  // Visibilité
  '--header-display': 'flex',
  '--vs-divider-display': 'flex',
  '--timer-label-display': 'none',
  // Positionnement overlay
  '--timer-section-position': 'relative',
  '--timer-section-top': 'auto',
  '--timer-section-left': 'auto',
  '--timer-section-right': 'auto',
  '--timer-section-bottom': 'auto',
  '--timer-section-width': 'auto',
  '--timer-section-transform': 'none',
  '--timer-section-z-index': '1',
  '--score-a-position': 'relative',
  '--score-a-top': 'auto',
  '--score-a-left': 'auto',
  '--score-a-right': 'auto',
  '--score-a-bottom': 'auto',
  '--score-a-transform': 'none',
  '--score-b-position': 'relative',
  '--score-b-top': 'auto',
  '--score-b-left': 'auto',
  '--score-b-right': 'auto',
  '--score-b-bottom': 'auto',
  '--score-b-transform': 'none',
  '--name-a-position': 'relative',
  '--name-a-top': 'auto',
  '--name-a-left': 'auto',
  '--name-a-right': 'auto',
  '--name-a-width': 'auto',
  '--name-a-transform': 'none',
  '--name-b-position': 'relative',
  '--name-b-top': 'auto',
  '--name-b-left': 'auto',
  '--name-b-right': 'auto',
  '--name-b-width': 'auto',
  '--name-b-transform': 'none',
};

// ──────────────────────────────────────────────────────────────────────────────
// Groupes de variables
// ──────────────────────────────────────────────────────────────────────────────
export interface VarDef {
  key: string;
  label: string;
  /** color → color-picker + text; text → texte libre; size → presets de taille; font → menu déroulant police */
  type: 'color' | 'text' | 'size' | 'font';
}

export interface VarGroup {
  label: string;
  vars: VarDef[];
}

export const VAR_GROUPS: VarGroup[] = [
  {
    label: 'Arrière-plans',
    vars: [
      { key: '--bg', label: 'Fond général', type: 'text' },
      { key: '--header-bg', label: 'Fond en-tête', type: 'text' },
      { key: '--match-bg', label: 'Fond match', type: 'text' },
      { key: '--score-bg', label: 'Fond score', type: 'text' },
      { key: '--timer-bg', label: 'Fond chrono', type: 'text' },
    ],
  },
  {
    label: 'Textes',
    vars: [
      { key: '--text', label: 'Texte principal', type: 'color' },
      { key: '--fencer-name-color', label: 'Nom combattant', type: 'color' },
      { key: '--fencer-club-color', label: 'Club combattant', type: 'color' },
      { key: '--waiting-color', label: 'Écran attente', type: 'color' },
      { key: '--idle-number-color', label: 'Numéro arène', type: 'text' },
      { key: '--idle-label-color', label: 'Label arène', type: 'text' },
    ],
  },
  {
    label: 'Côté gauche (rouge)',
    vars: [
      { key: '--red-side-bg', label: 'Fond', type: 'text' },
      { key: '--red-side-border', label: 'Bordure', type: 'color' },
      { key: '--score-red', label: 'Couleur score', type: 'color' },
      { key: '--score-red-glow', label: 'Lueur score', type: 'text' },
    ],
  },
  {
    label: 'Côté droit (vert)',
    vars: [
      { key: '--green-side-bg', label: 'Fond', type: 'text' },
      { key: '--green-side-border', label: 'Bordure', type: 'color' },
      { key: '--score-green', label: 'Couleur score', type: 'color' },
      { key: '--score-green-glow', label: 'Lueur score', type: 'text' },
    ],
  },
  {
    label: 'Chronomètre',
    vars: [
      { key: '--timer-color', label: 'Couleur arrêt', type: 'color' },
      { key: '--timer-glow', label: 'Lueur arrêt', type: 'text' },
      { key: '--timer-border', label: 'Bordure arrêt', type: 'text' },
      { key: '--timer-run-color', label: 'Couleur en cours', type: 'color' },
      { key: '--timer-run-glow', label: 'Lueur en cours', type: 'text' },
      { key: '--timer-run-border', label: 'Bordure en cours', type: 'text' },
    ],
  },
  {
    label: 'Disposition',
    vars: [
      { key: '--score-font-size', label: 'Taille scores', type: 'size' },
      { key: '--timer-font-size', label: 'Taille chrono', type: 'size' },
      { key: '--fencer-name-font-size', label: 'Taille noms', type: 'size' },
      { key: '--score-font-family', label: 'Police scores', type: 'font' },
      { key: '--timer-font-family', label: 'Police chrono', type: 'font' },
      { key: '--fencer-name-font-family', label: 'Police noms', type: 'font' },
      { key: '--vs-color', label: 'Couleur VS', type: 'color' },
      { key: '--vs-font-family', label: 'Police VS', type: 'font' },
    ],
  },
  {
    label: 'Positionnement',
    vars: [
      { key: '--header-display', label: 'En-tête (flex/none)', type: 'text' },
      { key: '--vs-divider-display', label: 'VS (flex/none)', type: 'text' },
      { key: '--timer-label-display', label: '"Tps restant" (none/block)', type: 'text' },
      { key: '--timer-section-position', label: 'Chrono position', type: 'text' },
      { key: '--timer-section-top', label: 'Chrono haut', type: 'text' },
      { key: '--timer-section-left', label: 'Chrono gauche', type: 'text' },
      { key: '--timer-section-right', label: 'Chrono droite', type: 'text' },
      { key: '--timer-section-bottom', label: 'Chrono bas', type: 'text' },
      { key: '--timer-section-width', label: 'Chrono largeur', type: 'text' },
      { key: '--timer-section-transform', label: 'Chrono transform', type: 'text' },
      { key: '--score-a-position', label: 'Score G position', type: 'text' },
      { key: '--score-a-top', label: 'Score G haut', type: 'text' },
      { key: '--score-a-left', label: 'Score G gauche', type: 'text' },
      { key: '--score-a-right', label: 'Score G droite', type: 'text' },
      { key: '--score-a-bottom', label: 'Score G bas', type: 'text' },
      { key: '--score-a-transform', label: 'Score G transform', type: 'text' },
      { key: '--score-b-position', label: 'Score D position', type: 'text' },
      { key: '--score-b-top', label: 'Score D haut', type: 'text' },
      { key: '--score-b-left', label: 'Score D gauche', type: 'text' },
      { key: '--score-b-right', label: 'Score D droite', type: 'text' },
      { key: '--score-b-bottom', label: 'Score D bas', type: 'text' },
      { key: '--score-b-transform', label: 'Score D transform', type: 'text' },
      { key: '--name-a-position', label: 'Nom G position', type: 'text' },
      { key: '--name-a-top', label: 'Nom G haut', type: 'text' },
      { key: '--name-a-left', label: 'Nom G gauche', type: 'text' },
      { key: '--name-a-right', label: 'Nom G droite', type: 'text' },
      { key: '--name-a-width', label: 'Nom G largeur', type: 'text' },
      { key: '--name-a-transform', label: 'Nom G transform', type: 'text' },
      { key: '--name-b-position', label: 'Nom D position', type: 'text' },
      { key: '--name-b-top', label: 'Nom D haut', type: 'text' },
      { key: '--name-b-left', label: 'Nom D gauche', type: 'text' },
      { key: '--name-b-right', label: 'Nom D droite', type: 'text' },
      { key: '--name-b-width', label: 'Nom D largeur', type: 'text' },
      { key: '--name-b-transform', label: 'Nom D transform', type: 'text' },
    ],
  },
];

export const SIZE_PRESETS: Record<string, Record<string, string>> = {
  '--score-font-size': {
    Petit: 'clamp(4rem, 14vw, 28vh)',
    Normal: 'clamp(7rem, 23vw, 44vh)',
    Grand: 'clamp(9rem, 29vw, 55vh)',
    'Très grand': 'clamp(11rem, 35vw, 66vh)',
  },
  '--timer-font-size': {
    Petit: 'clamp(2rem, 6vw, 10vh)',
    Normal: 'clamp(3.5rem, 11vw, 18vh)',
    Grand: 'clamp(4.5rem, 14vw, 24vh)',
    'Très grand': 'clamp(6rem, 18vw, 30vh)',
  },
  '--fencer-name-font-size': {
    Petit: 'clamp(0.7rem, 2vw, 3vh)',
    Normal: 'clamp(1rem, 3.5vw, 5vh)',
    Grand: 'clamp(1.4rem, 5vw, 7vh)',
    'Très grand': 'clamp(1.8rem, 6.5vw, 9vh)',
  },
};

export const FONT_OPTIONS: { label: string; value: string }[] = [
  { label: 'Monospace (défaut)', value: 'monospace' },
  { label: 'Courier New', value: '"Courier New", monospace' },
  { label: 'System UI', value: 'system-ui, sans-serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Impact', value: 'Impact, fantasy' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", sans-serif' },
  { label: 'Lucida Console', value: '"Lucida Console", monospace' },
];

// Preset de variables pour le mode Overlay — arène
export const OVERLAY_PRESET: Record<string, string> = {
  '--match-bg': 'transparent',
  '--score-bg': 'transparent',
  '--timer-bg': 'rgba(0, 0, 0, 0.55)',
  '--green-side-bg': 'rgba(0, 28, 14, 0.50)',
  '--red-side-bg': 'rgba(58, 0, 28, 0.50)',
  '--fencer-name-color': '#ffffff',
  '--fencer-club-color': 'rgba(255, 230, 255, 0.85)',
};

// Preset de variables pour le mode Overlay — kiosque
export const KIOSK_OVERLAY_PRESET: Record<string, string> = {
  '--k-card-bg': 'rgba(0, 0, 0, 0.52)',
  '--k-border': 'rgba(255, 255, 255, 0.18)',
};

// Canvas virtuel pour le preview scalé (résolution de référence 16:9)
export const VIRTUAL_W = 1280;
export const VIRTUAL_H = 720;

// Compat shim : utilisé par RemoteScoreManager (migré vers IPC)
export const STORAGE_KEY = 'bellepoule-custom-themes';
export function loadSavedThemes(): CustomTheme[] {
  return [];
}
export function saveSavedThemes(_themes: CustomTheme[]): void {
  /* no-op */
}

// ──────────────────────────────────────────────────────────────────────────────
// Variables et defaults Arbitre (tablette)
// ──────────────────────────────────────────────────────────────────────────────
export const REFEREE_DEFAULTS: Record<string, string> = {
  '--ref-bg': 'linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)',
  '--ref-header-bg': 'rgba(0, 0, 0, 0.3)',
  '--ref-accent': '#3b82f6',
  '--ref-accent2': '#f59e0b',
  '--ref-text': '#ffffff',
  '--ref-muted': 'rgba(255,255,255,0.6)',
  '--ref-card-bg': 'rgba(255, 255, 255, 0.05)',
  '--ref-border': 'rgba(255, 255, 255, 0.1)',
  ...REFEREE_DARK_MATCH_VARS,
};

export const REFEREE_VAR_GROUPS: VarGroup[] = [
  {
    label: 'Arbitre – Arrière-plan',
    vars: [
      { key: '--ref-bg', label: 'Fond page', type: 'text' },
      { key: '--ref-header-bg', label: 'Fond en-tête', type: 'text' },
    ],
  },
  {
    label: 'Arbitre – Couleurs',
    vars: [
      { key: '--ref-accent', label: 'Couleur accent 1', type: 'color' },
      { key: '--ref-accent2', label: 'Couleur accent 2', type: 'color' },
      { key: '--ref-text', label: 'Texte principal', type: 'color' },
      { key: '--ref-muted', label: 'Texte discret', type: 'color' },
    ],
  },
  {
    label: 'Arbitre – Cartes',
    vars: [
      { key: '--ref-card-bg', label: 'Fond cartes', type: 'text' },
      { key: '--ref-border', label: 'Bordures', type: 'text' },
    ],
  },
  {
    label: 'Arbitre – Carte du match',
    vars: [
      { key: '--ref-match-bg', label: 'Fond carte du match', type: 'text' },
      { key: '--ref-match-text', label: 'Texte carte du match', type: 'color' },
      { key: '--ref-fencer-bg', label: 'Fond tireurs', type: 'text' },
      { key: '--ref-fencer-text', label: 'Texte tireurs', type: 'color' },
      { key: '--ref-btn-text', label: 'Texte bouton Retour', type: 'color' },
    ],
  },
];

// ──────────────────────────────────────────────────────────────────────────────
// Variables et defaults Affichage poule
// ──────────────────────────────────────────────────────────────────────────────
export const POOL_DEFAULTS: Record<string, string> = {
  '--pool-bg': '#1a1a2e',
  '--pool-header-bg': 'rgba(0, 0, 0, 0.5)',
  '--pool-accent': '#6366f1',
  '--pool-accent2': '#3b82f6',
  '--pool-text': '#ffffff',
  '--pool-muted': '#64748b',
  '--pool-card-bg': 'rgba(255, 255, 255, 0.04)',
  '--pool-border': 'rgba(255, 255, 255, 0.08)',
};

export const POOL_VAR_GROUPS: VarGroup[] = [
  {
    label: 'Poule – Arrière-plan',
    vars: [
      { key: '--pool-bg', label: 'Fond page', type: 'text' },
      { key: '--pool-header-bg', label: 'Fond en-tête', type: 'text' },
    ],
  },
  {
    label: 'Poule – Couleurs',
    vars: [
      { key: '--pool-accent', label: 'Couleur accent 1', type: 'color' },
      { key: '--pool-accent2', label: 'Couleur accent 2', type: 'color' },
      { key: '--pool-text', label: 'Texte principal', type: 'color' },
      { key: '--pool-muted', label: 'Texte discret', type: 'color' },
    ],
  },
  {
    label: 'Poule – Cartes',
    vars: [
      { key: '--pool-card-bg', label: 'Fond cartes', type: 'text' },
      { key: '--pool-border', label: 'Bordures', type: 'text' },
    ],
  },
];

// ──────────────────────────────────────────────────────────────────────────────
// Variables et defaults Public
// ──────────────────────────────────────────────────────────────────────────────
export const PUBLIC_DEFAULTS: Record<string, string> = {
  '--pub-bg': 'linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)',
  '--pub-header-bg': 'rgba(0, 0, 0, 0.4)',
  '--pub-accent': '#fbbf24',
  '--pub-accent2': '#3b82f6',
  '--pub-text': '#ffffff',
  '--pub-muted': 'rgba(255,255,255,0.6)',
  '--pub-card-bg': 'rgba(255, 255, 255, 0.05)',
  '--pub-border': 'rgba(255, 255, 255, 0.1)',
};

export const PUBLIC_VAR_GROUPS: VarGroup[] = [
  {
    label: 'Public – Arrière-plan',
    vars: [
      { key: '--pub-bg', label: 'Fond page', type: 'text' },
      { key: '--pub-header-bg', label: 'Fond en-tête', type: 'text' },
    ],
  },
  {
    label: 'Public – Couleurs',
    vars: [
      { key: '--pub-accent', label: 'Couleur accent 1', type: 'color' },
      { key: '--pub-accent2', label: 'Couleur accent 2', type: 'color' },
      { key: '--pub-text', label: 'Texte principal', type: 'color' },
      { key: '--pub-muted', label: 'Texte discret', type: 'color' },
    ],
  },
  {
    label: 'Public – Cartes',
    vars: [
      { key: '--pub-card-bg', label: 'Fond cartes', type: 'text' },
      { key: '--pub-border', label: 'Bordures', type: 'text' },
    ],
  },
];

// ──────────────────────────────────────────────────────────────────────────────
// Variables et defaults Kiosk
// ──────────────────────────────────────────────────────────────────────────────
export const KIOSK_DEFAULTS: Record<string, string> = {
  '--k-bg': '#0f172a',
  '--k-accent': '#fbbf24',
  '--k-accent2': '#3b82f6',
  '--k-card-bg': 'rgba(255, 255, 255, 0.04)',
  '--k-border': 'rgba(255, 255, 255, 0.08)',
  '--k-muted': '#64748b',
  '--k-progress': 'linear-gradient(90deg, #3b82f6, #8b5cf6)',
};

export const KIOSK_VAR_GROUPS: VarGroup[] = [
  {
    label: 'Kiosk',
    vars: [
      { key: '--k-bg', label: 'Fond', type: 'text' },
      { key: '--k-accent', label: 'Couleur accent', type: 'color' },
      { key: '--k-accent2', label: 'Couleur interactive', type: 'color' },
      { key: '--k-card-bg', label: 'Fond cartes', type: 'text' },
      { key: '--k-border', label: 'Bordures', type: 'text' },
      { key: '--k-muted', label: 'Texte discret', type: 'color' },
      { key: '--k-progress', label: 'Barre progression', type: 'text' },
    ],
  },
];

/** Valeurs, groupes de variables et nom par défaut de l'écran ciblé */
export function themeTargetConfig(type: ThemeTargetType): {
  defaults: Record<string, string>;
  groups: VarGroup[];
  defaultName: string;
} {
  switch (type) {
    case 'kiosk':
      return { defaults: KIOSK_DEFAULTS, groups: KIOSK_VAR_GROUPS, defaultName: 'Thème kiosk' };
    case 'referee':
      return {
        defaults: REFEREE_DEFAULTS,
        groups: REFEREE_VAR_GROUPS,
        defaultName: 'Thème arbitre',
      };
    case 'pool':
      return { defaults: POOL_DEFAULTS, groups: POOL_VAR_GROUPS, defaultName: 'Thème poule' };
    case 'public':
      return { defaults: PUBLIC_DEFAULTS, groups: PUBLIC_VAR_GROUPS, defaultName: 'Thème public' };
    default:
      return { defaults: DARK_DEFAULTS, groups: VAR_GROUPS, defaultName: 'Mon thème' };
  }
}
