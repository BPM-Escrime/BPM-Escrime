/**
 * BPM - Escrime - Lecture des fichiers de l'extranet dans « Nouvelle compétition » (#1938)
 * Licensed under GPL-3.0
 *
 * Choix (usePlatform) ou dépôt du .zip de l'extranet, d'un .xml, d'un .fff ou d'un .txt
 * d'arbitres ; le moteur décode (requête listFederalFiles, #2134), l'analyse (fusion, écarts)
 * est partagée.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  buildFederalImport,
  resolveFederalFencers,
  resolveFederalTeams,
  type FederalImport,
  type FederalNotice,
  type FencerSource,
} from '../../shared/utils/fileParser/federalImport';
import type { FederalTextFile } from '../../shared/types/preload';
import type { Fencer } from '../../shared/types';
import type { ImportedReferee, ImportedTeam } from '../../shared/utils/fileParser/common';
import { logger, LogCategory } from '../../shared/services/logger';
import { bytesToBase64 } from '../../shared/platform/binary';
import type { OpenedBinaryFile } from '../../shared/platform/PlatformServices';
import { useFilesApi } from '../api/filesApi';
import { usePlatform } from '../platform/PlatformContext';

/** Fichiers lus en une fois (FEDERAL_MAX_INPUTS du moteur) */
const MAX_FEDERAL_FILES = 5;
const FEDERAL_FILTERS = [
  {
    name: 'FFE / FIE (.zip, .xml, .fff, .txt)',
    extensions: ['zip', 'xml', 'cotcot', 'fff', 'txt', 'csv'],
  },
  { name: '*', extensions: ['*'] },
];

/** Données à créer avec la compétition */
export interface FederalCreationPayload {
  fencers: Partial<Fencer>[];
  teams: ImportedTeam[];
  referees: ImportedReferee[];
}

/** Titre évoquant une épreuve mixte (« Homme Dame », « Mixte ») alors que le sexe ne l'est pas */
function mixedTitleNotice(imp: FederalImport): FederalNotice | null {
  const h = imp.header;
  if (!h?.fields.title || !h.federal.gender || h.federal.gender.toUpperCase() === 'X') return null;
  const title = h.fields.title.toLowerCase();
  const mixed =
    /\bmixte\b/.test(title) ||
    (/\bhommes?\b/.test(title) && /\bdames?\b/.test(title)) ||
    (/\bmasculin/.test(title) && /\bf[ée]minin/.test(title));
  return mixed ? { code: 'mixedTitle', value: h.federal.gender } : null;
}

export function useFederalImport() {
  const files = useFilesApi();
  const platform = usePlatform();
  const [result, setResult] = useState<FederalImport | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<FencerSource>('xml');

  const load = useCallback((files: FederalTextFile[], fileNames: string[]) => {
    const imp = buildFederalImport(files);
    const extra = mixedTitleNotice(imp);
    setResult(extra ? { ...imp, notices: [...imp.notices, extra] } : imp);
    setNames(fileNames);
    setSource('xml');
    setError(null);
  }, []);

  const run = useCallback(async (task: () => Promise<void>) => {
    setLoading(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      logger.error(LogCategory.UI, 'Federal import failed', err as Error);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  /** Fichiers choisis ou déposés → décodés par le moteur → analysés */
  const decode = useCallback(
    async (chosen: OpenedBinaryFile[]) => {
      const inputs = chosen.slice(0, MAX_FEDERAL_FILES);
      const decoded = await files.federalFiles(
        inputs.map(f => ({ name: f.name, content: bytesToBase64(f.bytes) }))
      );
      load(
        decoded,
        inputs.map(f => f.name)
      );
    },
    [files, load]
  );

  const pick = useCallback(
    () =>
      run(async () => {
        const picked = await platform.openBinaryFiles({ filters: FEDERAL_FILTERS });
        if (picked) await decode(picked);
      }),
    [platform, decode, run]
  );

  const drop = useCallback(
    (dropped: File[]) =>
      run(async () => {
        if (dropped.length === 0) return;
        await decode(
          await Promise.all(
            dropped.map(async f => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))
          )
        );
      }),
    [decode, run]
  );

  const clear = useCallback(() => {
    setResult(null);
    setNames([]);
    setError(null);
  }, []);

  const payload = useMemo<FederalCreationPayload | null>(() => {
    if (!result) return null;
    const fencers = resolveFederalFencers(result, source);
    return {
      fencers,
      teams: result.header?.fields.isTeamEvent ? resolveFederalTeams(result.teams, fencers) : [],
      referees: result.referees,
    };
  }, [result, source]);

  return { result, names, loading, error, source, setSource, pick, drop, clear, payload };
}
