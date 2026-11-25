/**
 * BPM - Escrime - Poste : appels de l'écran au contrat d'API (#1981 lot 2, docs/adr/0022)
 * Un seul endroit traduit les appels de l'écran (arguments positionnels, mêmes noms que les
 * anciens groupes settings, themes, eventDay, privacy, mcp et proxy, et des logos de
 * window.electronAPI) en
 * opérations du contrat (entrées nommées, shared/api/contractStation.ts). Hors Electron, le
 * client lève ApiError('unavailable') : `stationAvailable()` dit s'il y a un poste à piloter.
 * Les dossiers (sauvegarde, agent) sont choisis par `usePlatform().desktop.pickDirectory`, puis
 * enregistrés ici (docs/adr/0030). Reste en IPC ce qui porte un chemin de fichier : archives .bpm
 * chiffrées (window.electronAPI.privacy, ADR-0021).
 * Licensed under GPL-3.0
 */
import { useMemo } from 'react';
import type { BpmClient } from '../../shared/api/client';
import type { AppSettings, LogoLibraryEntry, VenueInput } from '../../shared/types/appSettings';
import type { ProxySettingsDTO } from '../../shared/types/systemSettings';
import type { CustomTheme } from '../../shared/types/remote';
import type { DayRefereeInput, StripRule } from '../../shared/types/eventDay';
import type { PrivacyPersonRef, PrivacySettings } from '../../shared/types/privacy';
import { weaponCode, type DurationKey } from '../../shared/domain/durations/matchDurations';
import type {
  FormulaTemplateApplies,
  FormulaTemplateBody,
} from '../../shared/domain/formula/formulaTemplate';
import type { Category, Weapon } from '../../shared/types';
import { useBpmClient } from './BpmClientContext';
import { defaultBpmClient } from './IpcClient';

/** Y a-t-il un poste Electron à piloter ? (faux dans un navigateur, ou les tests sans pont) */
export const stationAvailable = (): boolean =>
  typeof window !== 'undefined' && !!window.electronAPI?.api;

/** Paramètres du poste modifiables par l'écran (les dossiers de l'agent ont leurs opérations) */
export type StationSettingsPatch = Partial<
  Omit<AppSettings, 'agentFolders' | 'matchDurations' | 'formulaTemplates'>
>;

type WeaponCode = 'E' | 'F' | 'S' | 'L' | 'C';

