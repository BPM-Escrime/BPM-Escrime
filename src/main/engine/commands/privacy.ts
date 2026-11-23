/**
 * BPM - Escrime - RGPD (#1882) : opérations du contrat (docs/adr/0022), reprise de l'ancien
 * ipc/privacyHandlers.ts. Droits des personnes (accès, portabilité, anonymisation, effacement),
 * durée de conservation, affichage des noms sur le réseau. Les archives .bpm chiffrées et
 * l'export JSON d'une personne (dialogue natif, chemin de fichier) restent des canaux IPC.
 * Licensed under GPL-3.0
 */
import type { DatabaseManager } from '../../../database';
import { retentionCutoff } from '../../privacySettings';
import type {
  PrivacyPersonRef,
  PrivacySettings,
  RetentionPurgeResult,
} from '../../../shared/types/privacy';
import { CommandError, type CommandContext } from './context';
import { portOf, refuse, type StationHandler } from './stationSupport';

/**
 * Applique l'action de conservation (anonymisation ou suppression) aux compétitions
 * et membres échus ; `selection` restreint aux identifiants choisis.
 */
export function applyRetention(
  db: DatabaseManager,
  settings: PrivacySettings,
  selection?: { competitionIds?: string[]; memberIds?: string[] },
  now: Date = new Date(),
  isCompetitionBusy: (competitionId: string) => boolean = () => false
): RetentionPurgeResult {
  const candidates = db.privacy.listRetentionCandidates(
    retentionCutoff(settings.competitionRetentionMonths, now),
    retentionCutoff(settings.memberRetentionMonths, now)
  );
  const pick = <T extends { id: string }>(items: T[], ids?: string[]) =>
    Array.isArray(ids) ? items.filter(i => ids.includes(i.id)) : items;
  // Compétition ouverte : son état en mémoire réécrirait les données (#1882)
  const competitions = pick(candidates.competitions, selection?.competitionIds).filter(
    c => !isCompetitionBusy(c.id)
  );
  const members = pick(candidates.members, selection?.memberIds);
  for (const c of competitions) {
    if (settings.retentionAction === 'delete') db.privacy.purgeCompetition(c.id, false);
    else db.privacy.anonymizeCompetition(c.id);
  }
  const memberIds = members.map(m => m.id);
  if (memberIds.length) {
    if (settings.retentionAction === 'delete') db.privacy.eraseMembersById(memberIds);
    else db.privacy.anonymizeMembersById(memberIds);
  }
  if (competitions.length || memberIds.length) db.compactAfterErasure?.();
  return { competitions: competitions.length, members: members.length };
}

const refOf = (input: { fencerIds?: string[]; memberIds?: string[] }): PrivacyPersonRef => ({
  fencerIds: input.fencerIds ?? [],
  memberIds: input.memberIds ?? [],
});

/** Refuse si une épreuve de la personne est ouverte ou servie aux tablettes (#1882) */
function assertNotBusy(ctx: CommandContext, ref: PrivacyPersonRef): void {
  const busy = ctx.station?.privacy.isCompetitionBusy;
  if (busy && ctx.db.privacy.competitionIdsOf(ref).some(id => busy(id))) {
    throw new CommandError(
      'competition_open',
      'Une épreuve de cette personne est ouverte : la fermer avant de continuer'
    );
  }
}

type PrivacyOps =
  | 'listPrivacyPersons'
  | 'getPersonData'
  | 'anonymizePerson'
  | 'erasePerson'
  | 'getPrivacySettings'
  | 'updatePrivacySettings'
  | 'listRetentionCandidates'
  | 'applyRetention';

export const privacyHandlers: { [N in PrivacyOps]: StationHandler<N> } = {
  listPrivacyPersons: (ctx, { query }) =>
    refuse(() => ctx.db.privacy.findPersons(query.slice(0, 100))),
  getPersonData: (ctx, input) => refuse(() => ctx.db.privacy.exportPerson(refOf(input))),
  anonymizePerson: (ctx, input) =>
    refuse(() => {
      const ref = refOf(input);
      assertNotBusy(ctx, ref);
      const r = ctx.db.privacy.anonymizePerson(ref);
      ctx.db.compactAfterErasure?.();
      return r;
    }),
  erasePerson: (ctx, input) =>
    refuse(() => {
      const ref = refOf(input);
      assertNotBusy(ctx, ref);
      const r = ctx.db.privacy.erasePerson(ref);
      ctx.db.compactAfterErasure?.();
      return r;
    }),
  getPrivacySettings: ctx => portOf(ctx).privacy.settings(),
  updatePrivacySettings: (ctx, input) => portOf(ctx).privacy.update(input),
  listRetentionCandidates: ctx =>
    refuse(() => {
      const s = portOf(ctx).privacy.settings();
      return ctx.db.privacy.listRetentionCandidates(
        retentionCutoff(s.competitionRetentionMonths),
        retentionCutoff(s.memberRetentionMonths)
      );
    }),
  applyRetention: (ctx, { competitionIds, memberIds }) => {
    const port = portOf(ctx);
    return refuse(() =>
      applyRetention(
        ctx.db,
        port.privacy.settings(),
        { competitionIds: competitionIds ?? [], memberIds: memberIds ?? [] },
        new Date(),
        port.privacy.isCompetitionBusy
      )
    );
  },
};
