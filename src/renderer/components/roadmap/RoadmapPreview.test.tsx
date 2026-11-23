// @vitest-environment jsdom
/**
 * Aperçu de la feuille de route : variable sans valeur → son champ, sinon la section
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { createRoadmap } from '@shared/domain/roadmap/presets';
import { roadmapVariables } from '@shared/domain/roadmap/roadmap';
import { RoadmapPreview } from './RoadmapPreview';

describe('RoadmapPreview', () => {
  const doc = createRoadmap('fencing', { title: 'Challenge' });
  const vars = roadmapVariables(doc.info, iso => iso);

  it('clic sur une variable sans valeur → onPickVariable, pas la section', () => {
    const onPickSection = vi.fn();
    const onPickVariable = vi.fn();
    const { container } = render(
      <RoadmapPreview
        doc={doc}
        vars={vars}
        onPickSection={onPickSection}
        onPickVariable={onPickVariable}
      />
    );
    const mark = container.querySelector('[data-section] mark[data-var]') as HTMLElement;
    expect(mark).toBeTruthy();
    fireEvent.click(mark);
    expect(onPickVariable).toHaveBeenCalledWith(mark.dataset.var);
    expect(onPickSection).not.toHaveBeenCalled();
  });

  it('clic ailleurs dans une section → onPickSection', () => {
    const onPickSection = vi.fn();
    const { container } = render(
      <RoadmapPreview
        doc={doc}
        vars={vars}
        onPickSection={onPickSection}
        onPickVariable={vi.fn()}
      />
    );
    const section = container.querySelector('[data-section]') as HTMLElement;
    fireEvent.click(section);
    expect(onPickSection).toHaveBeenCalledWith(section.dataset.section);
  });

  it('{date} manquante dans l’en-tête → onPickVariable("date")', () => {
    const onPickVariable = vi.fn();
    const { container } = render(
      <RoadmapPreview doc={doc} vars={vars} onPickVariable={onPickVariable} />
    );
    fireEvent.click(container.querySelector('.rm-titlebox [data-var="date"]') as HTMLElement);
    expect(onPickVariable).toHaveBeenCalledWith('date');
  });
});
