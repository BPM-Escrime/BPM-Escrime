// @vitest-environment jsdom
/**
 * Tests de composant - AddFencerModal
 * BPM - Escrime
 */

import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../contexts/TranslationContext', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import AddFencerModal from './AddFencerModal';

const setup = () => {
  const onAdd = vi.fn();
  const onClose = vi.fn();
  const { container } = render(<AddFencerModal onAdd={onAdd} onClose={onClose} />);
  return { onAdd, onClose, container };
};

describe('AddFencerModal', () => {
  it('fenêtre de saisie : un clic à côté ne la ferme pas', () => {
    const { onClose, container } = setup();
    fireEvent.click(container.querySelector('.modal-overlay')!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ajoute un tireur avec nom en majuscules puis ferme', () => {
    const { onAdd, onClose, container } = setup();
    fireEvent.change(screen.getByPlaceholderText('addFencer.last_name_ph'), {
      target: { value: 'dupont' },
    });
    fireEvent.change(screen.getByPlaceholderText('addFencer.first_name_ph'), {
      target: { value: 'Jean' },
    });
    fireEvent.submit(container.querySelector('form')!);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0].lastName).toBe('DUPONT');
    expect(onAdd.mock.calls[0][0].firstName).toBe('Jean');
    expect(onClose).toHaveBeenCalled();
  });

  it('ne soumet pas sans nom/prénom', () => {
    const { onAdd, container } = setup();
    fireEvent.submit(container.querySelector('form')!);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('annuler efface les champs sans fermer la modale', () => {
    const { onClose } = setup();
    const input = screen.getByPlaceholderText('addFencer.last_name_ph') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'dupont' } });
    fireEvent.click(screen.getByText('actions.cancel'));
    expect(input.value).toBe('');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('droitier par défaut, gaucher transmis', () => {
    const { onAdd, container } = setup();
    fireEvent.change(screen.getByPlaceholderText('addFencer.last_name_ph'), {
      target: { value: 'a' },
    });
    fireEvent.change(screen.getByPlaceholderText('addFencer.first_name_ph'), {
      target: { value: 'b' },
    });
    expect((screen.getByLabelText(/addFencer.right/) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText(/addFencer.left/));
    fireEvent.submit(container.querySelector('form')!);
    expect(onAdd.mock.calls[0][0].handedness).toBe('L');
  });

  it('département choisi dans la liste transmis (#1504)', () => {
    const { onAdd, container } = setup();
    fireEvent.change(screen.getByPlaceholderText('addFencer.last_name_ph'), {
      target: { value: 'a' },
    });
    fireEvent.change(screen.getByPlaceholderText('addFencer.first_name_ph'), {
      target: { value: 'b' },
    });
    fireEvent.change(screen.getByLabelText('fencer.department'), { target: { value: '2A' } });
    fireEvent.submit(container.querySelector('form')!);
    expect(onAdd.mock.calls[0][0].department).toBe('2A');
  });

  it('Ajouter garde la modale ouverte et vide le formulaire', () => {
    const { onAdd, onClose } = setup();
    const input = screen.getByPlaceholderText('addFencer.last_name_ph') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.change(screen.getByPlaceholderText('addFencer.first_name_ph'), {
      target: { value: 'b' },
    });
    fireEvent.click(screen.getByText('addFencer.add'));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(input.value).toBe('');
  });

  it('la liste déroulante des nationalités sélectionne le code', () => {
    const { onAdd, container } = setup();
    fireEvent.click(screen.getByLabelText('addFencer.nationality_list', { selector: 'button' }));
    fireEvent.click(container.querySelector('#nat-opt-GER')!);
    fireEvent.change(screen.getByPlaceholderText('addFencer.last_name_ph'), {
      target: { value: 'a' },
    });
    fireEvent.change(screen.getByPlaceholderText('addFencer.first_name_ph'), {
      target: { value: 'b' },
    });
    fireEvent.submit(container.querySelector('form')!);
    expect(onAdd.mock.calls[0][0].nationality).toBe('GER');
  });
});

describe('AddFencerModal : entrée en équipes (docs/adr/0043, F4c)', () => {
  const LEVELS = ['beginner', 'intermediate', 'expert'];

  const setupTeam = async () => {
    const onAdd = vi.fn();
    const onClose = vi.fn();
    const { container } = render(
      <AddFencerModal onAdd={onAdd} onClose={onClose} teamLevels={LEVELS} />
    );
    await screen.findByTestId('team-entry-fields');
    return { onAdd, onClose, container };
  };

  it('saisie des membres, du niveau et du marqueur HANDI ; pas de prénom propre', async () => {
    const { onAdd, container } = await setupTeam();
    expect(screen.queryByPlaceholderText('addFencer.first_name_ph')).toBeNull();
    fireEvent.change(container.querySelector('input[required]')!, {
      target: { value: 'Les Lames' },
    });
    fireEvent.change(document.getElementById('add-fencer-m0-last')!, {
      target: { value: 'durand' },
    });
    fireEvent.change(document.getElementById('add-fencer-m0-first')!, { target: { value: 'Éva' } });
    fireEvent.change(document.getElementById('add-fencer-m0-sex')!, { target: { value: 'F' } });
    fireEvent.change(document.getElementById('add-fencer-m0-birth')!, {
      target: { value: '1989-06-01' },
    });
    fireEvent.change(document.getElementById('add-fencer-m1-last')!, {
      target: { value: 'Petit' },
    });
    fireEvent.change(document.getElementById('add-fencer-m1-sex')!, { target: { value: 'F' } });
    fireEvent.change(document.getElementById('add-fencer-level')!, { target: { value: '2' } });
    fireEvent.click(screen.getByLabelText(/teamEntry\.handicap/));
    fireEvent.submit(container.querySelector('form')!);
    expect(onAdd).toHaveBeenCalledTimes(1);
    const added = onAdd.mock.calls[0][0];
    expect(added).toMatchObject({
      lastName: 'LES LAMES',
      firstName: 'DURAND / PETIT',
      level: 2,
      handicap: true,
      gender: 'F',
      members: [
        { lastName: 'DURAND', firstName: 'Éva', gender: 'F', birthDate: '1989-06-01' },
        { lastName: 'PETIT', firstName: '', gender: 'F' },
      ],
    });
    // La catégorie est déduite par le moteur (moyenne des années de naissance)
    expect('category' in added).toBe(false);
  });

  it('refuse une équipe sans membre nommé', async () => {
    const { onAdd, container } = await setupTeam();
    fireEvent.change(container.querySelector('input[required]')!, { target: { value: 'Duo' } });
    fireEvent.submit(container.querySelector('form')!);
    expect(onAdd).not.toHaveBeenCalled();
  });
});
