/**
 * Les fonctions du poste ne sont jamais servies par le WebSocket (docs/adr/0022) : wsRefusal
 * refuse chaque opération dont le droit commence par « club: » (Mode Club) ou « station: »
 * (réglages, salles, thèmes, journée, RGPD, agent), requête et abonnement compris, y compris
 * sur l'épreuve servie.
 */
import { describe, expect, it } from 'vitest';
import { contract, type OperationName } from '../../../shared/api/contract';
import { WS_READ_PERMISSIONS, wsRefusal } from './wsAdapter';

const LOCAL = ['club:', 'station:'] as const;
const isLocal = (permission: string) => LOCAL.some(prefix => permission.startsWith(prefix));

const localOps = (Object.keys(contract) as OperationName[]).filter(n =>
  isLocal(contract[n].permission)
);

describe.each(LOCAL)('wsRefusal : opérations %s*', prefix => {
  const ops = localOps.filter(n => contract[n].permission.startsWith(prefix));

  it('le contrat compte des opérations de ce groupe', () => {
    expect(ops.length).toBeGreaterThan(0);
  });

  it('aucun droit du groupe n’est servi sur le réseau', () => {
    expect([...WS_READ_PERMISSIONS].filter(p => p.startsWith(prefix))).toEqual([]);
  });

  it.each(ops)('%s est refusé (permission_denied)', name => {
    // Entrée portant l'épreuve servie : ne doit rien changer
    const refusal = wsRefusal(name, { competitionId: 'c1', clubId: 'club1', dayId: 'd1' }, 'c1');
    expect(refusal).not.toBeNull();
    expect(refusal?.code).toBe('permission_denied');
  });
});

describe('opérations du poste : pas d’outil MCP', () => {
  it('aucune opération station:admin n’est exposée à l’agent', () => {
    const exposed = localOps.filter(n => (contract[n] as { mcp?: unknown }).mcp);
    expect(exposed).toEqual([]);
  });
});
