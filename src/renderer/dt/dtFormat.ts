/**
 * BellePoule Modern - Mise en forme de la vue DT (#1981 lot 3) : fonctions pures, testées.
 * Licensed under GPL-3.0
 */
import type { Fencer, Match, Pool } from '../../shared/types';
import type { TableauMatch } from '../../shared/domain/tableau/tableauTypes';

const LANGUAGES = ['fr', 'en', 'br', 'ca', 'de', 'es', 'pt', 'it', 'ru', 'zh-HK'] as const;

/** Première langue du navigateur prise en charge (zh-* → zh-HK), sinon français */
export function browserLanguage(prefs: readonly string[] | undefined): string {
  for (const p of prefs ?? []) {
    const code = p.toLowerCase();
    if (code.startsWith('zh')) return 'zh-HK';
    const base = code.split('-')[0];
    const hit = LANGUAGES.find(l => l === base);
    if (hit) return hit;
  }
  return 'fr';
}

/** « DUPONT Léa » (nom déjà abrégé par le serveur selon le réglage RGPD) */
export function fencerName(f: Pick<Fencer, 'firstName' | 'lastName'> | null | undefined): string {
  if (!f) return '—';
  return [f.lastName?.toUpperCase(), f.firstName].filter(Boolean).join(' ');
}

/** Case de la feuille de poule : score du tireur de la ligne contre celui de la colonne */
export function poolCell(pool: Pool, rowId: string, colId: string): string {
  if (rowId === colId) return '';
  const m = pool.matches.find(
    x =>
      (x.fencerA?.id === rowId && x.fencerB?.id === colId) ||
      (x.fencerA?.id === colId && x.fencerB?.id === rowId)
  );
  if (!m) return '';
  const s = m.fencerA?.id === rowId ? m.scoreA : m.scoreB;
  return scoreText(s, m.maxScore);
}

function scoreText(s: Match['scoreA'], max: number): string {
  if (!s) return '';
  if (s.isExclusion) return 'X';
  if (s.isForfait) return 'F';
  if (s.isAbstention) return 'A';
  if (s.value === null || s.value === undefined) return '';
  // Feuille FFE : « V » au score maximal, « V4 » sinon
  if (s.isVictory) return s.value === max ? 'V' : `V${s.value}`;
  return String(s.value);
}

export interface TableauRound {
  /** Taille du tour : 2 = finale, 4 = demi-finales… */
  size: number;
  matches: TableauMatch[];
}

/** Tours du tableau, du premier à la finale ; exempts retirés */
export function tableauRounds(matches: TableauMatch[]): TableauRound[] {
  const byRound = new Map<number, TableauMatch[]>();
  for (const m of matches) {
    if (m.isBye) continue;
    const list = byRound.get(m.round) ?? [];
    list.push(m);
    byRound.set(m.round, list);
  }
  return [...byRound.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([size, list]) => ({ size, matches: list.sort((a, b) => a.position - b.position) }));
}
