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

/** Élément de base ajouté par le menu « Équipement » */
const addKind = (kind: string) =>
  fireEvent.change(screen.getByLabelText('arenaPlanner.add_equipment'), {
    target: { value: `kind:${kind}` },
  });

describe('ArenaPlannerModal', () => {
  it('affiche que la salle tient pour une arène dans 20 × 20 m', () => {
    render(<ArenaPlannerModal onClose={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent('arenaPlanner.optimize_result');
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  it("signale une salle trop petite et met à jour l'aperçu", () => {
    render(<ArenaPlannerModal onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('arenaPlanner.width'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('arenaPlanner.length'), { target: { value: '10' } });
    expect(screen.getByRole('alert')).toHaveTextContent('arenaPlanner.nofit');
  });

  it('refuse des dimensions non positives', () => {
    render(<ArenaPlannerModal onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('arenaPlanner.width'), { target: { value: '0' } });
    expect(screen.getByRole('alert')).toHaveTextContent('arenaPlanner.invalid');
  });

  it('ajoute un élément et le déplace au clavier (flèches), retenu dans la salle', () => {
    render(<ArenaPlannerModal onClose={() => {}} />);
    addKind('table');
    const item = screen.getByRole('button', { name: /arenaPlanner\.kind_table 1/ });
    const before = item.querySelector('rect')!.getAttribute('x');
    fireEvent.keyDown(item, { key: 'ArrowRight', shiftKey: true });
    const after = item.querySelector('rect')!.getAttribute('x');
    expect(Number(after)).toBeGreaterThan(Number(before));
  });

  it("supprime l'élément sélectionné avec la touche Suppr", () => {
    render(<ArenaPlannerModal onClose={() => {}} />);
    addKind('outlet');
    const item = screen.getByRole('button', { name: /arenaPlanner\.kind_outlet 1/ });
    fireEvent.keyDown(item, { key: 'Delete' });
    expect(screen.queryByRole('button', { name: /arenaPlanner\.kind_outlet 1/ })).toBeNull();
  });

  it('ajoute une issue de secours collée au mur, sans alerte', () => {
    render(<ArenaPlannerModal onClose={() => {}} />);
    addKind('exit');
    expect(screen.getByRole('button', { name: /arenaPlanner\.kind_exit 1/ })).toBeInTheDocument();
    expect(screen.queryByText('arenaPlanner.exit_wall')).toBeNull();
  });

  it('ajoute une zone bloquée et permet de changer sa largeur', () => {
    render(<ArenaPlannerModal onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('arenaPlanner.add_zone'), {
      target: { value: 'kind:blocked' },
    });
    const width = screen.getByLabelText('arenaPlanner.size_w') as HTMLInputElement;
    fireEvent.change(width, { target: { value: '3' } });
    const item = screen.getByRole('button', { name: /arenaPlanner\.kind_blocked 1/ });
    expect(item.querySelector('rect')!.getAttribute('width')).toBe('3');
  });

  it('ajoute une zone public nommée depuis le menu « Zone »', () => {
    render(<ArenaPlannerModal onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('arenaPlanner.add_zone'), {
      target: { value: 'public' },
    });
    const zone = screen.getByRole('button', { name: /arenaPlanner\.zone_public/ });
    expect(zone.querySelector('.arena-planner-zone-public')).not.toBeNull();
  });

  it('nomme une arène et affiche son nom sur le plan', () => {
    render(<ArenaPlannerModal onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('arenaPlanner.arena_name n=1'), {
      target: { value: 'Piste Rouge' },
    });
    expect(document.querySelector('.arena-planner-arena-name')).toHaveTextContent('Piste Rouge');
  });

  it("change la couleur d'une zone puis revient à la couleur par défaut", () => {
    render(<ArenaPlannerModal onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('arenaPlanner.add_zone'), {
      target: { value: 'dt' },
    });
    const rect = () =>
      screen
        .getByRole('button', { name: /arenaPlanner\.zone_dt/ })
        .querySelector('rect') as SVGRectElement;
    const picker = screen.getByLabelText('arenaPlanner.item_color') as HTMLInputElement;
    expect(picker.value).toBe('#fdba74');
    fireEvent.change(picker, { target: { value: '#ff0000' } });
    expect(rect().style.fill).toMatch(/#ff0000|rgb\(255, 0, 0\)/);
    fireEvent.click(screen.getByText('arenaPlanner.item_color_reset'));
    expect(rect().style.fill).toBe('');
  });

  it("Optimiser affiche le maximum trouvé et règle le nombre d'arènes", () => {
    render(<ArenaPlannerModal onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('arenaPlanner.width'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('arenaPlanner.length'), { target: { value: '30' } });
    fireEvent.click(screen.getByText('arenaPlanner.optimize'));
    expect(screen.getByRole('status')).toHaveTextContent('arenaPlanner.optimize_result');
    expect((screen.getByLabelText('arenaPlanner.arenas') as HTMLInputElement).value).toBe('4');
  });

  it("ne permet jamais plus d'arènes que le maximum de la zone", () => {
    render(<ArenaPlannerModal onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('arenaPlanner.width'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('arenaPlanner.length'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('arenaPlanner.arenas'), { target: { value: '10' } });
    expect(screen.getByRole('alert')).toHaveTextContent('arenaPlanner.too_many');
    expect(screen.getByRole('status')).toHaveTextContent('arenaPlanner.optimize_result');
    expect(screen.getAllByRole('img')[0].querySelectorAll('.arena-planner-safety')).toHaveLength(4);
  });

  it('étire les arènes avec « Espacées » et les centre avec « Centré »', () => {
    render(<ArenaPlannerModal onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('arenaPlanner.width'), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText('arenaPlanner.length'), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText('arenaPlanner.arenas'), { target: { value: '2' } });
    const arenaCentres = () =>
      Array.from(screen.getAllByRole('img')[0].querySelectorAll('.arena-planner-safety')).map(
        el => ({
          x: Number(el.getAttribute('cx')),
          y: Number(el.getAttribute('cy')),
        })
      );
    const dist = () => {
      const [a, b] = arenaCentres();
      return Math.hypot(b.x - a.x, b.y - a.y);
    };
    const packedDist = dist();
    fireEvent.change(screen.getByLabelText('arenaPlanner.spacing'), {
      target: { value: 'spread' },
    });
    expect(dist()).toBeGreaterThan(packedDist);
    fireEvent.change(screen.getByLabelText('arenaPlanner.align'), {
      target: { value: 'center' },
    });
    // Cercles de sécurité de Ø 12 m (rayon 6 m) : marges gauche et droite égales dans une salle de 40 m
    const xs = arenaCentres().map(c => c.x);
    expect(Math.min(...xs) - 6).toBeCloseTo(40 - (Math.max(...xs) + 6), 3);
  });

  it('affiche les cotes techniques quand la case est cochée', () => {
    render(<ArenaPlannerModal onClose={() => {}} />);
    expect(document.querySelectorAll('.arena-planner-dimline')).toHaveLength(0);
    fireEvent.click(screen.getByLabelText('arenaPlanner.dims_option'));
    expect(document.querySelectorAll('.arena-planner-dimline').length).toBeGreaterThan(0);
  });

  it('modifie le texte affiché sur une table, sur plusieurs lignes', () => {
    render(<ArenaPlannerModal onClose={() => {}} />);
    addKind('table');
    fireEvent.change(screen.getByLabelText('arenaPlanner.item_text'), {
      target: { value: 'Table DT\nRésultats' },
    });
    const item = screen.getByRole('button', { name: /Table DT Résultats/ });
    const lines = Array.from(item.querySelectorAll('tspan')).map(n => n.textContent);
    expect(lines).toEqual(['Table DT', 'Résultats']);
  });

  it('ajoute une deuxième salle indépendante, puis la supprime', () => {
    render(<ArenaPlannerModal onClose={() => {}} />);
    addKind('table');
    fireEvent.click(screen.getByText('arenaPlanner.add_room'));
    expect(screen.getByRole('button', { name: 'arenaPlanner.room_default 2' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.queryByRole('button', { name: /arenaPlanner\.kind_table 1/ })).toBeNull();
    fireEvent.change(screen.getByLabelText('arenaPlanner.room_name'), {
      target: { value: 'Gymnase B' },
    });
    expect(screen.getByRole('button', { name: 'Gymnase B' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'arenaPlanner.room_default 1' }));
    expect(screen.getByRole('button', { name: /arenaPlanner\.kind_table 1/ })).toBeInTheDocument();
    fireEvent.click(screen.getByText('arenaPlanner.remove_room'));
    expect(screen.queryByRole('button', { name: 'arenaPlanner.room_default 1' })).toBeNull();
    expect(screen.getByText('arenaPlanner.remove_room').closest('button')).toBeDisabled();
  });

  it("zoome et revient à la taille réelle sans changer la vue d'export", () => {
    render(<ArenaPlannerModal onClose={() => {}} />);
    const svg = screen.getByRole('img');
    const full = svg.getAttribute('viewBox');
    expect(svg.getAttribute('data-full-viewbox')).toBe(full);
    fireEvent.click(screen.getByLabelText('arenaPlanner.zoom_in'));
    expect(svg.getAttribute('viewBox')).not.toBe(full);
    expect(svg.getAttribute('data-full-viewbox')).toBe(full);
    fireEvent.click(screen.getByText('125 %'));
    expect(svg.getAttribute('viewBox')).toBe(full);
    expect(screen.getByLabelText('arenaPlanner.zoom_out')).toBeDisabled();
  });

  it("vue d'ensemble : déplace une salle au clavier et l'ouvre avec Entrée", () => {
    render(<ArenaPlannerModal onClose={() => {}} />);
    fireEvent.click(screen.getByText('arenaPlanner.add_room'));
    fireEvent.click(screen.getByText('arenaPlanner.overview'));
    expect(screen.getByRole('img', { name: 'arenaPlanner.overview' })).toBeInTheDocument();
    const second = screen.getByRole('button', {
      name: /^arenaPlanner\.room_default 2, x 23 m, y 0 m/,
    });
    fireEvent.keyDown(second, { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(second, { key: 'ArrowDown', shiftKey: true });
    expect(
      screen.getByRole('button', { name: /^arenaPlanner\.room_default 2, x 24 m, y 1 m/ })
    ).toBeInTheDocument();
    fireEvent.keyDown(
      screen.getByRole('button', { name: /^arenaPlanner\.room_default 1, x 0 m/ }),
      {
        key: 'Enter',
      }
    );
    expect(screen.queryByRole('img', { name: 'arenaPlanner.overview' })).toBeNull();
    expect(screen.getByRole('button', { name: 'arenaPlanner.room_default 1' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });
});
