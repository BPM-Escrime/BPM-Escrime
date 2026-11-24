// @vitest-environment jsdom
import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { VarRow } from './VarRow';
import {
  DARK_DEFAULTS,
  KIOSK_DEFAULTS,
  KIOSK_VAR_GROUPS,
  VAR_GROUPS,
  themeTargetConfig,
} from './themeEditorDefaults';

vi.mock('../../hooks/useTranslation', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

describe('themeTargetConfig (#2200)', () => {
  it('piste par défaut, kiosque à part', () => {
    expect(themeTargetConfig('arena')).toEqual({
      defaults: DARK_DEFAULTS,
      groups: VAR_GROUPS,
      defaultName: 'Mon thème',
    });
    expect(themeTargetConfig('kiosk')).toEqual({
      defaults: KIOSK_DEFAULTS,
      groups: KIOSK_VAR_GROUPS,
      defaultName: 'Thème kiosk',
    });
    expect(themeTargetConfig('referee').defaultName).toBe('Thème arbitre');
    expect(themeTargetConfig('pool').defaultName).toBe('Thème poule');
    expect(themeTargetConfig('public').defaultName).toBe('Thème public');
  });
});

describe('VarRow (#2200)', () => {
  it('ligne texte : libellé affiché, saisie transmise', () => {
    const onChange = vi.fn();
    const { container } = render(
      <VarRow varKey="--bg" label="Fond" type="text" value="#000" onChange={onChange} />
    );
    expect(screen.getByText('Fond')).toBeInTheDocument();
    const input = container.querySelector('input:not([type="color"])') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '#111' } });
    expect(onChange).toHaveBeenCalledWith('#111');
  });
});
