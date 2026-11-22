/**
 * Mode Club par le contrat (#1981 lot 2, docs/adr/0022) : opérations sur une base SQLite réelle,
 * même chemin que l'écran (invoke), refus des dépôts rendus en « club_refused ».
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '../../../database';
import { hasNodeSqlite } from '../../../database/testing/nodeSqliteDatabase';
import { contract, type OperationName } from '../../../shared/api/contract';
import { ApiError } from '../../../shared/api/client';
import type { ClubBackupEntry, ClubSyncStatus } from '../../../shared/types/club';
import type { ClubPort, CommandContext } from './context';
import { invoke, subscribe } from '../api/engine';
import { publishClubSynced } from '../api/events';

vi.mock('better-sqlite3-multiple-ciphers', async () => ({
  default: (await import('../../../database/testing/nodeSqliteDatabase')).NodeSqliteDatabase,
}));

const d = hasNodeSqlite ? describe : describe.skip;

let db: DatabaseManager;
let ctx: CommandContext;

beforeEach(async () => {
  db = new DatabaseManager(':memory:');
  await db.open(':memory:');
  ctx = { db };
});
afterEach(() => db.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const op = (name: OperationName, input: Record<string, unknown> = {}) =>
  invoke(ctx, name, input) as Promise<any>;

async function club() {
  return op('createClub', { name: 'Cercle d’escrime', stripCount: 2 });
}
async function member(clubId: string, lastName: string, extra: Record<string, unknown> = {}) {
  return op('registerClubMember', {
    clubId,
    details: { firstName: 'Ada', lastName, ...extra },
  });
}

d('Mode Club : clubs et membres', () => {
  it('crée, relit, modifie et supprime un club', async () => {
    const c = await club();
    expect((await op('listClubs')).map((x: { id: string }) => x.id)).toEqual([c.id]);
    expect((await op('getClub', { clubId: c.id })).name).toBe('Cercle d’escrime');
    const updated = await op('updateClubDetails', {
      clubId: c.id,
      details: { name: 'Salle Nord' },
    });
    expect(updated.name).toBe('Salle Nord');
    await op('deleteClub', { clubId: c.id });
    expect(await op('getClub', { clubId: c.id })).toBeNull();
  });

  it('inscrit, modifie, archive et efface un membre', async () => {
    const c = await club();
    const m = await member(c.id, 'LOVELACE', { license: '123', weapons: ['E'] });
    expect(m).toMatchObject({ lastName: 'LOVELACE', weapons: ['E'], active: true });

    const renamed = await op('updateClubMemberDetails', {
      memberId: m.id,
      details: { lastName: 'BYRON', birthDate: '2010-05-12' },
    });
    expect(renamed).toMatchObject({ lastName: 'BYRON', birthYear: 2010 });

    await op('updateClubMemberDetails', { memberId: m.id, details: { active: false } });
    expect(await op('listClubMembers', { clubId: c.id })).toHaveLength(0);
    expect(await op('listClubMembers', { clubId: c.id, includeInactive: true })).toHaveLength(1);

    await op('removeClubMember', { memberId: m.id });
    expect(await op('listClubMembers', { clubId: c.id, includeInactive: true })).toHaveLength(0);
  });

  it('carte : retrouve le membre par son code, le code régénéré invalide l’ancien', async () => {
    const c = await club();
    const m = await member(c.id, 'TURING');
    expect((await op('getClubMemberByCard', { code: m.cardCode, clubId: c.id })).id).toBe(m.id);
    const next = await op('regenerateClubCardCode', { memberId: m.id });
    expect(next.cardCode).not.toBe(m.cardCode);
    expect(await op('getClubMemberByCard', { code: m.cardCode })).toBeNull();
    expect((await op('getClubMemberByCard', { code: next.cardCode })).id).toBe(m.id);
  });

  it('import en lot : créés puis doublons ignorés', async () => {
    const c = await club();
    const members = [
      { firstName: 'Ada', lastName: 'LOVELACE', license: '1' },
      { firstName: 'Alan', lastName: 'TURING', license: '2' },
    ];
    expect(await op('importClubMembers', { clubId: c.id, members })).toMatchObject({ created: 2 });
    expect(await op('importClubMembers', { clubId: c.id, members })).toMatchObject({ created: 0 });
  });

  it('entrée hors bornes : invalid_input ; refus du dépôt : club_refused avec son message', async () => {
    const c = await club();
    await expect(
      op('registerClubMember', { clubId: c.id, details: { firstName: 'X' } })
    ).rejects.toMatchObject({
      code: 'invalid_input',
    });
    const e = await op('registerClubMember', {
      clubId: c.id,
      details: { firstName: '', lastName: '' },
    }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ code: 'club_refused', message: 'Nom du membre requis' });
  });

  it('maîtres d’armes : ajout, archivage, suppression', async () => {
    const c = await club();
    const k = await op('registerClubCoach', {
      clubId: c.id,
      details: { firstName: 'Jean', lastName: 'MARTIN', weapons: ['A', 'F'] },
    });
    expect(k.weapons).toEqual(['A', 'F']);
    await op('updateClubCoachDetails', { coachId: k.id, details: { active: false } });
    expect(await op('listClubCoaches', { clubId: c.id })).toHaveLength(0);
    expect(await op('listClubCoaches', { clubId: c.id, includeInactive: true })).toHaveLength(1);
    await op('removeClubCoach', { coachId: k.id });
    expect(await op('listClubCoaches', { clubId: c.id, includeInactive: true })).toHaveLength(0);
  });
});

d('Mode Club : séances, présence et combats', () => {
  it('séance : préparée, ouverte, pointage, remarque, fermée', async () => {
    const c = await club();
    const m = await member(c.id, 'LOVELACE');
    const s = await op('planClubSession', {
      clubId: c.id,
      details: { date: '2026-11-16', label: 'Cours du lundi', planned: true },
    });
    expect(s.status).toBe('planned');
    const open = await op('startClubSession', { sessionId: s.id });
    expect(open.status).toBe('open');

    expect(
      await op('setClubAttendance', { sessionId: s.id, memberId: m.id, present: true })
    ).toEqual([m.id]);
    await op('setClubMemberFeedback', { sessionId: s.id, memberId: m.id, text: 'Bonne fente' });
    expect((await op('listClubMemberFeedback', { memberId: m.id }))[0]).toMatchObject({
      sessionId: s.id,
      text: 'Bonne fente',
    });

    const patched = await op('updateClubSessionDetails', {
      sessionId: s.id,
      details: { notes: 'RAS', feedback: { rating: 4 } },
    });
    expect(patched).toMatchObject({ notes: 'RAS', feedback: { rating: 4 } });

    const closed = await op('closeClubSession', { sessionId: s.id });
    expect(closed.status).toBe('closed');
    expect((await op('reopenClubSession', { sessionId: s.id })).status).toBe('open');
    expect(
      await op('listClubSessions', { clubId: c.id, from: '2026-11-01', to: '2026-11-30' })
    ).toHaveLength(1);
    await op('deleteClubSession', { sessionId: s.id });
    expect(await op('getClubSession', { sessionId: s.id })).toBeNull();
  });

  it('séries, jours d’ouverture et fermeture du club', async () => {
    const c = await club();
    const series = await op('planClubSessionSeries', {
      clubId: c.id,
      details: { date: '2026-11-16', planned: true },
      recurrence: { everyDays: 7, count: 3 },
    });
    expect(series).toHaveLength(3);
    const generated = await op('generateClubSessions', {
      clubId: c.id,
      details: { planned: true, date: '2026-12-01' },
      schedule: { weekdays: [3], periods: [{ from: '2026-12-01', until: '2026-12-31' }] },
    });
    expect(generated.created.length).toBeGreaterThan(0);
    const removed = await op('cancelPlannedClubSessions', {
      clubId: c.id,
      periods: [{ from: '2026-11-01', until: '2026-12-31' }],
    });
    expect(removed).toBe(3 + generated.created.length);
  });

  it('séance fermée : un combat y est refusé (club_refused)', async () => {
    const c = await club();
    const a = await member(c.id, 'A');
    const b = await member(c.id, 'B');
    const s = await op('planClubSession', { clubId: c.id, details: { date: '2026-11-16' } });
    await op('closeClubSession', { sessionId: s.id });
    await expect(
      op('createClubBout', { sessionId: s.id, memberAId: a.id, memberBId: b.id })
    ).rejects.toMatchObject({ code: 'club_refused', message: 'Séance fermée' });
  });

  it('combat : création, score, fin, classement et fiche du membre', async () => {
    const c = await club();
    const a = await member(c.id, 'LOVELACE');
    const b = await member(c.id, 'TURING');
    const s = await op('planClubSession', { clubId: c.id, details: { date: '2026-11-16' } });
    const bout = await op('createClubBout', {
      sessionId: s.id,
      memberAId: a.id,
      memberBId: b.id,
      strip: 1,
      maxScore: 5,
    });
    expect(bout.status).toBe('pending');
    expect((await op('startClubBout', { boutId: bout.id })).status).toBe('in_progress');
    expect(
      await op('recordClubBoutScore', { boutId: bout.id, scoreA: 3, scoreB: 2 })
    ).toMatchObject({
      scoreA: 3,
      scoreB: 2,
    });
    const done = await op('finishClubBout', { boutId: bout.id, result: { scoreA: 5, scoreB: 2 } });
    expect(done).toMatchObject({ status: 'finished', winnerId: a.id, scoreA: 5, scoreB: 2 });

    expect(await op('listClubBouts', { sessionId: s.id })).toHaveLength(1);
    const board = await op('getClubLeaderboard', { clubId: c.id, includeUnfinished: true });
    expect(board.map((x: { memberId: string }) => x.memberId)).toEqual([a.id, b.id]);
    expect(board[0]).toMatchObject({ victories: 1, touchesScored: 5, touchesReceived: 2 });

    const report = await op('getClubMemberReport', {
      memberId: a.id,
      clubId: c.id,
      groupBy: 'quarter',
    });
    expect(report.stats).toMatchObject({ bouts: 1, victories: 1 });
    expect(report.headToHead).toHaveLength(1);
    expect(report.progression.map((p: { period: { key: string } }) => p.period.key)).toEqual([
      '2026-T4',
    ]);
    // Sans période : progression par mois
    const monthly = await op('getClubMemberReport', { memberId: a.id });
    expect(monthly.progression[0].period.kind).toBe('month');

    await op('cancelClubBout', { boutId: bout.id });
    await op('deleteClubBout', { boutId: bout.id });
    expect(await op('listClubBouts', { sessionId: s.id, includeUnfinished: true })).toHaveLength(0);
  });

  it('exercices : création, import sans doublon, suppression', async () => {
    const e = await op('createClubExercise', {
      details: { title: 'Footing', category: 'warmup', minutes: 10 },
    });
    await op('updateClubExerciseDetails', { exerciseId: e.id, details: { minutes: 15 } });
    expect((await op('listClubExercises'))[0]).toMatchObject({ title: 'Footing', minutes: 15 });
    const r = await op('importClubExercises', {
      exercises: [
        { title: 'Footing', category: 'warmup' },
        { title: 'Fente', category: 'technique' },
      ],
    });
    expect(r).toEqual({ created: 1, skipped: 1 });
    await op('deleteClubExercise', { exerciseId: e.id });
    expect(await op('listClubExercises')).toHaveLength(1);
  });
});

d('Mode Club : inventaire', () => {
  it('matériel : fiche, série, prêt, retour, suppression', async () => {
    const c = await club();
    const m = await member(c.id, 'LOVELACE');
    const item = await op('addClubItem', {
      clubId: c.id,
      details: { name: 'Masque', category: 'mask', quantity: 3 },
    });
    expect(item).toMatchObject({ quantity: 3, availableQuantity: 3 });

    const loan = await op('lendClubItem', { itemId: item.id, memberId: m.id, quantity: 2 });
    expect(loan).toMatchObject({ quantity: 2, memberId: m.id });
    expect((await op('listClubItems', { clubId: c.id }))[0]).toMatchObject({
      lentQuantity: 2,
      availableQuantity: 1,
    });
    expect(await op('listClubLoans', { clubId: c.id, open: true })).toHaveLength(1);

    // Refus d'un dépôt : message conservé
    await expect(op('removeClubItem', { itemId: item.id })).rejects.toMatchObject({
      code: 'club_refused',
      message: 'Matériel encore prêté : rendez-le avant de le supprimer',
    });

    const back = await op('returnClubLoan', { loanId: loan.id, conditionIn: 'worn' });
    expect(back.returnedAt).toBeTruthy();
    expect(await op('listClubLoans', { clubId: c.id, open: true })).toHaveLength(0);
    await op('deleteClubLoan', { loanId: loan.id });
    await op('removeClubItem', { itemId: item.id });
    expect(await op('listClubItems', { clubId: c.id })).toHaveLength(0);

    const series = await op('addClubItemSeries', {
      clubId: c.id,
      details: { name: 'Plastron', category: 'plastron' },
      count: 3,
    });
    expect(series.map((x: { name: string }) => x.name)).toEqual([
      'Plastron-01',
      'Plastron-02',
      'Plastron-03',
    ]);
  });

  it('catégories, marques, verrou et import', async () => {
    const c = await club();
    const cat = await op('createClubCategory', { clubId: c.id, name: 'Chaussures' });
    expect((await op('renameClubCategory', { categoryId: cat.id, name: 'Souliers' })).name).toBe(
      'Souliers'
    );
    const brand = await op('createClubBrand', { clubId: c.id, name: 'Leon Paul' });
    expect((await op('listClubBrands', { clubId: c.id }))[0].id).toBe(brand.id);
    await op('renameClubBrand', { brandId: brand.id, name: 'Allstar' });
    await op('deleteClubBrand', { brandId: brand.id });
    await op('deleteClubCategory', { categoryId: cat.id });

    expect(
      await op('importClubItems', { clubId: c.id, items: [{ name: 'Veste', category: 'jacket' }] })
    ).toEqual({
      created: 1,
      skipped: 0,
    });
    expect(await op('getClubInventoryLock', { clubId: c.id })).toBe(false);
    expect(await op('setClubInventoryLock', { clubId: c.id, locked: true })).toBe(true);
    await expect(
      op('addClubItem', { clubId: c.id, details: { name: 'Gant', category: 'glove' } })
    ).rejects.toMatchObject({ code: 'club_refused' });
  });
});

d('Mode Club : tablettes, synchro et sauvegardes (port du poste)', () => {
  const status: ClubSyncStatus = {
    clubId: 'c',
    state: 'off',
    dir: null,
    fileName: null,
    lastSync: null,
    error: null,
  };
  const backups: ClubBackupEntry[] = [{ id: 'b1.bpclub', createdAt: '2026-11-22T10:00:00Z' }];

  function port(): ClubPort & { linked: string | null } {
    const p = {
      linked: 'S1' as string | null,
      remoteStatus: () => ({ active: true, url: 'http://10.0.0.2:8066', strips: 2 }),
      pushBout: vi.fn(() => 'ok' as const),
      linkSession: vi.fn((id: string | null) => {
        p.linked = id;
      }),
      linkedSession: () => p.linked,
      releaseBout: vi.fn(),
      sync: {
        status: vi.fn(() => status),
        enable: vi.fn(async () => null),
        disable: vi.fn(() => status),
        now: vi.fn(async () => status),
        resolve: vi.fn(async () => status),
      },
      backups: {
        list: vi.fn(() => backups),
        create: vi.fn(async () => backups),
        restore: vi.fn(async () => ({ clubName: 'Cercle' })),
      },
    };
    return p;
  }

  it('sans port : état inactif, autres opérations « unavailable »', async () => {
    expect(await op('getClubRemoteStatus')).toEqual({ active: false, url: null, strips: 0 });
    await expect(op('getClubSyncStatus', { clubId: 'c' })).rejects.toMatchObject({
      code: 'unavailable',
    });
    await expect(op('releaseClubBout', { boutId: 'b' })).rejects.toMatchObject({
      code: 'unavailable',
    });
  });

  it('tablettes : état, envoi du combat, liaison de la séance, libération', async () => {
    const p = port();
    ctx = { db, club: p };
    expect(await op('getClubRemoteStatus')).toMatchObject({ active: true, strips: 2 });

    const c = await club();
    const a = await member(c.id, 'A');
    const b = await member(c.id, 'B');
    const s = await op('planClubSession', { clubId: c.id, details: { date: '2026-11-16' } });
    const bout = await op('createClubBout', {
      sessionId: s.id,
      memberAId: a.id,
      memberBId: b.id,
      strip: 1,
    });
    expect(await op('sendClubBoutToStrip', { boutId: bout.id })).toBe('ok');
    expect(p.pushBout).toHaveBeenCalledWith(
      expect.objectContaining({ id: bout.id }),
      expect.objectContaining({ id: a.id }),
      expect.objectContaining({ id: b.id })
    );
    // Combat terminé ou inconnu : pas d'arène
    await op('finishClubBout', { boutId: bout.id, result: { scoreA: 5, scoreB: 0 } });
    expect(await op('sendClubBoutToStrip', { boutId: bout.id })).toBe('no_arena');
    expect(await op('sendClubBoutToStrip', { boutId: 'inconnu' })).toBe('no_arena');

    await op('linkClubSessionToStrips', { sessionId: s.id });
    expect(p.linked).toBe(s.id);
    // Séance fermée : déliée des tablettes
    await op('closeClubSession', { sessionId: s.id });
    expect(p.linked).toBeNull();
    await op('releaseClubBout', { boutId: bout.id });
    expect(p.releaseBout).toHaveBeenCalledWith(bout.id);
  });

  it('synchro et sauvegardes passent par le port', async () => {
    const p = port();
    ctx = { db, club: p };
    expect(await op('getClubSyncStatus', { clubId: 'c' })).toEqual(status);
    expect(await op('enableClubSync', { clubId: 'c' })).toBeNull();
    await op('disableClubSync', { clubId: 'c' });
    await op('syncClubNow', { clubId: 'c' });
    await op('resolveClubSyncConflict', { clubId: 'c', keep: 'file' });
    expect(p.sync.resolve).toHaveBeenCalledWith('c', 'file');
    await expect(
      op('resolveClubSyncConflict', { clubId: 'c', keep: 'autre' })
    ).rejects.toMatchObject({
      code: 'invalid_input',
    });
    expect(await op('listClubBackups', { clubId: 'c' })).toEqual(backups);
    expect(await op('createClubBackup', { clubId: 'c' })).toEqual(backups);
    expect(await op('restoreClubBackup', { clubId: 'c', backupId: 'b1.bpclub' })).toEqual({
      clubName: 'Cercle',
    });
  });

  it('une erreur du port est rendue en club_refused avec son message', async () => {
    const p = port();
    p.backups.restore = vi.fn(async () => {
      throw new Error('Sauvegarde introuvable');
    });
    ctx = { db, club: p };
    await expect(
      op('restoreClubBackup', { clubId: 'c', backupId: 'x.bpclub' })
    ).rejects.toMatchObject({ code: 'club_refused', message: 'Sauvegarde introuvable' });
  });

  it('onClubSynced : relaie la reprise du fichier ou la sauvegarde restaurée', () => {
    const seen: unknown[] = [];
    const off = subscribe(ctx, 'onClubSynced', {}, e => seen.push(e));
    publishClubSynced('c1');
    off();
    publishClubSynced('c2');
    expect(seen).toEqual([{ clubId: 'c1' }]);
  });
});

describe('Mode Club : jamais sur le réseau (docs/adr/0022)', () => {
  const clubOps = (Object.keys(contract) as OperationName[]).filter(n =>
    contract[n].permission.startsWith('club:')
  );

  it('le contrat déclare les opérations du club', () => {
    expect(clubOps.length).toBeGreaterThanOrEqual(75);
    expect(clubOps).toContain('listClubMembers');
    expect(clubOps).toContain('onClubSynced');
  });

  it('aucune opération club:* n’a d’outil MCP', () => {
    for (const n of clubOps) expect((contract[n] as { mcp?: unknown }).mcp).toBeUndefined();
  });
});

describe('erreurs du Mode Club', () => {
  it('refus du dépôt : club_refused avec son message ; panne SQLite : erreur interne', async () => {
    const { refuse } = await import('./club');
    expect(() =>
      refuse(() => {
        throw new Error('Séance fermée');
      })
    ).toThrow(expect.objectContaining({ code: 'club_refused', message: 'Séance fermée' }));
    const sqlite = Object.assign(new Error('SQLITE_CONSTRAINT: UNIQUE failed: club_members.id'), {
      code: 'SQLITE_CONSTRAINT_UNIQUE',
    });
    expect(() =>
      refuse(() => {
        throw sqlite;
      })
    ).toThrow(sqlite);
  });
});
