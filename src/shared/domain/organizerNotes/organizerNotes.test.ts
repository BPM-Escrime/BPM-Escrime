/**
 * Notes et retours de l'organisation : ajout, statut, filtre, compte rendu
 * Licensed under GPL-3.0
 */

import { describe, expect, it } from 'vitest';
import {
  ORGANIZER_NOTE_MAX_LENGTH,
  ORGANIZER_NOTES_MAX,
  addOrganizerNote,
  editOrganizerNote,
  filterOrganizerNotes,
  openOrganizerItems,
  organizerNotesToText,
  removeOrganizerNote,
  toggleOrganizerNote,
  type OrganizerNote,
} from './organizerNotes';

const T0 = new Date('2026-11-25T09:00:00.000Z');
const T1 = new Date('2026-11-25T10:30:00.000Z');

describe('organizerNotes', () => {
  it('ajoute en tête, horodate, garde la phase, ignore le vide', () => {
    let notes = addOrganizerNote([], { kind: 'note', text: '  Salle ouverte  ' }, T0, 'a');
    notes = addOrganizerNote(
      notes,
      { kind: 'incident', text: 'Piste 3 HS', phase: 'pools' },
      T1,
      'b'
    );
    expect(notes.map(n => n.id)).toEqual(['b', 'a']);
    expect(notes[1]).toEqual({
      id: 'a',
      kind: 'note',
      text: 'Salle ouverte',
      createdAt: T0.toISOString(),
    });
    expect(notes[0].phase).toBe('pools');
    expect(addOrganizerNote(notes, { kind: 'note', text: '   ' }, T1, 'c')).toHaveLength(2);
  });

  it('tronque le texte et borne la liste', () => {
    const long = addOrganizerNote([], { kind: 'note', text: 'x'.repeat(5000) }, T0, 'a');
    expect(long[0].text).toHaveLength(ORGANIZER_NOTE_MAX_LENGTH);
    let notes: OrganizerNote[] = [];
    for (let i = 0; i <= ORGANIZER_NOTES_MAX; i++)
      notes = addOrganizerNote(notes, { kind: 'note', text: `n${i}` }, T0, `id${i}`);
    expect(notes).toHaveLength(ORGANIZER_NOTES_MAX);
    expect(notes[0].id).toBe(`id${ORGANIZER_NOTES_MAX}`);
  });

  it('bascule, modifie, supprime', () => {
    const notes = addOrganizerNote([], { kind: 'improvement', text: 'Plus de café' }, T0, 'a');
    const done = toggleOrganizerNote(notes, 'a');
    expect(done[0].done).toBe(true);
    expect(toggleOrganizerNote(done, 'a')[0].done).toBe(false);
    expect(editOrganizerNote(notes, 'a', ' Thé aussi ')[0].text).toBe('Thé aussi');
    expect(editOrganizerNote(notes, 'a', ' ')[0].text).toBe('Plus de café');
    expect(removeOrganizerNote(notes, 'a')).toEqual([]);
  });

  it('compte les incidents et améliorations ouverts', () => {
    let notes = addOrganizerNote([], { kind: 'incident', text: 'a' }, T0, 'a');
    notes = addOrganizerNote(notes, { kind: 'improvement', text: 'b' }, T0, 'b');
    notes = addOrganizerNote(notes, { kind: 'note', text: 'c' }, T0, 'c');
    notes = addOrganizerNote(notes, { kind: 'feedback', text: 'd' }, T0, 'd');
    expect(openOrganizerItems(notes)).toBe(2);
    expect(openOrganizerItems(toggleOrganizerNote(notes, 'a'))).toBe(1);
    expect(openOrganizerItems(undefined)).toBe(0);
  });

  it('filtre par catégorie, statut et texte', () => {
    let notes = addOrganizerNote([], { kind: 'incident', text: 'Piste 3 HS' }, T0, 'a');
    notes = addOrganizerNote(notes, { kind: 'feedback', text: 'Super ambiance' }, T0, 'b');
    notes = toggleOrganizerNote(notes, 'a');
    expect(filterOrganizerNotes(notes, { kind: 'incident' }).map(n => n.id)).toEqual(['a']);
    expect(filterOrganizerNotes(notes, { openOnly: true }).map(n => n.id)).toEqual(['b']);
    expect(filterOrganizerNotes(notes, { query: 'PISTE' }).map(n => n.id)).toEqual(['a']);
  });

  it('produit un compte rendu groupé et chronologique', () => {
    let notes = addOrganizerNote(
      [],
      { kind: 'incident', text: 'Piste 3 HS', phase: 'pools' },
      T0,
      'a'
    );
    notes = addOrganizerNote(notes, { kind: 'incident', text: 'Câble', phase: 'tableau' }, T1, 'b');
    notes = addOrganizerNote(notes, { kind: 'feedback', text: 'Merci' }, T1, 'c');
    notes = toggleOrganizerNote(notes, 'a');
    const text = organizerNotesToText(notes, {
      title: 'Notes',
      kind: {
        note: 'Notes',
        incident: 'Incidents',
        feedback: 'Retours',
        improvement: 'À améliorer',
      },
      done: 'traité',
      formatTime: iso => iso.slice(11, 16),
      phase: id => id.toUpperCase(),
    });
    expect(text).toBe(
      'Notes\n\n## Incidents (2)\n- 09:00 · POOLS [traité] : Piste 3 HS\n- 10:30 · TABLEAU : Câble\n\n' +
        '## Retours (1)\n- 10:30 : Merci\n'
    );
  });
});
