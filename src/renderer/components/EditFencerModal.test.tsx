// @vitest-environment jsdom
/**
 * Tests de composant - EditFencerModal
 * BPM - Escrime
 */

import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string, p?: Record<string, unknown>) => (p ? `${k} ${JSON.stringify(p)}` : k),
  }),
}));
// Saisie des membres (entrée en équipes) : composant chargé à la demande, même traduction
vi.mock('../contexts/TranslationContext', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
import EditFencerModal from './EditFencerModal';
import { Fencer, Gender, FencerStatus } from '../../shared/types';

const fencer: Fencer = {
  id: 'f1',
  ref: 1,
  lastName: 'Dupont',
  firstName: 'Jean',
  gender: Gender.MALE,
  nationality: 'FRA',
  status: FencerStatus.CHECKED_IN,
  club: 'CEP',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const setup = () => {
  const onSave = vi.fn();
  const onClose = vi.fn();
  const { container } = render(
    <EditFencerModal fencer={fencer} onSave={onSave} onClose={onClose} />
  );
  return { onSave, onClose, container };
};

describe('EditFencerModal', () => {
  it('préremplit les champs depuis le tireur', () => {
    setup();
    expect(screen.getByDisplayValue('Dupont')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Jean')).toBeInTheDocument();
  });

  it('enregistre les modifications (nom en majuscules) puis ferme', () => {
    const { onSave, onClose, container } = setup();
    fireEvent.change(screen.getByDisplayValue('Dupont'), { target: { value: 'martin' } });
    fireEvent.submit(container.querySelector('form')!);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toBe('f1');
    expect(onSave.mock.calls[0][1].lastName).toBe('MARTIN');
    expect(onSave.mock.calls[0][1].firstName).toBe('Jean');
    expect(onClose).toHaveBeenCalled();
  });

  it('le bouton fermer ferme la modale', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByText('×'));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('EditFencerModal : entrée en équipes (docs/adr/0043, F4c)', () => {
  const team: Fencer = {
    ...fencer,
    lastName: 'LES LAMES',
    firstName: 'DURAND / PETIT',
    gender: Gender.MIXED,
    category: 'V2' as Fencer['category'],
    level: 3,
    handicap: false,
    members: [
      { lastName: 'DURAND', firstName: 'Éva', gender: 'F', birthDate: '1989-06-01' },
      { lastName: 'PETIT', firstName: 'Noé', gender: 'M', birthDate: '1961-08-27' },
    ],
  };
  const LEVELS = ['Expert', 'Intermédiaire', 'Débutant'];

  const setupTeam = async () => {
    const onSave = vi.fn();
    const { container } = render(
      <EditFencerModal fencer={team} teamLevels={LEVELS} onSave={onSave} onClose={vi.fn()} />
    );
    await screen.findByTestId('team-entry-fields');
    return { onSave, container };
  };

  it('préremplit les membres et le niveau ; individuel : aucun champ d’équipe', async () => {
    await setupTeam();
    expect(screen.getByDisplayValue('DURAND')).toBeInTheDocument();
    expect(screen.getByDisplayValue('PETIT')).toBeInTheDocument();
    expect(document.getElementById('edit-fencer-level')).toHaveValue('3');
    expect(screen.queryByDisplayValue('DURAND / PETIT')).toBeNull();
  });

  it('niveau et marqueur modifiés ; catégorie saisie gardée tant que les naissances ne changent pas', async () => {
    const { onSave, container } = await setupTeam();
    fireEvent.change(document.getElementById('edit-fencer-level')!, { target: { value: '1' } });
    fireEvent.click(screen.getByLabelText('HANDI'));
    fireEvent.submit(container.querySelector('form')!);
    const updates = onSave.mock.calls[0][1];
    expect(updates).toMatchObject({
      level: 1,
      handicap: true,
      firstName: 'DURAND / PETIT',
      gender: 'X',
      category: 'V2',
    });
    expect(updates.members).toHaveLength(2);
  });

  it('une date de naissance modifiée laisse le moteur recalculer la catégorie', async () => {
    const { onSave, container } = await setupTeam();
    fireEvent.change(document.getElementById('edit-fencer-m0-birth')!, {
      target: { value: '1999-06-01' },
    });
    fireEvent.submit(container.querySelector('form')!);
    expect('category' in onSave.mock.calls[0][1]).toBe(false);
  });
});
