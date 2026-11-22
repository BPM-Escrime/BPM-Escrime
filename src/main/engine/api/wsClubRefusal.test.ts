/**
 * Le Mode Club n'est jamais servi par le WebSocket (docs/adr/0022) : wsRefusal refuse chaque
 * opération dont le droit commence par « club: », requête et abonnement compris, y compris
 * sur l'épreuve servie.
 */
import { describe, expect, it } from 'vitest';
import { contract, type OperationName } from '../../../shared/api/contract';
import { WS_READ_PERMISSIONS, wsRefusal } from './wsAdapter';

const clubOps = (Object.keys(contract) as OperationName[]).filter(n =>
  contract[n].permission.startsWith('club:')
);

describe('wsRefusal : opérations club:*', () => {
  it('le contrat compte des opérations club:*', () => {
    expect(clubOps.length).toBeGreaterThan(0);
  });

  it('aucun droit club:* n’est servi sur le réseau', () => {
    expect([...WS_READ_PERMISSIONS].filter(p => p.startsWith('club:'))).toEqual([]);
  });

  it.each(clubOps)('%s est refusé (permission_denied)', name => {
    // Entrée portant l'épreuve servie : ne doit rien changer
    const refusal = wsRefusal(name, { competitionId: 'c1', clubId: 'club1' }, 'c1');
    expect(refusal).not.toBeNull();
    expect(refusal?.code).toBe('permission_denied');
  });
});
