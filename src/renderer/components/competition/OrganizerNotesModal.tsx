/**
 * BPM - Escrime - Organisation ▸ Notes & retours : journal de bord de l'organisation tenu
 * tout le long de l'épreuve (notes, incidents, retours des participants, pistes
 * d'amélioration). Règles : shared/domain/organizerNotes ; écriture par
 * updateCompetitionSettings (`settings.organizerNotes`), confiée à `onSave`.
 * Licensed under GPL-3.0
 */

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ClipboardCopy,
  Lightbulb,
  MessageSquare,
  Pencil,
  StickyNote,
  Trash2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Modal from '../common/Modal';
import { Button } from '../common/Button';
import {
  ORGANIZER_NOTE_KINDS,
  ORGANIZER_NOTE_MAX_LENGTH,
  addOrganizerNote,
  editOrganizerNote,
  filterOrganizerNotes,
  organizerNotesToText,
  removeOrganizerNote,
  toggleOrganizerNote,
  type OrganizerNote,
  type OrganizerNoteKind,
} from '../../../shared/domain/organizerNotes/organizerNotes';

interface OrganizerNotesModalProps {
  t: (key: string, params?: { [key: string]: string | number }) => string;
  notes: OrganizerNote[];
  /** Étape affichée : rattachée à chaque nouvelle note */
  currentPhase?: string;
  phases?: { id: string; label: string }[];
  competitionTitle: string;
  onSave: (notes: OrganizerNote[]) => Promise<void>;
  onClose: () => void;
}

const KIND_ICON: Record<OrganizerNoteKind, LucideIcon> = {
  note: StickyNote,
  incident: AlertTriangle,
  feedback: MessageSquare,
  improvement: Lightbulb,
};

const formatTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
};

