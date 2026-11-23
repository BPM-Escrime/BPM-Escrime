/**
 * Poste (#1981 lot 2, docs/adr/0022) : chaque appel de l'écran donne une entrée que le schéma
 * zod de l'opération du contrat accepte (nom d'opération connu, entrée nommée valide).
 */
import { describe, expect, it } from 'vitest';
import { contract, type OperationName } from '../../shared/api/contract';
import { fileOperations } from '../../shared/api/contractFiles';
import type { ApiBridge } from '../../shared/api/client';
import { Weapon } from '../../shared/types';
import { IpcClient } from './IpcClient';
import { createStationApi } from './stationApi';

const seen: Array<{ name: string; input: unknown }> = [];
const bridge: ApiBridge = {
  invoke: async (name, input) => {
    seen.push({ name, input });
    const def = contract[name as OperationName];
    if (!def) return { ok: false, error: { code: 'unknown_operation', message: name } };
    const parsed = def.input.safeParse(input ?? {});
    if (!parsed.success) {
      return { ok: false, error: { code: 'invalid_input', message: parsed.error.message } };
    }
    return { ok: true, data: null };
  },
  subscribe: async () => ({ ok: true, data: null }),
  unsubscribe: () => undefined,
  onEvent: () => () => undefined,
};
const api = createStationApi(new IpcClient(() => bridge));

const theme = {
  id: 'custom-1',
  name: 'Nuit',
  targetType: 'arena' as const,
  variables: { '--bg': '#000' },
  overlayMode: false,
};
const rule = { competitions: ['c1'], pools: true, tableau: false, tableauMax: 8 };

