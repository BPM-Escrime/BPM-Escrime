// @vitest-environment jsdom
/**
 * Tests de composant - ArenaPlannerModal : aperçu et contrôle de placement (#2075)
 * Licensed under GPL-3.0
 */

import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';

vi.mock('../hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string, p?: Record<string, string | number>) =>
      p
        ? `${k} ${Object.entries(p)
            .map(([a, b]) => `${a}=${b}`)
            .join(' ')}`
        : k,
  }),
}));
vi.mock('../hooks/useFocusTrap', () => ({ useFocusTrap: () => ({ current: null }) }));
import { ArenaPlannerModal } from './ArenaPlannerModal';

describe('ArenaPlannerModal', () => {
  it('affiche que la salle tient pour une arène dans 20 × 20 m', () => {
    render(<ArenaPlannerModal onClose={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent('arenaPlanner.fits');
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  it("signale une salle trop petite et met à jour l'aperçu", () => {
    render(<ArenaPlannerModal onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('arenaPlanner.width'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('arenaPlanner.length'), { target: { value: '10' } });
    expect(screen.getByRole('status')).toHaveTextContent('arenaPlanner.nofit');
  });

  it('refuse des dimensions non positives', () => {
    render(<ArenaPlannerModal onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('arenaPlanner.width'), { target: { value: '0' } });
    expect(screen.getByRole('alert')).toHaveTextContent('arenaPlanner.invalid');
  });

  it('ajoute un élément et le déplace au clavier (flèches), retenu dans la salle', () => {
    render(<ArenaPlannerModal onClose={() => {}} />);
    fireEvent.click(screen.getByText('arenaPlanner.add_table'));
    const item = screen.getByRole('button', { name: /arenaPlanner\.kind_table 1/ });
    const before = item.querySelector('rect')!.getAttribute('x');
    fireEvent.keyDown(item, { key: 'ArrowRight', shiftKey: true });
    const after = item.querySelector('rect')!.getAttribute('x');
    expect(Number(after)).toBeGreaterThan(Number(before));
  });

  it("supprime l'élément sélectionné avec la touche Suppr", () => {
    render(<ArenaPlannerModal onClose={() => {}} />);
    fireEvent.click(screen.getByText('arenaPlanner.add_outlet'));
    const item = screen.getByRole('button', { name: /arenaPlanner\.kind_outlet 1/ });
    fireEvent.keyDown(item, { key: 'Delete' });
    expect(screen.queryByRole('button', { name: /arenaPlanner\.kind_outlet 1/ })).toBeNull();
  });

  it('ajoute une issue de secours collée au mur, sans alerte', () => {
    render(<ArenaPlannerModal onClose={() => {}} />);
    fireEvent.click(screen.getByText('arenaPlanner.add_exit'));
    expect(screen.getByRole('button', { name: /arenaPlanner\.kind_exit 1/ })).toBeInTheDocument();
    expect(screen.queryByText('arenaPlanner.exit_wall')).toBeNull();
  });

  it('ajoute une zone bloquée et permet de changer sa largeur', () => {
    render(<ArenaPlannerModal onClose={() => {}} />);
    fireEvent.click(screen.getByText('arenaPlanner.add_blocked'));
    const width = screen.getByLabelText(/arenaPlanner\.block_width/) as HTMLInputElement;
    fireEvent.change(width, { target: { value: '3' } });
    const item = screen.getByRole('button', { name: /arenaPlanner\.kind_blocked 1/ });
    expect(item.querySelector('rect')!.getAttribute('width')).toBe('3');
  });
});
