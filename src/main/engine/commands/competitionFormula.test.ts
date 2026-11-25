/**
 * Modèles de formule et formule d'une épreuve par le contrat (docs/adr/0033), base SQLite réelle.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '../../../database';
import { hasNodeSqlite } from '../../../database/testing/nodeSqliteDatabase';
import { Category, Gender, Weapon } from '../../../shared/types';
import { buildDefaultCompetitionSettings } from '../../../shared/utils/defaultCompetitionSettings';
import { draftFromSettings } from '../../../shared/domain/formula/formulaDraft';
import { contract } from '../../../shared/api/contract';
import type { CommandContext } from './context';
import { invoke } from '../api/engine';
import { effectiveSettings } from './sport';

vi.mock('better-sqlite3-multiple-ciphers', async () => ({
  default: (await import('../../../database/testing/nodeSqliteDatabase')).NodeSqliteDatabase,
}));

const d = hasNodeSqlite ? describe : describe.skip;

let db: DatabaseManager;
let ctx: CommandContext;
let competitionId: string;

beforeEach(async () => {
  db = new DatabaseManager(':memory:');
  await db.open(':memory:');
  ctx = { db, emitChange: () => undefined };
  competitionId = db.createCompetition({
    title: 'Formule',
    date: new Date('2026-12-06'),
    weapon: Weapon.EPEE,
    gender: Gender.MALE,
    category: Category.SENIOR,
    settings: buildDefaultCompetitionSettings({
      weapon: Weapon.EPEE,
      category: Category.SENIOR,
    }) as never,
  }).id;
});
afterEach(() => db.close());

const op = (name: string, input: Record<string, unknown>) =>
  invoke(ctx, name as never, input as never) as Promise<any>;

d('modèles de formule (docs/adr/0033)', () => {
  it('liste : fournis puis personnels, standard du contexte', async () => {
    const r = await op('listFormulaTemplates', { weapon: 'E', category: 'U13' });
    expect(r.standardId).toBe('bpm/E/U13/ind/standard');
    expect(r.templates.map((t: { code: string }) => t.code)).toEqual([
      'standard',
      'two_rounds',
      'pools_only',
    ]);
  });

  it('enregistrer une copie, la retrouver, la supprimer ; un modèle fourni est refusé', async () => {
    const draft = draftFromSettings(Weapon.EPEE, Category.SENIOR, undefined);
    const { template } = await op('saveFormulaTemplate', {
      name: 'Mon club',
      origin: { templateId: 'bpm/E/SEN/ind/standard' },
      body: { kind: 'draft', draft: { ...draft, poolRounds: 2, poolRoundQualifiers: [0] } },
    });
    expect(template.source).toBe('personal');
    const list = await op('listFormulaTemplates', { text: 'mon club' });
    expect(list.templates.map((t: { id: string }) => t.id)).toEqual([template.id]);

    await expect(
      op('saveFormulaTemplate', {
        id: 'bpm/E/SEN/ind/standard',
        name: 'Écrasé',
        body: { kind: 'draft', draft },
      })
    ).rejects.toMatchObject({ code: 'station_refused' });
    await expect(op('deleteFormulaTemplate', { id: 'bpm/C/rapieres' })).rejects.toMatchObject({
      code: 'station_refused',
    });
    await op('deleteFormulaTemplate', { id: template.id });
    await expect(op('deleteFormulaTemplate', { id: template.id })).rejects.toMatchObject({
      code: 'formula_template_not_found',
    });
  });

  it('formule hors bornes refusée à l’entrée', async () => {
    const draft = draftFromSettings(Weapon.EPEE, Category.SENIOR, undefined);
    await expect(
      op('saveFormulaTemplate', {
        name: 'Faux',
        body: { kind: 'draft', draft: { ...draft, poolRounds: 9 } },
      })
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('MCP : liste en lecture, aucun outil d’écriture des modèles', () => {
    expect(contract.listFormulaTemplates.mcp?.name).toBe('list_formula_templates');
    expect((contract.saveFormulaTemplate as { mcp?: unknown }).mcp).toBeUndefined();
    expect((contract.deleteFormulaTemplate as { mcp?: unknown }).mcp).toBeUndefined();
  });
});

d('formule d’une épreuve (docs/adr/0033)', () => {
  it('lecture : frise, briques autorisées, état libre sans origine', async () => {
    const f = await op('getCompetitionFormula', { competitionId });
    expect(f.phases.map((p: { key: string }) => p.key)).toEqual(['pool-0', 'tableau']);
    expect(f.insertOptions).toEqual([['pool'], ['pool'], []]);
    expect(f.state).toBe('free');
  });

  it('appliquer le standard : état standard ; modifier : adaptée avec l’écart', async () => {
    await op('applyFormulaTemplate', { competitionId, templateId: 'bpm/E/SEN/ind/standard' });
    expect((await op('getCompetitionFormula', { competitionId })).state).toBe('standard');

    const r = await op('updateCompetitionFormula', {
      competitionId,
      operations: [
        { op: 'insertPhase', brick: 'pool', at: 1 },
        { op: 'setPhase', phase: 'tableau', settings: { tableMaxScore: 10 } },
      ],
    });
    expect(r.changed).toContain('settings.poolRounds');
    const f = await op('getCompetitionFormula', { competitionId });
    expect(f.phases.map((p: { key: string }) => p.key)).toEqual(['pool-0', 'pool-1', 'tableau']);
    expect(f.state).toBe('adapted');
    // Écarts phase par phase (ADR-0034) : un tour ajouté, les touches du tableau
    expect(f.deviations.map((x: { field: string }) => x.field).sort()).toEqual([
      '+pool',
      'tableau.maxScore',
    ]);
  });

  it('tout ou rien : une opération refusée n’écrit rien', async () => {
    await expect(
      op('updateCompetitionFormula', {
        competitionId,
        operations: [
          { op: 'insertPhase', brick: 'pool', at: 1 },
          { op: 'insertPhase', brick: 'tableau', at: 2 },
        ],
      })
    ).rejects.toMatchObject({ code: 'invalid_settings' });
    expect(db.getCompetition(competitionId)?.settings?.poolRounds).toBe(1);
  });

  it('modèle incompatible ou inconnu refusé', async () => {
    await expect(
      op('applyFormulaTemplate', { competitionId, templateId: 'bpm/C/rapieres' })
    ).rejects.toMatchObject({ code: 'invalid_settings' });
    await expect(
      op('applyFormulaTemplate', { competitionId, templateId: 'nulle/part' })
    ).rejects.toMatchObject({ code: 'formula_template_not_found' });
  });

  it('createCompetition avec un modèle : Tournoi des rapières, arme « Autre »', async () => {
    const r = await op('createCompetition', {
      title: 'Rapières',
      date: '2026-12-13',
      weapon: 'C',
      gender: 'X',
      category: 'SEN',
      templateId: 'bpm/C/rapieres',
    });
    const comp = db.getCompetition(r.competitionId)!;
    expect(comp.settings?.specialMode).toBe('rapieres');
    expect(comp.settings?.formulaOrigin).toEqual({ templateId: 'bpm/C/rapieres' });
    expect(comp.settings?.customFormula?.phases.map(p => p.type)).toEqual([
      'pool_round',
      'direct_elimination',
    ]);
  });

  it('outils MCP de la formule d’une épreuve', () => {
    expect(contract.getCompetitionFormula.mcp?.name).toBe('get_competition_formula');
    expect(contract.applyFormulaTemplate.mcp?.name).toBe('apply_formula_template');
    expect(contract.updateCompetitionFormula.mcp?.name).toBe('update_competition_formula');
  });
});

d('formule v2 écrite et lue par phase (docs/adr/0034)', () => {
  it('updateCompetitionFormula écrit formula et les réglages plats du 1er tour', async () => {
    await op('updateCompetitionFormula', {
      competitionId,
      operations: [
        { op: 'insertPhase', brick: 'pool', at: 1 },
        { op: 'setPhase', phase: 'pool-1', settings: { maxScore: 4 } },
      ],
    });
    const comp = db.getCompetition(competitionId)!;
    expect(comp.settings?.formula?.phases.map(p => p.kind)).toEqual(['pool', 'pool', 'tableau']);
    expect(comp.settings).toMatchObject({ poolRounds: 2, defaultPoolMaxScore: 5 });
    expect(effectiveSettings(comp, 1).poolMaxScore).toBe(5);
    expect(effectiveSettings(comp, 2).poolMaxScore).toBe(4);
    const f = await op('getCompetitionFormula', { competitionId });
    expect(f.formula.phases[1].maxScore).toBe(4);
  });

  it('bornes du tour 2 refusées', async () => {
    await expect(
      op('updateCompetitionFormula', {
        competitionId,
        operations: [
          { op: 'insertPhase', brick: 'pool', at: 1 },
          { op: 'setPhase', phase: 'pool-1', settings: { maxScore: 40 } },
        ],
      })
    ).rejects.toMatchObject({ code: 'invalid_settings' });
  });

  it('réglages plats écrits sans formula : formule retirée, reconstruite à la lecture', async () => {
    await op('updateCompetitionFormula', {
      competitionId,
      operations: [{ op: 'insertPhase', brick: 'pool', at: 1 }],
    });
    expect(db.getCompetition(competitionId)?.settings?.formula).toBeDefined();
    await op('updateCompetitionSettings', { competitionId, settings: { defaultPoolMaxScore: 4 } });
    const comp = db.getCompetition(competitionId)!;
    expect(comp.settings?.formula).toBeUndefined();
    expect(effectiveSettings(comp, 2).poolMaxScore).toBe(4);
    // Réglage sans rapport avec la formule : formule gardée
    await op('updateCompetitionFormula', {
      competitionId,
      operations: [{ op: 'setPhase', phase: 'pool-1', settings: { maxScore: 3 } }],
    });
    await op('updateCompetitionSettings', { competitionId, settings: { expertMode: false } });
    expect(db.getCompetition(competitionId)?.settings?.formula).toBeDefined();
  });

  it('modèle appliqué ou choisi à la création : formula enregistrée', async () => {
    await op('applyFormulaTemplate', { competitionId, templateId: 'bpm/E/SEN/ind/two_rounds' });
    expect(db.getCompetition(competitionId)?.settings?.formula?.phases).toHaveLength(3);
    const r = await op('createCompetition', {
      title: 'Avec modèle',
      date: '2026-12-13',
      weapon: 'F',
      gender: 'F',
      category: 'U13',
      templateId: 'bpm/F/U13/ind/standard',
    });
    const created = db.getCompetition(r.competitionId)!;
    expect(created.settings?.formula?.phases.map(p => p.kind)).toEqual(['pool', 'tableau']);
    expect(created.settings?.defaultPoolMaxScore).toBe(4);
  });
});
