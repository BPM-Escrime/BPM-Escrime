// @vitest-environment jsdom
/**
 * Tests unitaires - TimeInput (24 h / AM-PM)
 * BPM - Escrime
 */

import '@testing-library/jest-dom';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { act, render, screen, fireEvent } from '@testing-library/react';
vi.mock('../../hooks/useTranslation', () => import('../../testUtils/i18nMock'));
import { TimeInput, from12h, to12h, splitTime } from './TimeInput';
import { saveTimeFormat, loadTimeFormat } from '../../services/timeFormat';

describe('conversions', () => {
  it('splitTime', () => {
    expect(splitTime('8:05')).toEqual(['08', '05']);
    expect(splitTime('24:00')).toEqual(['', '']);
    expect(splitTime('')).toEqual(['', '']);
  });
  it('to12h / from12h', () => {
    expect(to12h('00')).toEqual(['12', 'AM']);
    expect(to12h('12')).toEqual(['12', 'PM']);
    expect(to12h('15')).toEqual(['03', 'PM']);
    expect(from12h('12', 'AM')).toBe('00');
    expect(from12h('12', 'PM')).toBe('12');
    expect(from12h('03', 'PM')).toBe('15');
  });
});

describe('TimeInput', () => {
  beforeEach(() => {
    localStorage.clear();
    act(() => saveTimeFormat('24h'));
  });

  it('24 h par défaut', () => {
    localStorage.clear();
    expect(loadTimeFormat()).toBe('24h');
  });

  it('24 h : heures 00–23, pas de AM/PM', () => {
    const onChange = vi.fn();
    render(<TimeInput value="15:46" onChange={onChange} />);
    expect(screen.getByLabelText('heures')).toHaveValue('15');
    expect(screen.queryByLabelText('AM/PM')).toBeNull();
    fireEvent.change(screen.getByLabelText('minutes'), { target: { value: '05' } });
    expect(onChange).toHaveBeenCalledWith('15:05');
  });

  it('AM/PM : affiche 03 PM, renvoie toujours HH:MM en 24 h', () => {
    act(() => saveTimeFormat('12h'));
    const onChange = vi.fn();
    render(<TimeInput value="15:46" onChange={onChange} />);
    expect(screen.getByLabelText('heures')).toHaveValue('03');
    expect(screen.getByLabelText('AM/PM')).toHaveValue('PM');
    fireEvent.change(screen.getByLabelText('AM/PM'), { target: { value: 'AM' } });
    expect(onChange).toHaveBeenCalledWith('03:46');
  });

  it('vider l’heure vide la valeur', () => {
    const onChange = vi.fn();
    render(<TimeInput value="09:00" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('heures'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith('');
  });
});
