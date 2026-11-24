/**
 * BPM - Escrime - Événement fenêtre « DT confirme l'abandon » (#2000)
 * Émis par DTCallNotification (hors CompetitionView), écouté par useRemoteScoreSync qui pose
 * le statut ABANDONED comme le fait l'appel (matchs restants annulés, magasins rafraîchis).
 * Licensed under GPL-3.0
 */

export const DT_CONFIRM_ABANDON_EVENT = 'bp:dt-confirm-abandon';

export interface DtConfirmAbandonDetail {
  fencerId: string;
  competitionId: string | null;
  /** Posé à true par l'écouteur qui a pris en charge l'abandon (compétition affichée). */
  handled: boolean;
}

/** Demande l'enregistrement de l'abandon ; retourne true si une compétition l'a appliqué. */
export function requestConfirmAbandon(fencerId: string, competitionId: string | null): boolean {
  const detail: DtConfirmAbandonDetail = { fencerId, competitionId, handled: false };
  window.dispatchEvent(
    new CustomEvent<DtConfirmAbandonDetail>(DT_CONFIRM_ABANDON_EVENT, { detail })
  );
  return detail.handled;
}

/** Rapport de carton noir (annexe 14) demandé depuis l'appel DT de la tablette (#2190) */
export const DT_BLACK_CARD_REPORT_EVENT = 'bp:dt-black-card-report';

export interface DtBlackCardReportDetail {
  fencerId: string | null;
  competitionId: string | null;
  /** Posé à true par l'écouteur de l'épreuve affichée */
  handled: boolean;
}

/** Demande le rapport pré-rempli ; retourne true si l'épreuve affichée l'a pris en charge. */
export function requestBlackCardReport(
  fencerId: string | null,
  competitionId: string | null
): boolean {
  const detail: DtBlackCardReportDetail = { fencerId, competitionId, handled: false };
  window.dispatchEvent(
    new CustomEvent<DtBlackCardReportDetail>(DT_BLACK_CARD_REPORT_EVENT, { detail })
  );
  return detail.handled;
}
