/**
 * Mode Club (#1981 lot 2, docs/adr/0022) : chaque appel de l'écran donne une entrée que le
 * schéma zod de l'opération du contrat accepte (nom d'opération connu, entrée nommée valide).
 */
import { describe, expect, it } from 'vitest';
import { contract, type OperationName } from '../../shared/api/contract';
import type { ApiBridge } from '../../shared/api/client';
import { IpcClient } from './IpcClient';
import { createClubApi } from './clubApi';

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
const api = createClubApi(new IpcClient(() => bridge));

const member = {
  firstName: 'Ada',
  lastName: 'LOVELACE',
  license: '123',
  gender: 'F',
  birthDate: '2010-05-12',
  weapons: ['E' as never],
  laterality: 'L' as const,
  notes: 'Gauchère',
  active: true,
  photo: null,
};
const session = {
  date: '2026-11-16',
  label: 'Cours',
  startTime: '20:30',
  coachIds: ['k1'],
  weapon: 'A' as never,
  stripCount: 3,
  plan: [{ id: 'p1', title: 'Footing', minutes: 10, category: 'warmup' as const, images: [] }],
  feedback: { rating: 4, wentWell: 'Bien' },
  planned: true,
  ageFrom: null,
};
const item = {
  name: 'Masque',
  category: 'custom:abc' as never,
  weapon: 'F' as never,
  quantity: 2,
  purchasePrice: 89.9,
  condition: 'good' as const,
};

