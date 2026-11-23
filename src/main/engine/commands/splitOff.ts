/**
 * BPM - Escrime - Extraction d'un groupe des tableaux séparés en épreuve séparée
 * (docs/adr/0024, lot A3). splitOffGroup remplace les écritures de l'écran
 * (createCompetition, addFencer, saveSessionState, updateCompetition, sans transaction).
 *
 * Transaction : runCommand (docs/adr/0006) ouvre UNE transaction SQLite sur la base, qui couvre
 * les deux épreuves ; la révision contrôlée et l'idempotence (commandId) sont celles de
 * l'épreuve d'origine. Un refus ou une erreur au milieu annule tout : ni épreuve séparée, ni
 * tireurs copiés, ni épreuve d'origine marquée, ni événement.
 * Journal : GroupSplitOff (épreuve d'origine), SplitRankingImported (premier fait de l'épreuve
 * séparée), même commandId (docs/adr/0007).
 * Licensed under GPL-3.0
 */
import type { Competition, CompetitionSettings, Fencer, PoolRanking } from '../../../shared/types';
import {
  buildSplitCompetitionData,
  extractSplitGroupRanking,
  remapRankingFencers,
  splitOffRefusal,
  splitOffSessionState,
  toSplitFencerData,
} from '../../../shared/domain/ranking/splitGroups';
import { CommandError, type CommandContext } from './context';
import { getCompetitionOrThrow } from './competitions';
import { EVENT, recordEvents } from './eventLog';
import { readSession } from './sessionView';
import { slotOfGroup } from './groupTableaux';
import { assertScoreSupported, writeSession } from './sport';

export function splitOffGroup(
  ctx: CommandContext,
  input: { competitionId: string; group: string; title: string; dryRun?: boolean },
  /** Heure injectée (date de repli de l'épreuve séparée, docs/adr/0002) */
  now: Date = new Date()
) {
  const source = getCompetitionOrThrow(ctx, input.competitionId);
  assertScoreSupported(source);
  const session = readSession(ctx, source.id);
  const overall = Array.isArray(session.overallRanking)
    ? (session.overallRanking as PoolRanking[])
    : [];
  const group = input.group.trim();
  const refusal = splitOffRefusal(
    source,
    overall,
    group,
    slotOfGroup(source, session, group).matches.length
  );
  if (refusal) throw new CommandError(refusal.code, refusal.message);

  const ranking = extractSplitGroupRanking(overall, group);
  if (input.dryRun) return { dryRun: true, competitionId: null, fencers: ranking.length };

  // Épreuve séparée, tireurs copiés, projection de départ (transaction de runCommand)
  const created = ctx.db.createCompetition(
    buildSplitCompetitionData(source, input.title, group, now) as Competition
  );
  const copies = new Map<string, Fencer>();
  for (const r of ranking) {
    copies.set(r.fencer.id, ctx.db.addFencer(created.id, toSplitFencerData(r)));
  }
  const imported = remapRankingFencers(ranking, copies);
  writeSession(ctx, created.id, splitOffSessionState(imported));
  recordEvents(ctx, created.id, [
    {
      type: EVENT.splitRankingImported,
      payload: {
        sourceCompetitionId: source.id,
        group,
        ranking: ranking.map(r => ({
          fencerId: copies.get(r.fencer.id)!.id,
          sourceFencerId: r.fencer.id,
          rank: r.rank,
        })),
      },
    },
  ]);

  // Épreuve d'origine : groupe extrait (plus d'onglet ni de tableau pour lui)
  const splitOffCompetitionIds = {
    ...source.settings?.splitOffCompetitionIds,
    [group]: created.id,
  };
  ctx.db.updateCompetition(source.id, {
    settings: { ...source.settings, splitOffCompetitionIds } as CompetitionSettings,
  });
  recordEvents(ctx, source.id, [
    {
      type: EVENT.groupSplitOff,
      payload: {
        group,
        targetCompetitionId: created.id,
        fencerIds: ranking.map(r => r.fencer.id),
      },
    },
  ]);

  ctx.emitChange?.({ scope: 'competitions', competitionIds: [source.id, created.id] });
  ctx.emitChange?.({ scope: 'fencers', competitionIds: [created.id] });
  ctx.emitChange?.({ scope: 'session', competitionIds: [created.id] });
  ctx.remote?.settingsChanged(source.id, { splitOffCompetitionIds });
  return { dryRun: false, competitionId: created.id, fencers: ranking.length };
}
