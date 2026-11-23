/**
 * BPM - Escrime - Épreuve par équipes à l'écran par le contrat (docs/adr/0024, lot E3)
 * Lecture : bloc « teams » de getCompetitionState (équipes, rencontres, relais, classement de
 * poule), relu après chaque commande et sur les signaux de l'épreuve (onCompetitionEvents :
 * tablettes, appareils, MCP). Écriture : commandes du contrat seulement (inscription,
 * composition, tirages, relais, remplacement). Le moteur fait foi : aucun total ni avancement
 * du tableau calculé ici. Refus : code du catalogue traduit (errors.<code>), sinon message du
 * moteur.
 * Licensed under GPL-3.0
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useBpmClient } from '../api/BpmClientContext';
import { useToast } from '../components/Toast';
import { useTranslation } from './useTranslation';
import type { CommandName, Input, Output } from '../../shared/api/contract';
import type { TeamsStateDTO } from '../../shared/api/contractTeams';
import type { TeamMatchRow, TeamRow } from '../../shared/domain/teams/team.types';

type MatchDTO = TeamsStateDTO['poolMatches'][number];
export type TeamPoolRankingDTO = TeamsStateDTO['poolRanking'][number];

/** Rencontre du moteur au format des vues (TeamPoolView, exports PDF) */
const toRow = (m: MatchDTO): TeamMatchRow => ({
  ...m,
  poolNumber: m.poolNumber ?? undefined,
  position: m.position ?? undefined,
  bouts: m.bouts.map(b => ({ ...b })),
});

export interface TeamCompetitionData {
  teams: TeamRow[];
  poolMatches: TeamMatchRow[];
  tableauMatches: TeamMatchRow[];
  poolRanking: TeamPoolRankingDTO[];
}

const EMPTY: TeamCompetitionData = {
  teams: [],
  poolMatches: [],
  tableauMatches: [],
  poolRanking: [],
};

/** Signal de l'épreuve qui peut changer le bloc « teams » */
const RELOAD_ON = new Set(['session:changed', 'journal:appended']);

export function useTeamCompetition(competitionId: string) {
  const client = useBpmClient();
  const { showToast } = useToast();
  const { t } = useTranslation();
  const [data, setData] = useState<TeamCompetitionData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const retried = useRef(false);
  const reloadRef = useRef<() => Promise<void>>(async () => {});

  const reload = useCallback(async () => {
    try {
      const { state } = await client.query('getCompetitionState', { competitionId });
      if (!alive.current) return;
      const block = state?.teams;
      setData(
        block
          ? {
              teams: block.teams.map(team => ({
                ...team,
                fencers: team.fencers.map(f => ({ ...f })),
              })),
              poolMatches: block.poolMatches.map(toRow),
              tableauMatches: block.tableauMatches.map(toRow),
              poolRanking: block.poolRanking,
            }
          : EMPTY
      );
      // Épreuve jamais ouverte : pas d'état tant que l'écran n'a pas écrit son bloc (500 ms) ;
      // une relecture suffit (docs/adr/0024, persistLocally jusqu'au lot N)
      if (!state && !retried.current) {
        retried.current = true;
        setTimeout(() => void reloadRef.current(), 700);
      }
    } catch (e) {
      if (alive.current) showToast((e as Error).message, 'error');
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [client, competitionId, showToast]);

  useEffect(() => {
    reloadRef.current = reload;
    alive.current = true;
    void reload();
    return () => {
      alive.current = false;
    };
  }, [reload]);

  // Écritures des autres chemins (tablettes, appareils, MCP) : relecture
  useEffect(() => {
    try {
      return client.subscribe('onCompetitionEvents', { competitionId }, event => {
        if (event.competitionId && event.competitionId !== competitionId) return;
        if (RELOAD_ON.has(event.type)) void reloadRef.current();
      });
    } catch {
      return undefined;
    }
  }, [client, competitionId]);

  /** Message d'un refus : errors.<code> traduit, sinon le message du moteur */
  const errorText = useCallback(
    (e: unknown): string => {
      const code = (e as { code?: string }).code;
      if (code) {
        const key = `errors.${code}`;
        const text = t(key);
        if (text !== key) return text;
      }
      return (e as Error).message ?? String(e);
    },
    [t]
  );

  /**
   * Commande du contrat, puis relecture du bloc. Refus affiché ; rend null.
   * `quiet` : codes que l'appelant traite lui-même (rendus en erreur, sans message).
   */
  const run = useCallback(
    async <K extends CommandName>(
      name: K,
      input: Input<K>,
      quiet: readonly string[] = []
    ): Promise<Output<K> | null> => {
      try {
        const out = await client.call(name, input);
        await reload();
        return out;
      } catch (e) {
        const code = (e as { code?: string }).code ?? '';
        if (quiet.includes(code)) throw e;
        showToast(errorText(e), 'error');
        await reload();
        return null;
      }
    },
    [client, reload, showToast, errorText]
  );

  return { ...data, loading, reload, run, errorText };
}