/** Un appel par méthode de l'écran, avec des arguments réalistes */
const CALLS: Array<[string, () => Promise<unknown>]> = [
  ['listClubs', () => api.listClubs()],
  ['getClub', () => api.getClub('c1')],
  ['createClub', () => api.createClub({ name: 'Cercle', stripCount: 2 })],
  [
    'updateClub',
    () => api.updateClub('c1', { name: 'N', logo: null, weapon: null, weapons: ['E'] }),
  ],
  ['deleteClub', () => api.deleteClub('c1')],
  ['findMemberByCardCode', () => api.findMemberByCardCode('A1B2C3D4E5', 'c1')],
  ['regenerateCardCode', () => api.regenerateCardCode('m1')],
  ['listMembers', () => api.listMembers('c1', true)],
  ['createMember', () => api.createMember('c1', member)],
  ['updateMember', () => api.updateMember('m1', { birthDate: '', active: false, photo: null })],
  ['deleteMember', () => api.deleteMember('m1')],
  ['importMembers', () => api.importMembers('c1', [member])],
  ['listCoaches', () => api.listCoaches('c1', true)],
  [
    'createCoach',
    () => api.createCoach('c1', { firstName: 'J', lastName: 'M', weapons: ['A' as never] }),
  ],
  ['updateCoach', () => api.updateCoach('k1', { active: false })],
  ['deleteCoach', () => api.deleteCoach('k1')],
  ['listSessions', () => api.listSessions('c1', { from: '2026-11-01' })],
  ['getSession', () => api.getSession('s1')],
  ['createSession', () => api.createSession('c1', session)],
  ['createSeries', () => api.createSeries('c1', session, { everyDays: 7, count: 4 })],
  [
    'generateSessions',
    () =>
      api.generateSessions('c1', session, {
        weekdays: [1, 3],
        periods: [{ from: '2026-11-16', until: '2026-12-31' }],
      }),
  ],
  [
    'deletePlannedInPeriods',
    () => api.deletePlannedInPeriods('c1', [{ from: '2026-12-21', until: '2027-01-03' }]),
  ],
  [
    'updateSession',
    () => api.updateSession('s1', { feedback: null, startTime: null, notes: 'RAS' }),
  ],
  ['startSession', () => api.startSession('s1')],
  ['closeSession', () => api.closeSession('s1')],
  ['reopenSession', () => api.reopenSession('s1')],
  ['deleteSession', () => api.deleteSession('s1')],
  ['setAttendance', () => api.setAttendance('s1', 'm1', true)],
  ['setMemberFeedback', () => api.setMemberFeedback('s1', 'm1', 'Bien')],
  ['getMemberFeedback', () => api.getMemberFeedback('m1')],
  ['listExercises', () => api.listExercises()],
  [
    'createExercise',
    () => api.createExercise({ title: 'Fente', category: 'technique', images: [] }),
  ],
  ['updateExercise', () => api.updateExercise('e1', { minutes: 15, weapons: ['E'] })],
  ['deleteExercise', () => api.deleteExercise('e1')],
  ['importExercises', () => api.importExercises([{ title: 'Fente' }])],
  ['listBouts', () => api.listBouts({ sessionId: 's1', includeUnfinished: true })],
  [
    'createBout',
    () => api.createBout({ sessionId: 's1', memberAId: 'a', memberBId: 'b', strip: 1 }),
  ],
  ['startBout', () => api.startBout('b1')],
  ['updateBoutScore', () => api.updateBoutScore('b1', 3, 2)],
  ['finishBout', () => api.finishBout('b1', { scoreA: 5, scoreB: 2, entryMode: 'master' })],
  ['cancelBout', () => api.cancelBout('b1')],
  ['deleteBout', () => api.deleteBout('b1')],
  [
    'getLeaderboard',
    () => api.getLeaderboard({ clubId: 'c1', from: '2026-09-01', to: '2027-08-31' }),
  ],
  ['getMemberReport', () => api.getMemberReport('m1', { clubId: 'c1' }, 'quarter')],
  ['listItems', () => api.listItems('c1', true)],
  ['createItem', () => api.createItem('c1', item)],
  ['createItemSeries', () => api.createItemSeries('c1', item, 15)],
  ['updateItem', () => api.updateItem('i1', { retired: true })],
  ['deleteItem', () => api.deleteItem('i1')],
  ['listLoans', () => api.listLoans('c1', { open: true })],
  [
    'lendItem',
    () => api.lendItem({ itemId: 'i1', memberId: 'm1', quantity: 1, dueDate: '2026-12-01' }),
  ],
  ['returnLoan', () => api.returnLoan('l1', { conditionIn: 'worn', notes: 'Usé' })],
  ['deleteLoan', () => api.deleteLoan('l1')],
  ['listCategories', () => api.listCategories('c1')],
  ['createCategory', () => api.createCategory('c1', 'Chaussures')],
  ['renameCategory', () => api.renameCategory('k1', 'Souliers')],
  ['deleteCategory', () => api.deleteCategory('k1')],
  ['listBrands', () => api.listBrands('c1')],
  ['createBrand', () => api.createBrand('c1', 'Allstar')],
  ['renameBrand', () => api.renameBrand('br1', 'Leon Paul')],
  ['deleteBrand', () => api.deleteBrand('br1')],
  ['getInventoryLock', () => api.getInventoryLock('c1')],
  ['setInventoryLock', () => api.setInventoryLock('c1', true)],
  ['importItems', () => api.importItems('c1', [item])],
  ['remoteStatus', () => api.remoteStatus()],
  ['pushBout', () => api.pushBout('b1')],
  ['linkRemote', () => api.linkRemote(null)],
  ['releaseBout', () => api.releaseBout('b1')],
  ['syncStatus', () => api.syncStatus('c1')],
  ['syncEnable', () => api.syncEnable('c1')],
  ['syncDisable', () => api.syncDisable('c1')],
  ['syncNow', () => api.syncNow('c1')],
  ['syncResolve', () => api.syncResolve('c1', 'file')],
  ['backupList', () => api.backupList('c1')],
  ['backupCreate', () => api.backupCreate('c1')],
  ['backupRestore', () => api.backupRestore('c1', 'club-2026.bpclub')],
];

describe('createClubApi : entrées du contrat', () => {
  it.each(CALLS)('%s', async (_method, call) => {
    seen.length = 0;
    await expect(call()).resolves.toBeNull();
    expect(seen).toHaveLength(1);
    expect(contract).toHaveProperty(seen[0].name);
  });

  it('couvre toutes les méthodes de l’écran', () => {
    expect(CALLS.map(([m]) => m).sort()).toEqual(
      Object.keys(api)
        .filter(m => m !== 'onSynced')
        .sort()
    );
  });

  it('toutes les opérations club:* du contrat sont appelées par l’écran', async () => {
    const used = new Set<string>();
    for (const [, call] of CALLS) {
      seen.length = 0;
      await call();
      used.add(seen[0].name);
    }
    api.onSynced(() => undefined);
    used.add('onClubSynced');
    const declared = (Object.keys(contract) as OperationName[]).filter(n =>
      contract[n].permission.startsWith('club:')
    );
    expect(declared.filter(n => !used.has(n))).toEqual([]);
  });

  it('un nombre de séries hors bornes est refusé par le contrat', async () => {
    await expect(api.createItemSeries('c1', item, 0)).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });
});