const CALLS: Array<[string, () => Promise<unknown>]> = [
  ['settings.get', () => api.settings.get()],
  ['settings.update', () => api.settings.update({ inkSaving: true, language: 'en' })],
  [
    'settings.importLegacy',
    () =>
      api.settings.importLegacy({ 'bellepoule-language': 'fr', 'bellepoule-logo': null }, 'write'),
  ],
  ['settings.resolve', () => api.settings.resolve('stripCount', { competitionId: 'c1' })],
  ['settings.resolve (sans portée)', () => api.settings.resolve('language')],
  ['settings.listVenues', () => api.settings.listVenues()],
  [
    'settings.upsertVenue',
    () =>
      api.settings.upsertVenue({
        id: 'v1',
        name: 'Gymnase',
        strips: [
          { number: 1, label: 'Bleue', deviceConfig: { protocol: 'cyrano', ip: '10.0.0.5' } },
          { number: 2 },
        ],
        isDefault: true,
      }),
  ],
  ['settings.setDefaultVenue', () => api.settings.setDefaultVenue('v1')],
  ['settings.deleteVenue', () => api.settings.deleteVenue('v1')],
  ['settings.getAgentFolders', () => api.settings.getAgentFolders()],
  ['settings.removeAgentFolder', () => api.settings.removeAgentFolder('/media/usb')],
  ['themes.list', () => api.themes.list()],
  ['themes.save', () => api.themes.save(theme)],
  ['themes.delete', () => api.themes.delete('custom-1')],
  ['eventDay.list', () => api.eventDay.list()],
  [
    'eventDay.create',
    () => api.eventDay.create({ name: 'Open', date: '2026-12-06', stripCount: 16 }),
  ],
  ['eventDay.update', () => api.eventDay.update('d1', { name: 'Open 2026', stripCount: 12 })],
  ['eventDay.delete', () => api.eventDay.delete('d1')],
  ['eventDay.setCompetitionDay', () => api.eventDay.setCompetitionDay('c1', 'd1')],
  ['eventDay.setCompetitionDay (détacher)', () => api.eventDay.setCompetitionDay('c1', null)],
  ['eventDay.listReferees', () => api.eventDay.listReferees('d1')],
  [
    'eventDay.createReferee',
    () =>
      api.eventDay.createReferee('d1', {
        firstName: 'Ada',
        lastName: 'Lovelace',
        club: 'CE',
        weapons: [Weapon.EPEE],
      }),
  ],
  ['eventDay.updateReferee', () => api.eventDay.updateReferee('r1', { weapons: [Weapon.FOIL] })],
  ['eventDay.deleteReferee', () => api.eventDay.deleteReferee('r1')],
  ['eventDay.syncReferees', () => api.eventDay.syncReferees('d1')],
  ['eventDay.getOverview', () => api.eventDay.getOverview('d1')],
  ['eventDay.getBusyElsewhere', () => api.eventDay.getBusyElsewhere('c1')],
  ['eventDay.getStripOccupation', () => api.eventDay.getStripOccupation('d1')],
  ['eventDay.getStripBoard', () => api.eventDay.getStripBoard('d1')],
  ['eventDay.assignStrip', () => api.eventDay.assignStrip('d1', 2, 'c1:pool:p1')],
  ['eventDay.setStripRule', () => api.eventDay.setStripRule('d1', 2, rule)],
  ['eventDay.setStripRule (levée)', () => api.eventDay.setStripRule('d1', 2, null)],
  ['eventDay.setAutoAssign', () => api.eventDay.setAutoAssign('d1', true)],
  ['privacy.getSettings', () => api.privacy.getSettings()],
  [
    'privacy.setSettings',
    () =>
      api.privacy.setSettings({
        nameMasking: 'initials',
        competitionRetentionMonths: 24,
        retentionAction: 'delete',
        autoPurge: true,
      }),
  ],
  ['privacy.findPersons', () => api.privacy.findPersons('lefevre')],
  ['privacy.getPersonData', () => api.privacy.getPersonData({ fencerIds: ['f1'] })],
  [
    'privacy.anonymizePerson',
    () => api.privacy.anonymizePerson({ fencerIds: ['f1'], memberIds: ['m1'] }),
  ],
  ['privacy.erasePerson', () => api.privacy.erasePerson({ fencerIds: ['f1'] })],
  ['privacy.retentionCandidates', () => api.privacy.retentionCandidates()],
  [
    'privacy.applyRetention',
    () => api.privacy.applyRetention({ competitionIds: ['c1'], memberIds: [] }),
  ],
  ['mcp.getStatus', () => api.mcp.getStatus()],
  ['mcp.setSettings', () => api.mcp.setSettings({ enabled: true, port: 8067, allowWrite: false })],
  ['mcp.regenerateToken', () => api.mcp.regenerateToken()],
  ['mcp.getLog', () => api.mcp.getLog()],
];

const methods = Object.entries(api).flatMap(([group, fns]) =>
  Object.keys(fns)
    .filter(m => m !== 'onChanged')
    .map(m => `${group}.${m}`)
);

describe('createStationApi : entrées du contrat', () => {
  it.each(CALLS)('%s', async (_method, call) => {
    seen.length = 0;
    await expect(call()).resolves.toBeNull();
    expect(seen).toHaveLength(1);
    expect(contract).toHaveProperty(seen[0].name);
  });

  it('couvre toutes les méthodes de l’écran', () => {
    const covered = new Set(CALLS.map(([m]) => m.replace(/ \(.*\)$/, '')));
    expect([...covered].sort()).toEqual([...methods].sort());
  });

  it('toutes les opérations station:admin du contrat sont appelées par l’écran', async () => {
    const used = new Set<string>();
    for (const [, call] of CALLS) {
      seen.length = 0;
      await call();
      used.add(seen[0].name);
    }
    api.settings.onChanged(() => undefined);
    used.add('onStationSettingsChanged');
    // Fichiers de données : appelés par filesApi (filesApi.test.ts)
    const declared = (Object.keys(contract) as OperationName[]).filter(
      n => contract[n].permission === 'station:admin' && !(n in fileOperations)
    );
    expect(declared.filter(n => !used.has(n))).toEqual([]);
  });

  it('une entrée hors bornes est refusée par le contrat', async () => {
    await expect(api.mcp.setSettings({ port: 70_000 })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(
      api.privacy.setSettings({ competitionRetentionMonths: 9999 })
    ).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });
});
