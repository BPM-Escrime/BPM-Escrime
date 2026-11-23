/**
 * BPM - Escrime - Nombre de pistes issu de la salle (#1880)
 * Pistes de la journée de l'épreuve, sinon de sa salle, sinon de la salle par défaut.
 * Licensed under GPL-3.0
 */
import { stationApi } from '../../api/stationApi';

/** Nombre de pistes résolu pour l'épreuve ; 0 si inconnu (pas de salle, hors Electron, erreur) */
export async function fetchVenueStripCount(competitionId: string): Promise<number> {
  try {
    const value = await stationApi.settings.resolve('stripCount', { competitionId });
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}