export function createStationApi(client: BpmClient) {
  const q = client.query.bind(client);
  const c = client.call.bind(client);
  return {
    /** Paramétrage du poste et salles (#1880) */
    settings: {
      get: () => q('getStationSettings', {}),
      update: (updates: StationSettingsPatch) => c('updateStationSettings', updates),
      /** Valeurs localStorage historiques ; 'missing' = reprise au démarrage, 'write' = miroir */
      importLegacy: (values: Record<string, string | null>, mode: 'missing' | 'write') =>
        c('importLegacySettings', { values, mode }),
      resolve: (
        key: Exclude<keyof AppSettings, 'matchDurations' | 'formulaTemplates'> | 'stripCount',
        scope?: { competitionId?: string; eventDayId?: string }
      ) => q('getResolvedSetting', { key, ...scope }),
      listVenues: () => q('listVenues', {}),
      upsertVenue: (input: VenueInput) => c('saveVenue', input),
      setDefaultVenue: (venueId: string) => c('setDefaultVenue', { venueId }),
      deleteVenue: (venueId: string) => c('deleteVenue', { venueId }),
      /** Lieux trouvés sur Internet depuis le poste (docs/adr/0026) */
      searchPlaces: (query: string, language: string) =>
        q('listPlaceSuggestions', { query, language }),
      getAgentFolders: () => q('listAgentFolders', {}),
      /** Dossier choisi par desktop.pickDirectory (docs/adr/0030) */
      addAgentFolder: (path: string) => c('addAgentFolder', { path }),
      removeAgentFolder: (folder: string) => c('removeAgentFolder', { folder }),
      /** Langue ou thème changés hors de l'écran (agent) : à relire. Renvoie la désinscription. */
      onChanged: (callback: () => void) =>
        client.subscribe('onStationSettingsChanged', {}, () => callback()),
    },
    /** Modèles de formule (docs/adr/0033) : fournis en lecture seule, personnels du poste */
    formulaTemplates: {
      list: (filter: {
        weapon?: Weapon;
        category?: Category;
        isTeamEvent?: boolean;
        text?: string;
      }) => q('listFormulaTemplates', filter),
      save: (input: {
        id?: string;
        name: string;
        applies?: FormulaTemplateApplies;
        origin?: { templateId: string; season?: string };
        body: FormulaTemplateBody;
      }) => c('saveFormulaTemplate', input),
      delete: (id: string) => c('deleteFormulaTemplate', { id }),
    },
    /** Bibliothèque de logos du poste ; le logo actif est `settings.get().logo` */
    logos: {
      list: () => q('getLogoLibrary', {}),
      save: (logos: LogoLibraryEntry[]) => c('updateLogoLibrary', { logos }),
    },
    /** Proxy réseau du poste (session Electron) ; adresse refusée : ApiError station_refused */
    proxy: {
      get: () => q('getProxySettings', {}),
      update: (settings: ProxySettingsDTO) => c('updateProxySettings', settings),
      test: () => c('testProxy', {}),
    },
    /** Bibliothèque de thèmes d'écrans */
    themes: {
      list: () => q('listScreenThemes', {}),
      save: (theme: CustomTheme) => c('saveScreenTheme', { theme }),
      delete: (themeId: string) => c('deleteScreenTheme', { themeId }),
    },
    /** Journée multi-épreuves (#1714, #1878) */
    eventDay: {
      list: () => q('listEventDays', {}),
      create: (data: { name: string; date: string; stripCount?: number }) =>
        c('createEventDay', data),
      update: (dayId: string, details: { name?: string; date?: string; stripCount?: number }) =>
        c('updateEventDayDetails', { dayId, details }),
      delete: (dayId: string) => c('deleteEventDay', { dayId }),
      setCompetitionDay: (competitionId: string, dayId: string | null) =>
        c('assignCompetitionToDay', { competitionId, dayId }),
      listReferees: (dayId: string) => q('listEventDayReferees', { dayId }),
      createReferee: (dayId: string, details: DayRefereeInput) =>
        c('registerEventDayReferee', { dayId, details }),
      updateReferee: (refereeId: string, details: DayRefereeInput) =>
        c('updateEventDayRefereeDetails', { refereeId, details }),
      deleteReferee: (refereeId: string) => c('removeEventDayReferee', { refereeId }),
      syncReferees: (dayId: string) => c('syncEventDayReferees', { dayId }),
      getOverview: (dayId: string) => q('getEventDayOverview', { dayId }),
      getBusyElsewhere: (competitionId: string) => q('listBusyElsewhere', { competitionId }),
      getStripOccupation: (dayId: string) => q('getDayStripOccupation', { dayId }),
      getStripBoard: (dayId: string) => q('getDayStripBoard', { dayId }),
      assignStrip: (dayId: string, strip: number, key: string) =>
        c('assignDayStrip', { dayId, strip, key }),
      setStripRule: (dayId: string, strip: number, rule: StripRule | null) =>
        c('setDayStripRule', { dayId, strip, rule }),
      setAutoAssign: (dayId: string, on: boolean) => c('setDayAutoAssign', { dayId, on }),
    },
    /** Dossiers de sauvegarde (#2134) ; chemin choisi par desktop.pickDirectory (docs/adr/0030) */
    backup: {
      getDir: () => q('getBackupDir', {}),
      setDir: (path: string) => c('setBackupDir', { path }),
      resetDir: () => c('resetBackupDir', {}),
      /** Dossier propre d'une épreuve sur ce poste ({ dir } ; null : dossier du poste) */
      getCompetitionDir: (competitionId: string) => q('getCompetitionBackupDir', { competitionId }),
      setCompetitionDir: (competitionId: string, path: string) =>
        c('setCompetitionBackupDir', { competitionId, path }),
      resetCompetitionDir: (competitionId: string) =>
        c('resetCompetitionBackupDir', { competitionId }),
    },
    /** Durées de match de référence (#1965) */
    durations: {
      get: () => q('getMatchDurations', {}),
      setChangeover: (changeoverMs: number) => c('updateMatchDurationSettings', { changeoverMs }),
      setOverride: (key: DurationKey, medianMs: number | null) =>
        c('updateMatchDurationSettings', {
          override: { key: { ...key, weapon: weaponCode(key.weapon) as WeaponCode }, medianMs },
        }),
      resetHistory: () => c('resetMatchDurationHistory', {}),
      /** Durées d'une épreuve versées à l'historique (fait aussi à la fin du tableau) */
      recordHistory: (competitionId: string) => c('recordMatchDurationHistory', { competitionId }),
    },
    /** RGPD (#1882) : droits des personnes, conservation, noms sur le réseau */
    privacy: {
      getSettings: () => q('getPrivacySettings', {}),
      setSettings: (patch: Partial<PrivacySettings>) => c('updatePrivacySettings', patch),
      findPersons: (query: string) => q('listPrivacyPersons', { query }),
      getPersonData: (ref: PrivacyPersonRef) => q('getPersonData', ref),
      anonymizePerson: (ref: PrivacyPersonRef) => c('anonymizePerson', ref),
      erasePerson: (ref: PrivacyPersonRef) => c('erasePerson', ref),
      retentionCandidates: () => q('listRetentionCandidates', {}),
      applyRetention: (selection: { competitionIds?: string[]; memberIds?: string[] }) =>
        c('applyRetention', selection),
    },
    /** Serveur MCP intégré (agent IA) */
    mcp: {
      getStatus: () => q('getMcpStatus', {}),
      setSettings: (settings: { enabled?: boolean; port?: number; allowWrite?: boolean }) =>
        c('updateMcpSettings', settings),
      regenerateToken: () => c('regenerateMcpToken', {}),
      getLog: () => q('listMcpLog', {}),
    },
  };
}

export type StationApi = ReturnType<typeof createStationApi>;

/** API du poste de l'écran, sur le client du contrat (stable tant que le client l'est) */
export function useStationApi(): StationApi {
  const client = useBpmClient();
  return useMemo(() => createStationApi(client), [client]);
}

/** API du poste hors React (services de l'écran) : client par défaut */
export const stationApi: StationApi = createStationApi(defaultBpmClient);
