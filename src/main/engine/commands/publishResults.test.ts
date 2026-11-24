/**
 * Publication des résultats par le contrat (#1981 lot 4, docs/adr/0022 amendée), base SQLite
 * réelle, envoi simulé : XML construit par le moteur, GREG, dépôt FTP, adresse escrime-info.com
 * routée vers GREG, URL refusée, échec réseau, mot de passe absent des traces ; poules d'une
 * préparation écrite en base relues par getCompetitionState.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '../../../database';
import { hasNodeSqlite } from '../../../database/testing/nodeSqliteDatabase';
import { contract } from '../../../shared/api/contract';
import { ApiError } from '../../../shared/api/client';
import { STATION_PERMISSIONS } from '../../../shared/api/contractDef';
import { Category, Gender, Weapon, type Fencer } from '../../../shared/types';
import { logger } from '../../../shared/services/logger';
import { buildDefaultCompetitionSettings } from '../../../shared/utils/defaultCompetitionSettings';
import type { CommandContext, SendResult, StationPort } from './context';
import { invoke } from '../api/engine';
import { wsRefusal } from '../api/wsAdapter';

vi.mock('better-sqlite3-multiple-ciphers', async () => ({
  default: (await import('../../../database/testing/nodeSqliteDatabase')).NodeSqliteDatabase,
}));

const d = hasNodeSqlite ? describe : describe.skip;

const SECRET = 'mot-de-passe-secret';

let db: DatabaseManager;
let ctx: CommandContext;
let competitionId: string;
let sent: { kind: 'greg' | 'remote'; request: Record<string, unknown> }[];
let reply: SendResult;

function publicationPort(): StationPort['publication'] {
  return {
    greg: async request => {
      sent.push({ kind: 'greg', request });
      return reply;
    },
    remote: async request => {
      sent.push({ kind: 'remote', request });
      return reply;
    },
  };
}

beforeEach(async () => {
  db = new DatabaseManager(':memory:');
  await db.open(':memory:');
  sent = [];
  reply = { success: true };
  // Seul le port de publication sert ici
  ctx = { db, station: { publication: publicationPort() } as unknown as StationPort };
  competitionId = db.createCompetition({
    title: 'Open de Vitré',
    date: new Date('2026-12-06'),
    location: 'Gymnase',
    weapon: Weapon.EPEE,
    gender: Gender.MALE,
    category: Category.SENIOR,
    settings: buildDefaultCompetitionSettings({ weapon: Weapon.EPEE, category: Category.SENIOR }),
  }).id;
  db.addFencer(competitionId, { firstName: 'Paul', lastName: 'Dupont' } as never);
});
afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

const publish = (target: unknown, c = ctx) =>
  invoke(c, 'publishResults', { competitionId, target }) as Promise<{
    target: string;
    fileName: string;
  }>;

const refusal = async (promise: Promise<unknown>) => {
  const e = await promise.then(
    () => null,
    (err: unknown) => err
  );
  expect(e).toBeInstanceOf(ApiError);
  return e as ApiError;
};

const FTP = { url: 'ftp://ftp.club.fr/resultats', user: 'club', password: SECRET };

d('publishResults : GREG', () => {
  it('construit le XML depuis la base et l’envoie avec les champs du formulaire', async () => {
    expect(await publish('greg')).toEqual({
      target: 'greg',
      fileName: 'resultats_Open_de_Vitr_.xml',
    });
    expect(sent).toHaveLength(1);
    const { kind, request } = sent[0];
    expect(kind).toBe('greg');
    expect(request.xml).toContain('<CompetitionIndividuelle');
    expect(request.xml).toContain('TitreLong="Open de Vitré"');
    expect(request.fields).toMatchObject({
      lieu: 'Gymnase',
      arme: 'E',
      categorie: 'S',
      'dp-normal-1': '06.12.2026',
    });
  });

  it('une adresse escrime-info.com saisie comme dépôt part vers GREG, sans identifiants', async () => {
    const out = await publish({
      ftp: { url: 'https://www.escrime-info.com/x', user: 'u', password: SECRET },
    });
    expect(out.target).toBe('greg');
    expect(sent.map(s => s.kind)).toEqual(['greg']);
    expect(JSON.stringify(sent)).not.toContain(SECRET);
  });

  it('épreuve sans lieu : not_publishable, rien n’est envoyé', async () => {
    db.updateCompetition(competitionId, { location: '' });
    const e = await refusal(publish('greg'));
    expect(e.code).toBe('not_publishable');
    expect(e.message).toMatch(/lieu/);
    expect(sent).toEqual([]);
  });

  it('échec du serveur : publication_failed, message pour l’opérateur', async () => {
    reply = { success: false, error: 'HTTP 503' };
    const e = await refusal(publish('greg'));
    expect(e.code).toBe('publication_failed');
    expect(e.message).toBe('Échec de la publication GREG : HTTP 503');
  });
});

d('publishResults : dépôt FTP / HTTP', () => {
  it('dépose le XML à l’adresse indiquée avec les identifiants', async () => {
    expect(await publish({ ftp: FTP })).toMatchObject({ target: 'ftp' });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      kind: 'remote',
      request: { url: FTP.url, user: 'club', password: SECRET },
    });
    expect(sent[0].request.xml).toContain('TitreLong="Open de Vitré"');
  });

  it.each([
    ['gopher://hote/x', /schéma/],
    ['ftp://club:pass@ftp.club.fr/x', /identifiant/],
    ['ftp:///dossier', /adresse invalide/],
  ])('URL refusée %s : invalid_url, rien n’est envoyé', async (url, message) => {
    const e = await refusal(publish({ ftp: { ...FTP, url } }));
    expect(e.code).toBe('invalid_url');
    expect(e.message).toMatch(message);
    expect(sent).toEqual([]);
  });

  it('échec réseau : publication_failed, mot de passe masqué et jamais logué', async () => {
    const logs = [
      vi.spyOn(logger, 'error'),
      vi.spyOn(logger, 'warn'),
      vi.spyOn(logger, 'info'),
      vi.spyOn(logger, 'debug'),
    ];
    reply = { success: false, error: `530 Login incorrect for ${SECRET}` };
    const e = await refusal(publish({ ftp: FTP }));
    expect(e.code).toBe('publication_failed');
    expect(e.message).toBe('Échec de l’envoi FTP : 530 Login incorrect for ***');
    expect(JSON.stringify(e.toJSON())).not.toContain(SECRET);
    for (const spy of logs) expect(JSON.stringify(spy.mock.calls)).not.toContain(SECRET);
  });

  it('mot de passe trop long : invalid_input, sans écho de la valeur', async () => {
    const long = `${SECRET}${'x'.repeat(200)}`;
    const e = await refusal(publish({ ftp: { ...FTP, password: long } }));
    expect(e.code).toBe('invalid_input');
    expect(e.message).not.toContain(SECRET);
  });
});

d('publishResults : fonction du poste (docs/adr/0022)', () => {
  it('sans port de publication (MCP, tests) : unavailable', async () => {
    const e = await refusal(publish('greg', { db }));
    expect(e.code).toBe('unavailable');
  });

  it('épreuve inconnue : competition_not_found', async () => {
    const e = await refusal(
      invoke(ctx, 'publishResults', { competitionId: 'nope', target: 'greg' })
    );
    expect(e.code).toBe('competition_not_found');
  });

  it('droit du poste, pas d’outil MCP, refusé sur le réseau, pas de journal', async () => {
    const def = contract.publishResults;
    expect(def.permission).toBe('station:admin');
    expect(STATION_PERMISSIONS.has(def.permission)).toBe(true);
    expect((def as { mcp?: unknown }).mcp).toBeUndefined();
    expect(wsRefusal('publishResults', { competitionId }, competitionId)?.code).toBe(
      'permission_denied'
    );
    await publish('greg');
    expect(db.eventLog.getRevision(competitionId)).toBe(0);
  });
});

d('getCompetitionState : poules préparées par une version précédente', () => {
  it('rend les poules écrites en base tant que l’état n’en a pas', async () => {
    const fencer = db.getFencersByCompetition(competitionId)[0] as Fencer;
    const phase = db.createPhase(competitionId, 'pool', 1, 'Poules');
    const pool = db.createPool(phase.id, 1);
    db.addFencerToPool(pool.id, fencer.id, 1);
    const r = (await invoke(ctx, 'getCompetitionState', { competitionId })) as {
      state: unknown;
      preparedPools: { id: string; fencers: { id: string }[] }[];
    };
    expect(r.preparedPools.map(p => p.id)).toEqual([pool.id]);
    expect(r.preparedPools[0].fencers.map(f => f.id)).toEqual([fencer.id]);
  });

  it('vide sans préparation en base, ou quand l’état a ses poules', async () => {
    const empty = (await invoke(ctx, 'getCompetitionState', { competitionId })) as {
      preparedPools: unknown[];
    };
    expect(empty.preparedPools).toEqual([]);
    const phase = db.createPhase(competitionId, 'pool', 1, 'Poules');
    db.createPool(phase.id, 1);
    db.saveSessionState(competitionId, { pools: [{ id: 'session-pool', fencers: [] }] });
    const r = (await invoke(ctx, 'getCompetitionState', { competitionId })) as {
      state: { pools: { id: string }[] };
      preparedPools: unknown[];
    };
    expect(r.state.pools.map(p => p.id)).toEqual(['session-pool']);
    expect(r.preparedPools).toEqual([]);
  });
});