export const OrganizerNotesModal: React.FC<OrganizerNotesModalProps> = ({
  t,
  notes,
  currentPhase,
  phases = [],
  competitionTitle,
  onSave,
  onClose,
}) => {
  const [kind, setKind] = useState<OrganizerNoteKind>('note');
  const [text, setText] = useState('');
  const [filterKind, setFilterKind] = useState<OrganizerNoteKind | 'all'>('all');
  const [openOnly, setOpenOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const phaseLabel = (id: string) => phases.find(p => p.id === id)?.label ?? id;
  const kindLabel = (k: OrganizerNoteKind) => t(`organizerNotes.kind_${k}`);
  const visible = useMemo(
    () => filterOrganizerNotes(notes, { kind: filterKind, openOnly, query }),
    [notes, filterKind, openOnly, query]
  );

  const save = async (next: OrganizerNote[]) => {
    setBusy(true);
    setError(null);
    try {
      await onSave(next);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (!text.trim()) return;
    const next = addOrganizerNote(
      notes,
      { kind, text, phase: currentPhase },
      new Date(),
      crypto.randomUUID()
    );
    if (await save(next)) setText('');
  };

  const saveEdit = async () => {
    if (!editing) return;
    if (await save(editOrganizerNote(notes, editing.id, editing.text))) setEditing(null);
  };

  const copyReport = async () => {
    const report = organizerNotesToText(notes, {
      title: `${t('organizerNotes.title')} — ${competitionTitle}`,
      kind: {
        note: kindLabel('note'),
        incident: kindLabel('incident'),
        feedback: kindLabel('feedback'),
        improvement: kindLabel('improvement'),
      },
      done: t('organizerNotes.done'),
      formatTime,
      phase: phaseLabel,
    });
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(t('organizerNotes.copy_failed'));
    }
  };

  return (
    <Modal
      title={t('organizerNotes.title')}
      onClose={onClose}
      size="lg"
      scroll
      footer={
        <>
          <Button
            data-testid="organizer-notes-copy"
            onClick={() => void copyReport()}
            disabled={notes.length === 0}
            icon={
              copied ? (
                <Check size={16} aria-hidden="true" />
              ) : (
                <ClipboardCopy size={16} aria-hidden="true" />
              )
            }
          >
            {copied ? t('organizerNotes.copied') : t('organizerNotes.copy_report')}
          </Button>
          <Button variant="primary" onClick={onClose}>
            {t('actions.close')}
          </Button>
        </>
      }
    >
      <p className="organization-intro">{t('organizerNotes.intro')}</p>

      <div className="organizer-notes-compose">
        <div
          className="organizer-notes-kinds"
          role="radiogroup"
          aria-label={t('organizerNotes.kind')}
        >
          {ORGANIZER_NOTE_KINDS.map(k => {
            const Icon = KIND_ICON[k];
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                className={`organizer-notes-kind organizer-notes-kind-${k}${kind === k ? ' active' : ''}`}
                data-testid={`organizer-notes-kind-${k}`}
                onClick={() => setKind(k)}
              >
                <Icon size={14} aria-hidden="true" /> {kindLabel(k)}
              </button>
            );
          })}
        </div>
        <textarea
          className="form-control"
          data-testid="organizer-notes-text"
          value={text}
          maxLength={ORGANIZER_NOTE_MAX_LENGTH}
          rows={3}
          placeholder={t(`organizerNotes.placeholder_${kind}`)}
          aria-label={t('organizerNotes.new_note')}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void add();
            }
          }}
        />
        <div className="organizer-notes-compose-actions">
          <span className="organizer-notes-hint">{t('organizerNotes.shortcut_hint')}</span>
          <Button
            variant="primary"
            data-testid="organizer-notes-add"
            disabled={busy || !text.trim()}
            onClick={() => void add()}
          >
            {t('organizerNotes.add')}
          </Button>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}

      <div className="organizer-notes-filters">
        <select
          className="form-control"
          value={filterKind}
          aria-label={t('organizerNotes.filter_kind')}
          onChange={e => setFilterKind(e.target.value as OrganizerNoteKind | 'all')}
        >
          <option value="all">{t('organizerNotes.all_kinds')}</option>
          {ORGANIZER_NOTE_KINDS.map(k => (
            <option key={k} value={k}>
              {kindLabel(k)}
            </option>
          ))}
        </select>
        <input
          type="search"
          className="form-control"
          value={query}
          placeholder={t('organizerNotes.search')}
          aria-label={t('organizerNotes.search')}
          onChange={e => setQuery(e.target.value)}
        />
        <label className="organizer-notes-open-only">
          <input type="checkbox" checked={openOnly} onChange={e => setOpenOnly(e.target.checked)} />{' '}
          {t('organizerNotes.open_only')}
        </label>
      </div>

      {visible.length === 0 ? (
        <p className="organizer-notes-empty">
          {notes.length === 0 ? t('organizerNotes.empty') : t('organizerNotes.no_match')}
        </p>
      ) : (
        <ul className="organizer-notes-list" data-testid="organizer-notes-list">
          {visible.map(n => {
            const Icon = KIND_ICON[n.kind];
            const isEditing = editing?.id === n.id;
            return (
              <li
                key={n.id}
                className={`organizer-note organizer-note-${n.kind}${n.done ? ' organizer-note-done' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={!!n.done}
                  disabled={busy}
                  title={t('organizerNotes.mark_done')}
                  aria-label={t('organizerNotes.mark_done')}
                  onChange={() => void save(toggleOrganizerNote(notes, n.id))}
                />
                <div className="organizer-note-body">
                  <div className="organizer-note-meta">
                    <Icon size={13} aria-hidden="true" /> {kindLabel(n.kind)} ·{' '}
                    {formatTime(n.createdAt)}
                    {n.phase ? ` · ${phaseLabel(n.phase)}` : ''}
                  </div>
                  {isEditing ? (
                    <div className="organizer-note-edit">
                      <textarea
                        className="form-control"
                        rows={2}
                        value={editing.text}
                        maxLength={ORGANIZER_NOTE_MAX_LENGTH}
                        aria-label={t('organizerNotes.edit')}
                        onChange={e => setEditing({ id: n.id, text: e.target.value })}
                      />
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={busy || !editing.text.trim()}
                        onClick={() => void saveEdit()}
                      >
                        {t('actions.save')}
                      </Button>
                      <Button size="sm" onClick={() => setEditing(null)}>
                        {t('actions.cancel')}
                      </Button>
                    </div>
                  ) : (
                    <div className="organizer-note-text">{n.text}</div>
                  )}
                </div>
                {!isEditing && (
                  <div className="organizer-note-actions">
                    <Button
                      variant="ghost"
                      size="sm"
                      title={t('organizerNotes.edit')}
                      aria-label={t('organizerNotes.edit')}
                      icon={<Pencil size={14} aria-hidden="true" />}
                      onClick={() => setEditing({ id: n.id, text: n.text })}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      title={t('organizerNotes.delete')}
                      aria-label={t('organizerNotes.delete')}
                      disabled={busy}
                      icon={<Trash2 size={14} aria-hidden="true" />}
                      onClick={() => void save(removeOrganizerNote(notes, n.id))}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
};

export default OrganizerNotesModal;
