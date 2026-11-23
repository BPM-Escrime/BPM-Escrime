// @vitest-environment jsdom
/**
 * Page Organisation : raccourcis plan de salle et feuille de route
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import OrganizationModal from './OrganizationModal';

vi.mock('../../hooks/useTranslation', () => import('../../testUtils/i18nMock'));

const t = (k: string) => k;

describe('OrganizationModal', () => {
  it('ouvre le plan de salle et ferme la page', () => {
    const onClose = vi.fn();
    const onOpenArenaPlanner = vi.fn();
    render(
      <OrganizationModal
        t={t}
        onClose={onClose}
        onOpenArenaPlanner={onOpenArenaPlanner}
        onOpenRoadmap={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId('organization-arena-planner'));
    expect(onClose).toHaveBeenCalled();
    expect(onOpenArenaPlanner).toHaveBeenCalled();
  });

  it('ouvre la feuille de route', () => {
    const onOpenRoadmap = vi.fn();
    render(<OrganizationModal t={t} onClose={vi.fn()} onOpenRoadmap={onOpenRoadmap} />);
    expect(screen.queryByTestId('organization-arena-planner')).toBeNull();
    fireEvent.click(screen.getByTestId('organization-roadmap'));
    expect(onOpenRoadmap).toHaveBeenCalled();
  });
});
