/**
 * Tests des fonctions du poste : simule le contrat d'API (docs/adr/0022) à partir de fonctions
 * par méthode de l'écran (`createStationApi`, src/renderer/api/stationApi.ts : groupes settings,
 * themes, eventDay, privacy, mcp). Chaque opération du contrat reçoit son entrée nommée et la
 * rend en arguments positionnels à la méthode correspondante : les tests vérifient les appels
 * de l'écran, le contrat lui-même étant couvert par src/main/engine/commands/station.test.ts.
 * Licensed under GPL-3.0
 */
import type { ApiBridge, ApiEnvelope } from '../../shared/api/client';
import { fakeApiBridge, type ApiHandlers } from './apiBridge';

/** Méthodes de l'écran simulées (vi.fn) : groupe → méthode → fonction */
export type StationMocks = Partial<
  Record<'settings' | 'themes' | 'eventDay' | 'privacy' | 'mcp', Record<string, unknown>>
>;

type Input = Record<string, unknown>;

/** Opérations du contrat → groupe, méthode de l'écran et arguments positionnels */
const MAPPING: Record<
  string,
  [group: keyof StationMocks, method: string, args: (i: Input) => unknown[]]
> = {
  getStationSettings: ['settings', 'get', () => []],
  updateStationSettings: ['settings', 'update', i => [i]],
  importLegacySettings: ['settings', 'importLegacy', i => [i.values, i.mode]],
  getResolvedSetting: [
    'settings',
    'resolve',
    ({ key, ...scope }) => [key, Object.keys(scope).length ? scope : undefined],
  ],
  listVenues: ['settings', 'listVenues', () => []],
  saveVenue: ['settings', 'upsertVenue', i => [i]],
  setDefaultVenue: ['settings', 'setDefaultVenue', i => [i.venueId]],
  deleteVenue: ['settings', 'deleteVenue', i => [i.venueId]],
  listAgentFolders: ['settings', 'getAgentFolders', () => []],
  removeAgentFolder: ['settings', 'removeAgentFolder', i => [i.folder]],
  listScreenThemes: ['themes', 'list', () => []],
  saveScreenTheme: ['themes', 'save', i => [i.theme]],
  deleteScreenTheme: ['themes', 'delete', i => [i.themeId]],
  listEventDays: ['eventDay', 'list', () => []],
  createEventDay: ['eventDay', 'create', i => [i]],
  updateEventDayDetails: ['eventDay', 'update', i => [i.dayId, i.details]],
  deleteEventDay: ['eventDay', 'delete', i => [i.dayId]],
  assignCompetitionToDay: ['eventDay', 'setCompetitionDay', i => [i.competitionId, i.dayId]],
  listEventDayReferees: ['eventDay', 'listReferees', i => [i.dayId]],
  registerEventDayReferee: ['eventDay', 'createReferee', i => [i.dayId, i.details]],
  updateEventDayRefereeDetails: ['eventDay', 'updateReferee', i => [i.refereeId, i.details]],
  removeEventDayReferee: ['eventDay', 'deleteReferee', i => [i.refereeId]],
  syncEventDayReferees: ['eventDay', 'syncReferees', i => [i.dayId]],
  getEventDayOverview: ['eventDay', 'getOverview', i => [i.dayId]],
  listBusyElsewhere: ['eventDay', 'getBusyElsewhere', i => [i.competitionId]],
  getDayStripOccupation: ['eventDay', 'getStripOccupation', i => [i.dayId]],
  getDayStripBoard: ['eventDay', 'getStripBoard', i => [i.dayId]],
  assignDayStrip: ['eventDay', 'assignStrip', i => [i.dayId, i.strip, i.key]],
  setDayStripRule: ['eventDay', 'setStripRule', i => [i.dayId, i.strip, i.rule]],
  setDayAutoAssign: ['eventDay', 'setAutoAssign', i => [i.dayId, i.on]],
  getPrivacySettings: ['privacy', 'getSettings', () => []],
  updatePrivacySettings: ['privacy', 'setSettings', i => [i]],
  listPrivacyPersons: ['privacy', 'findPersons', i => [i.query]],
  getPersonData: ['privacy', 'getPersonData', i => [i]],
  anonymizePerson: ['privacy', 'anonymizePerson', i => [i]],
  erasePerson: ['privacy', 'erasePerson', i => [i]],
  listRetentionCandidates: ['privacy', 'retentionCandidates', () => []],
  applyRetention: ['privacy', 'applyRetention', i => [i]],
  getMcpStatus: ['mcp', 'getStatus', () => []],
  updateMcpSettings: ['mcp', 'setSettings', i => [i]],
  regenerateMcpToken: ['mcp', 'regenerateToken', () => []],
  listMcpLog: ['mcp', 'getLog', () => []],
};

/** Gestionnaires du contrat pour `fakeApiBridge`, à partir des méthodes de l'écran simulées */
export function stationHandlers(mocks: StationMocks): ApiHandlers {
  const handlers: ApiHandlers = {};
  for (const [op, [group, method, toArgs]] of Object.entries(MAPPING)) {
    if (!mocks[group]) continue;
    handlers[op] = input => {
      const fn = mocks[group]?.[method] as ((...args: unknown[]) => unknown) | undefined;
      if (!fn) throw new Error(`Méthode du poste non simulée : ${group}.${method}`);
      return fn(...toArgs(input));
    };
  }
  return handlers;
}

/**
 * `window.electronAPI` d'un test des fonctions du poste : pont du contrat. `extra` ajoute
 * d'autres opérations du contrat ou des groupes de l'API Electron (db, privacy.exportPerson…).
 */
export function stationElectron(
  mocks: StationMocks,
  extra: { api?: ApiHandlers; [group: string]: unknown } = {}
): { api: ApiBridge; [group: string]: unknown } {
  const { api: extraApi, ...rest } = extra;
  return { ...rest, api: fakeApiBridge({ ...stationHandlers(mocks), ...extraApi }) };
}

/**
 * Pont du contrat dont les événements d'abonnement sont émis par le test : `emit(name, event)`
 * livre l'événement aux abonnés de l'opération `name`.
 */
export function eventfulBridge(handlers: ApiHandlers): {
  api: ApiBridge;
  emit: (name: string, event: unknown) => void;
} {
  const base = fakeApiBridge(handlers);
  const subs = new Map<string, string>();
  let listener: ((id: string, event: unknown) => void) | null = null;
  const ok: ApiEnvelope<null> = { ok: true, data: null };
  return {
    api: {
      ...base,
      subscribe: async (id, name) => {
        subs.set(id, name);
        return ok;
      },
      unsubscribe: id => void subs.delete(id),
      onEvent: cb => {
        listener = cb;
        return () => {
          listener = null;
        };
      },
    },
    emit: (name, event) => {
      for (const [id, n] of subs) if (n === name) listener?.(id, event);
    },
  };
}
