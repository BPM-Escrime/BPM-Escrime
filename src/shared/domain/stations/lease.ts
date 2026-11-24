/**
 * BPM - Escrime - Bail par épreuve (#1982, docs/adr/0029)
 * Un seul poste orchestre une épreuve : tirage, clôture de tour, tableau. États libre, tenu,
 * orphelin (plus de battement depuis LEASE_ORPHAN_MS). Le bail vit en mémoire du moteur.
 * Fonctions pures : l'heure est injectée, aucun effet.
 * Licensed under GPL-3.0
 */

/** Intervalle du battement de cœur envoyé par le poste qui tient le bail */
export const LEASE_HEARTBEAT_MS = 20_000;

/** Sans battement depuis ce délai, le bail est orphelin */
export const LEASE_ORPHAN_MS = 60_000;

export interface LeaseHolder {
  /** Identifiant de session du poste (appareil) */
  stationId: string;
  /** Compte connecté sur ce poste */
  accountId: string;
}

export interface CompetitionLease {
  competitionId: string;
  holder: LeaseHolder;
  acquiredAt: number;
  lastBeatAt: number;
}

export type LeaseStatus = 'free' | 'held' | 'orphaned';

export type LeaseRefusal = 'lease_held' | 'lease_required';

export type LeaseResult =
  { ok: true; lease: CompetitionLease | null } | { ok: false; code: LeaseRefusal };

export function leaseStatus(lease: CompetitionLease | null | undefined, now: number): LeaseStatus {
  if (!lease) return 'free';
  return now - lease.lastBeatAt >= LEASE_ORPHAN_MS ? 'orphaned' : 'held';
}

function sameStation(lease: CompetitionLease, stationId: string): boolean {
  return lease.holder.stationId === stationId;
}

/**
 * Prendre le bail : épreuve libre, ou bail (même orphelin) déjà tenu par ce poste.
 * Un bail tenu ou orphelin chez un autre poste ne se prend pas : le DT général le transfère.
 */
export function takeLease(
  lease: CompetitionLease | null | undefined,
  competitionId: string,
  holder: LeaseHolder,
  now: number
): LeaseResult {
  if (lease && !sameStation(lease, holder.stationId)) return { ok: false, code: 'lease_held' };
  return {
    ok: true,
    lease: {
      competitionId,
      holder,
      acquiredAt: lease ? lease.acquiredAt : now,
      lastBeatAt: now,
    },
  };
}

/** Battement de cœur : seul le poste qui tient le bail le renouvelle (orphelin compris) */
export function renewLease(
  lease: CompetitionLease | null | undefined,
  stationId: string,
  now: number
): LeaseResult {
  if (!lease || !sameStation(lease, stationId)) return { ok: false, code: 'lease_required' };
  return { ok: true, lease: { ...lease, lastBeatAt: now } };
}

/** Rendre le bail : seul le poste qui le tient */
export function releaseLease(
  lease: CompetitionLease | null | undefined,
  stationId: string
): LeaseResult {
  if (!lease || !sameStation(lease, stationId)) return { ok: false, code: 'lease_required' };
  return { ok: true, lease: null };
}

/**
 * Transfert par le DT général, quel que soit l'état : le nouveau poste tient le bail tout de
 * suite ; l'ancien passe en lecture seule à son prochain appel. Le droit est vérifié par
 * l'appelant (canManageLeases).
 */
export function transferLease(
  competitionId: string,
  to: LeaseHolder,
  now: number
): CompetitionLease {
  return { competitionId, holder: to, acquiredAt: now, lastBeatAt: now };
}

/** Le poste peut-il envoyer une commande d'orchestration ? Bail tenu, même orphelin */
export function holdsLease(lease: CompetitionLease | null | undefined, stationId: string): boolean {
  return !!lease && sameStation(lease, stationId);
}
