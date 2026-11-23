// @vitest-environment jsdom
/**
 * Champ « Lieu » : suggestions après la frappe, choix au clic (docs/adr/0026)
 */
import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PlaceSearchField } from './PlaceSearchField';
import type { PlaceSuggestion } from '@shared/domain/places/placeSearch';

vi.mock('../../hooks/useTranslation', () => import('../../testUtils/i18nMock'));
const searchPlaces = vi.fn();
vi.mock('../../api/stationApi', () => ({
  stationAvailable: () => true,
  useStationApi: () => ({ settings: { searchPlaces } }),
}));

const gym: PlaceSuggestion = {
  name: 'Gymnase Jean-Jaurès',
  address: 'Avenue Jean Jaurès, 69170 Tarare',
  city: 'Tarare',
  postcode: '69170',
  lat: 45.89,
  lon: 4.43,
  source: 'osm',
};

const Harness: React.FC<{ onPick?: (p: PlaceSuggestion) => void }> = ({ onPick }) => {
  const [v, setV] = useState('');
  return <PlaceSearchField ariaLabel="lieu" value={v} onChange={setV} onPick={onPick} />;
};

describe('PlaceSearchField', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    searchPlaces.mockReset();
  });

  it('cherche après la pause, choix → « nom, commune » et onPick', async () => {
    searchPlaces.mockResolvedValue({ suggestions: [gym], unavailable: false });
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    const input = screen.getByLabelText('lieu') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'gy' } });
    fireEvent.change(input, { target: { value: 'gymnase tarare' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(searchPlaces).toHaveBeenCalledTimes(1);
    expect(searchPlaces).toHaveBeenCalledWith('gymnase tarare', expect.any(String));
    fireEvent.click(screen.getByRole('option'));
    expect(input.value).toBe('Gymnase Jean-Jaurès, Tarare');
    expect(onPick).toHaveBeenCalledWith(gym);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('hors ligne : message, saisie libre gardée', async () => {
    searchPlaces.mockResolvedValue({ suggestions: [], unavailable: true });
    render(<Harness />);
    const input = screen.getByLabelText('lieu') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'salle des fêtes' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.getByRole('listbox').textContent).toContain('Recherche indisponible');
    expect(input.value).toBe('salle des fêtes');
  });
});
