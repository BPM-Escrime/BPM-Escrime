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
});
