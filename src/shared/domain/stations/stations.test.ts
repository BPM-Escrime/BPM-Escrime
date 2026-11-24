/**
 * Multi-poste (#1982, docs/adr/0029) : bail par épreuve et matrice des rôles.
 */
import { describe, expect, it } from 'vitest';
import {
  holdsLease,
  LEASE_ORPHAN_MS,
  leaseStatus,
  releaseLease,
  renewLease,
  takeLease,
  transferLease,
  type CompetitionLease,
} from './lease';
import {
  ALL_ACCESS_RIGHTS,
  canManageLeases,
  decideAccess,
  ROLE_RIGHTS,
  type StationAccount,
} from './roles';

const A = { stationId: 'poste-a', accountId: 'dt-m15' };
const B = { stationId: 'poste-b', accountId: 'dt-m17' };
const T0 = 1_000_000;

function heldBy(holder = A, lastBeatAt = T0): CompetitionLease {
  return { competitionId: 'm15', holder, acquiredAt: T0, lastBeatAt };
}

describe('bail par épreuve', () => {
  it('libre, tenu, orphelin après 60 s sans battement', () => {
    expect(leaseStatus(null, T0)).toBe('free');
    expect(leaseStatus(heldBy(), T0 + LEASE_ORPHAN_MS - 1)).toBe('held');
    expect(leaseStatus(heldBy(), T0 + LEASE_ORPHAN_MS)).toBe('orphaned');
  });

  it('prendre : libre ou déjà à soi ; refusé chez un autre poste, même orphelin', () => {
    const taken = takeLease(null, 'm15', A, T0);
    expect(taken).toEqual({ ok: true, lease: heldBy() });
    const back = takeLease(heldBy(), 'm15', A, T0 + 90_000);
    expect(back).toEqual({ ok: true, lease: heldBy(A, T0 + 90_000) });
    expect(takeLease(heldBy(), 'm15', B, T0)).toEqual({ ok: false, code: 'lease_held' });
    expect(takeLease(heldBy(), 'm15', B, T0 + 2 * LEASE_ORPHAN_MS)).toEqual({
      ok: false,
      code: 'lease_held',
    });
  });

  it('battement : le poste revient, l’épreuve orpheline redevient tenue', () => {
    const now = T0 + LEASE_ORPHAN_MS + 5_000;
    const renewed = renewLease(heldBy(), A.stationId, now);
    expect(renewed.ok && leaseStatus(renewed.lease, now)).toBe('held');
    expect(renewLease(heldBy(), B.stationId, now)).toEqual({ ok: false, code: 'lease_required' });
    expect(renewLease(null, A.stationId, now)).toEqual({ ok: false, code: 'lease_required' });
  });

  it('rendre : seul le poste qui tient le bail', () => {
    expect(releaseLease(heldBy(), A.stationId)).toEqual({ ok: true, lease: null });
    expect(releaseLease(heldBy(), B.stationId)).toEqual({ ok: false, code: 'lease_required' });
  });

  it('transfert : le nouveau poste tient, l’ancien perd l’orchestration', () => {
    const moved = transferLease('m15', B, T0 + 75_000);
    expect(holdsLease(moved, B.stationId)).toBe(true);
    expect(holdsLease(moved, A.stationId)).toBe(false);
    expect(leaseStatus(moved, T0 + 75_000)).toBe('held');
  });
});

describe('rôles et droits', () => {
  const account = (role: StationAccount['role'], extra: Partial<StationAccount> = {}) => ({
    id: role,
    role,
    competitionIds: [],
    ...extra,
  });

  it('seul admin a les fonctions du poste', () => {
    for (const role of Object.keys(ROLE_RIGHTS) as StationAccount['role'][]) {
      expect(ROLE_RIGHTS[role].has('station:admin')).toBe(role === 'admin');
      expect(ROLE_RIGHTS[role].has('remote:admin')).toBe(role === 'admin');
    }
    expect(ROLE_RIGHTS.admin.size).toBe(ALL_ACCESS_RIGHTS.length);
  });

  it('pointage : pointe sans bail, ne saisit pas de score', () => {
    const pointage = account('checkIn');
    const base = { competitionId: 'm15', stationId: 'tel', lease: heldBy() };
    expect(decideAccess(pointage, { ...base, right: 'checkin:write' })).toEqual({ ok: true });
    expect(decideAccess(pointage, { ...base, right: 'score:write' })).toEqual({
      ok: false,
      code: 'permission_denied',
    });
  });

  it('assistant : saisit, ne génère pas de tirage, reste dans ses épreuves', () => {
    const assistant = account('assistant', { competitionIds: ['m15'] });
    const base = { competitionId: 'm15', stationId: 'pc', lease: null };
    expect(decideAccess(assistant, { ...base, right: 'score:write' }).ok).toBe(true);
    expect(decideAccess(assistant, { ...base, right: 'structure:write' }).ok).toBe(false);
    expect(
      decideAccess(assistant, { ...base, competitionId: 'm17', right: 'score:write' }).ok
    ).toBe(false);
    expect(
      decideAccess(assistant, { ...base, competitionId: 'm17', right: 'competition:read' })
    ).toEqual({ ok: true });
  });

  it('DT d’épreuve : orchestre avec le bail, lit l’autre épreuve sans pouvoir y écrire', () => {
    const dt = account('competitionDirector');
    const m15 = { competitionId: 'm15', stationId: A.stationId, lease: heldBy() };
    expect(decideAccess(dt, { ...m15, right: 'structure:write' })).toEqual({ ok: true });
    const m17 = { competitionId: 'm17', stationId: A.stationId, lease: heldBy(B) };
    expect(decideAccess(dt, { ...m17, right: 'competition:read' })).toEqual({ ok: true });
    expect(decideAccess(dt, { ...m17, right: 'structure:write' })).toEqual({
      ok: false,
      code: 'lease_required',
    });
  });

  it('DT général : gère les baux, transfère au lieu de passer outre', () => {
    const general = account('dayDirector');
    expect(canManageLeases(general)).toBe(true);
    expect(canManageLeases(account('competitionDirector'))).toBe(false);
    expect(
      decideAccess(general, {
        right: 'structure:write',
        competitionId: 'm15',
        stationId: 'portable',
        lease: heldBy(),
      })
    ).toEqual({ ok: false, code: 'lease_required' });
    expect(decideAccess(general, { right: 'fencers:write', stationId: 'portable' })).toEqual({
      ok: true,
    });
    expect(
      decideAccess(account('competitionDirector'), { right: 'fencers:write', stationId: 'pc' }).ok
    ).toBe(false);
  });

  it('arbitre : saisie limitée à son arène ; public : lecture seule', () => {
    const referee = account('referee', { arena: 3 });
    const base = { competitionId: 'm15', stationId: 'tab', right: 'score:write' as const };
    expect(decideAccess(referee, { ...base, arena: 3 }).ok).toBe(true);
    expect(decideAccess(referee, { ...base, arena: 4 }).ok).toBe(false);
    expect(decideAccess(account('public'), base).ok).toBe(false);
    expect(decideAccess(account('public'), { ...base, right: 'cards:read' }).ok).toBe(true);
  });
});
