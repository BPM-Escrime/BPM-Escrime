/**
 * BPM - Escrime - Durées de match du poste (#1965, lot 3)
 * Réglages du DT et historique (agrégats par épreuve, sans donnée personnelle) dans
 * app_settings (clé matchDurations). Règles : shared/domain/durations. Pas de journal : ce ne
 * sont pas des faits de l'épreuve.
 * Licensed under GPL-3.0
 */
import {
  competitionDurationRecords,
  durationTable,
  withCompetitionHistory,
  withDurationOverride,
  type MatchDurationConfig,
} from '../../../shared/domain/durations/matchDurations';
import { logger, LogCategory, toError } from '../../../shared/services/logger';
import type { CommandContext } from './context';
import { getCompetitionOrThrow } from './competitions';
import { refuse, type StationHandler } from './stationSupport';

const configOf = (ctx: CommandContext): MatchDurationConfig =>
  ctx.db.settings.getSetting('matchDurations');

function save(ctx: CommandContext, config: MatchDurationConfig) {
  ctx.db.settings.updateSettings({ matchDurations: config });
  ctx.emitChange?.({ scope: 'settings', competitionIds: [] });
}

const view = (config: MatchDurationConfig) => ({
  changeoverMs: config.changeoverMs,
  competitions: Object.keys(config.history).length,
  rows: durationTable(config),
});

/** Durées mesurées d'une épreuve versées à l'historique du poste (apport précédent remplacé) */
export function recordMatchDurationHistory(ctx: CommandContext, competitionId: string) {
  const comp = getCompetitionOrThrow(ctx, competitionId);
  const records = competitionDurationRecords(comp, ctx.db.getMatchTimings(competitionId));
  save(ctx, withCompetitionHistory(configOf(ctx), competitionId, records));
  return { samples: records.reduce((n, r) => n + (r.samples ?? 0), 0), keys: records.length };
}

/** Fin du tableau : historique mis à jour, sans jamais faire échouer le score */
export function recordMatchDurationHistorySafely(ctx: CommandContext, competitionId: string) {
  try {
    recordMatchDurationHistory(ctx, competitionId);
  } catch (e) {
    logger.warn(LogCategory.SYSTEM, 'Historique des durées de match non enregistré', toError(e));
  }
}

type DurationOps =
  | 'getMatchDurations'
  | 'updateMatchDurationSettings'
  | 'recordMatchDurationHistory'
  | 'resetMatchDurationHistory';

export const matchDurationHandlers: { [N in DurationOps]: StationHandler<N> } = {
  getMatchDurations: ctx => refuse(() => view(configOf(ctx))),
  updateMatchDurationSettings: (ctx, { changeoverMs, override }) =>
    refuse(() => {
      let config = configOf(ctx);
      if (changeoverMs !== undefined) config = { ...config, changeoverMs };
      if (override) config = withDurationOverride(config, override.key, override.medianMs);
      save(ctx, config);
      return view(config);
    }),
  recordMatchDurationHistory: (ctx, { competitionId }) =>
    recordMatchDurationHistory(ctx, competitionId),
  resetMatchDurationHistory: ctx =>
    refuse(() => {
      const config = { ...configOf(ctx), history: {} };
      save(ctx, config);
      return view(config);
    }),
};
