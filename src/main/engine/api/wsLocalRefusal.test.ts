/**
 * Les fonctions du poste ne sont jamais servies par le WebSocket (docs/adr/0022) : wsRefusal
 * refuse chaque opération dont le droit commence par « club: » (Mode Club), « station: »
 * (réglages, salles, thèmes, journée, RGPD, agent) ou « remote: » (pilotage du serveur distant),
 * requête et abonnement compris, y compris sur l'épreuve servie.
 */
import { describe, expect, it } from 'vitest';
import { contract, type OperationName } from '../../../shared/api/contract';
import { WS_READ_PERMISSIONS, wsRefusal } from './wsAdapter';

const LOCAL = ['club:', 'station:', 'remote:'] as const;
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
  it('aucune opération club:*, station:* ou remote:* n’est exposée à l’agent, sauf exception d’ADR', () => {
    // Exceptions décidées par ADR, en lecture seulement :
    // - listFormulaTemplates : modèles de formule, ni secret ni effet externe (docs/adr/0033)
    // - getMatchDurations : durées de match agrégées, sans donnée personnelle (docs/adr/0034)
    const ADR_EXCEPTIONS = ['getMatchDurations', 'listFormulaTemplates'];
    const exposed = localOps.filter(n => (contract[n] as { mcp?: unknown }).mcp);
    expect(exposed).toEqual(ADR_EXCEPTIONS);
    for (const n of ADR_EXCEPTIONS) expect(contract[n as keyof typeof contract].kind).toBe('query');
  });
});

describe('STATION_PERMISSIONS (pas de journal, pas de réseau)', () => {
  it('couvre exactement les droits club:, station: et remote: du contrat', async () => {
    const { STATION_PERMISSIONS } = await import('../../../shared/api/contractDef');
    const local = new Set(localOps.map(n => contract[n].permission));
    expect([...STATION_PERMISSIONS].sort()).toEqual([...local].sort());
    expect([...STATION_PERMISSIONS].filter(p => WS_READ_PERMISSIONS.has(p))).toEqual([]);
  });
});
