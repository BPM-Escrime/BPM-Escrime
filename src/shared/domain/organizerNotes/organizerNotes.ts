/**
 * BPM - Escrime - Notes et retours de l'organisation, tenus tout le long de l'épreuve
 * (Organisation ▸ Notes & retours). Règles pures : heure et identifiant injectés (docs/adr/0002).
 * Rangées dans les réglages de l'épreuve (`settings.organizerNotes`, updateCompetitionSettings).
 * Licensed under GPL-3.0
 */

import type { OrganizerNote, OrganizerNoteKind } from '../../types';

export type { OrganizerNote, OrganizerNoteKind };

export const ORGANIZER_NOTE_KINDS: readonly OrganizerNoteKind[] = [
  'note',
  'incident',
  'feedback',
  'improvement',
];

export const ORGANIZER_NOTE_MAX_LENGTH = 2000;
export const ORGANIZER_NOTES_MAX = 500;

export interface NewOrganizerNote {
  kind: OrganizerNoteKind;
  text: string;
  phase?: string;
}

/** Ajoute une note en tête ; texte vide ignoré, texte tronqué, liste bornée (plus anciennes retirées) */
export function addOrganizerNote(
  notes: readonly OrganizerNote[],
  input: NewOrganizerNote,
  now: Date,
  id: string
): OrganizerNote[] {
  const text = input.text.trim().slice(0, ORGANIZER_NOTE_MAX_LENGTH);
  if (!text) return [...notes];
  const note: OrganizerNote = {
    id,
    kind: input.kind,
    text,
    createdAt: now.toISOString(),
    ...(input.phase ? { phase: input.phase } : {}),
  };
  return [note, ...notes].slice(0, ORGANIZER_NOTES_MAX);
}

export function toggleOrganizerNote(notes: readonly OrganizerNote[], id: string): OrganizerNote[] {
  return notes.map(n => (n.id === id ? { ...n, done: !n.done } : n));
}

export function editOrganizerNote(
  notes: readonly OrganizerNote[],
  id: string,
  text: string
): OrganizerNote[] {
  const clean = text.trim().slice(0, ORGANIZER_NOTE_MAX_LENGTH);
  if (!clean) return [...notes];
  return notes.map(n => (n.id === id ? { ...n, text: clean } : n));
}

export function removeOrganizerNote(notes: readonly OrganizerNote[], id: string): OrganizerNote[] {
  return notes.filter(n => n.id !== id);
}

/** Points encore ouverts : incidents et pistes d'amélioration non traités */
export function openOrganizerItems(notes: readonly OrganizerNote[] | undefined): number {
  return (notes ?? []).filter(n => !n.done && (n.kind === 'incident' || n.kind === 'improvement'))
    .length;
}

export interface OrganizerNotesFilter {
  kind?: OrganizerNoteKind | 'all';
  openOnly?: boolean;
  query?: string;
}

export function filterOrganizerNotes(
  notes: readonly OrganizerNote[],
  { kind = 'all', openOnly = false, query = '' }: OrganizerNotesFilter
): OrganizerNote[] {
  const q = query.trim().toLowerCase();
  return notes.filter(
    n =>
      (kind === 'all' || n.kind === kind) &&
      (!openOnly || !n.done) &&
      (!q || n.text.toLowerCase().includes(q))
  );
}

export interface OrganizerNotesTextLabels {
  title: string;
  kind: Record<OrganizerNoteKind, string>;
  done: string;
  /** Heure locale lisible d'un horodatage ISO */
  formatTime: (iso: string) => string;
  /** Libellé d'une étape (identifiant de phase) */
  phase?: (id: string) => string;
}

/** Compte rendu texte, groupé par catégorie, du plus ancien au plus récent (débriefing) */
export function organizerNotesToText(
  notes: readonly OrganizerNote[],
  labels: OrganizerNotesTextLabels
): string {
  const lines: string[] = [labels.title, ''];
  for (const kind of ORGANIZER_NOTE_KINDS) {
    const group = notes
      .filter(n => n.kind === kind)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (group.length === 0) continue;
    lines.push(`## ${labels.kind[kind]} (${group.length})`);
    for (const n of group) {
      const phase = n.phase && labels.phase ? ` · ${labels.phase(n.phase)}` : '';
      const done = n.done ? ` [${labels.done}]` : '';
      lines.push(`- ${labels.formatTime(n.createdAt)}${phase}${done} : ${n.text}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}
