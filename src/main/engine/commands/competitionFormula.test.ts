/**
 * Modèles de formule et formule d'une épreuve par le contrat (docs/adr/0033), base SQLite réelle.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '../../../database';
import { hasNodeSqlite } from '../../../database/testing/nodeSqliteDatabase';
import { Category, FencerStatus, Gender, Weapon } from '../../../shared/types';
import { buildDefaultCompetitionSettings } from '../../../shared/utils/defaultCompetitionSettings';
import { draftFromSettings } from '../../../shared/domain/formula/formulaDraft';
import { contract } from '../../../shared/api/contract';
import type { CommandContext } from './context';
import { invoke } from '../api/engine';
import { effectiveSettings } from './sport';
import { tieBreakByVictoryOf } from '../../../shared/domain/formula/formulaV2';

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
    // Écarts phase par phase (ADR-0036) : un tour ajouté, les touches du tableau
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
    // Formule en briques, plus de mode spécial (docs/adr/0043, F4e)
    expect(comp.settings?.specialMode).toBeUndefined();
    expect(comp.settings?.formulaOrigin).toEqual({ templateId: 'bpm/C/rapieres' });
    expect(comp.settings?.formula?.phases[0]).toMatchObject({
      boutOrder: 'waves',
      distribution: 'byLevel',
    });
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

d('formule v2 écrite et lue par phase (docs/adr/0036)', () => {
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

  it('tour en vagues (docs/adr/0043) : ordre « waves », poules de 2 à 10, au-delà refusé', async () => {
    await op('updateCompetitionFormula', {
      competitionId,
      operations: [
        {
          op: 'setPhase',
          phase: 'pool-0',
          settings: { boutOrder: 'waves', sizeMin: 2, sizeMax: 10 },
        },
      ],
    });
    const comp = db.getCompetition(competitionId)!;
    expect(comp.settings?.formula?.phases[0]).toMatchObject({
      boutOrder: 'waves',
      sizeMin: 2,
      sizeMax: 10,
    });
    expect(comp.settings).toMatchObject({ poolBoutOrder: 'waves', poolSizeMin: 2 });
    await expect(
      op('updateCompetitionFormula', {
        competitionId,
        operations: [{ op: 'setPhase', phase: 'pool-0', settings: { sizeMax: 11 } }],
      })
    ).rejects.toMatchObject({ code: 'invalid_settings' });
    // Vagues classiques : jusqu'à 15
    await op('updateCompetitionFormula', {
      competitionId,
      operations: [
        {
          op: 'setPhase',
          phase: 'pool-0',
          settings: { boutOrder: 'waves_classic', sizeMax: 15 },
        },
      ],
    });
    expect(db.getCompetition(competitionId)?.settings).toMatchObject({
      poolBoutOrder: 'waves_classic',
      poolSizeMax: 15,
    });
    await expect(
      op('updateCompetitionFormula', {
        competitionId,
        operations: [{ op: 'setPhase', phase: 'pool-0', settings: { boutOrder: 'waves' } }],
      })
    ).rejects.toMatchObject({ code: 'invalid_settings' });
    // Retour à l'ordre FIE : poules de 2 refusées de nouveau
    await expect(
      op('updateCompetitionFormula', {
        competitionId,
        operations: [{ op: 'setPhase', phase: 'pool-0', settings: { boutOrder: 'fie' } }],
      })
    ).rejects.toMatchObject({ code: 'invalid_settings' });
  });

  it('arme « Autre » : tour en vagues de 2 à 10 aussi, ordre gardé dans les réglages plats', async () => {
    const other = db.createCompetition({
      title: 'Autre',
      date: new Date('2026-12-06'),
      weapon: Weapon.CUSTOM,
      gender: Gender.MIXED,
      category: Category.SENIOR,
      settings: buildDefaultCompetitionSettings({
        weapon: Weapon.CUSTOM,
        category: Category.SENIOR,
      }) as never,
    });
    await op('updateCompetitionFormula', {
      competitionId: other.id,
      operations: [
        {
          op: 'setPhase',
          phase: 'pool-0',
          settings: { boutOrder: 'waves_classic', sizeMin: 2, sizeMax: 10 },
        },
      ],
    });
    const { settings } = db.getCompetition(other.id)!;
    expect(settings).toMatchObject({ poolBoutOrder: 'waves_classic' });
    expect(settings?.formula?.phases[0]).toMatchObject({ sizeMin: 2, sizeMax: 10 });
    expect(settings?.customFormula?.phases[0].config).toMatchObject({
      minPoolSize: 2,
      maxPoolSize: 10,
    });
  });

  it('tieBreakByVictory : posé et retiré par le contrat, lu par la formule (docs/adr/0043, F4e)', async () => {
    const other = db.createCompetition({
      title: 'Autre',
      date: new Date('2026-12-06'),
      weapon: Weapon.CUSTOM,
      gender: Gender.MIXED,
      category: Category.SENIOR,
      settings: buildDefaultCompetitionSettings({
        weapon: Weapon.CUSTOM,
        category: Category.SENIOR,
      }) as never,
    });
    const read = () => db.getCompetition(other.id)!.settings;
    expect(tieBreakByVictoryOf(Weapon.CUSTOM, read())).toBe(false);
    await op('updateCompetitionFormula', {
      competitionId: other.id,
      operations: [{ op: 'setGeneral', settings: { tieBreakByVictory: true } }],
    });
    expect(read()?.formula?.general.tieBreakByVictory).toBe(true);
    expect(tieBreakByVictoryOf(Weapon.CUSTOM, read())).toBe(true);
    const f = await op('getCompetitionFormula', { competitionId: other.id });
    expect(f.formula.general.tieBreakByVictory).toBe(true);
    await op('updateCompetitionFormula', {
      competitionId: other.id,
      operations: [{ op: 'setGeneral', settings: { tieBreakByVictory: null } }],
    });
    expect('tieBreakByVictory' in (read()?.formula?.general ?? {})).toBe(false);
    expect(tieBreakByVictoryOf(Weapon.CUSTOM, read())).toBe(false);
  });

  it('tieBreakByVictory non booléen : refus invalid_settings, rien d’écrit', async () => {
    await expect(
      op('updateCompetitionFormula', {
        competitionId,
        operations: [{ op: 'setGeneral', settings: { tieBreakByVictory: 'oui' } }],
      })
    ).rejects.toMatchObject({ code: 'invalid_settings' });
    expect(db.getCompetition(competitionId)!.settings?.formula?.general.tieBreakByVictory).toBe(
      undefined
    );
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

  it('réglages plats écrits sans formula : reportés dans la formule (ADR-0036 amendée), ou formule retirée pour la structure', async () => {
    await op('updateCompetitionFormula', {
      competitionId,
      operations: [
        { op: 'insertPhase', brick: 'pool', at: 1 },
        {
          op: 'setPhase',
          phase: 'pool-0',
          settings: { qualification: { mode: 'fixed_count', count: 10 } },
        },
      ],
    });
    expect(db.getCompetition(competitionId)?.settings?.formula).toBeDefined();
    // Réglage qui a sa place dans la formule : reporté, tous les tours de poules, formule gardée
    await op('updateCompetitionSettings', {
      competitionId,
      settings: { defaultPoolMaxScore: 4, thirdPlaceMatch: true, restTimeSeconds: 90 },
    });
    let comp = db.getCompetition(competitionId)!;
    expect(comp.settings?.formula?.phases[0]).toMatchObject({
      maxScore: 4,
      qualification: { mode: 'fixed_count', count: 10 },
    });
    expect(comp.settings?.formula?.phases[1]).toMatchObject({ maxScore: 4 });
    expect(comp.settings?.formula?.phases.find(p => p.kind === 'tableau')).toMatchObject({
      thirdPlace: true,
    });
    expect(comp.settings?.formula?.general.restTimeSeconds).toBe(90);
    expect(effectiveSettings(comp, 2).poolMaxScore).toBe(4);
    // Réglage de structure : formule périmée, retirée et relue depuis les réglages plats
    await op('updateCompetitionSettings', { competitionId, settings: { poolWinnersOnly: true } });
    comp = db.getCompetition(competitionId)!;
    expect(comp.settings?.formula).toBeUndefined();
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

d('contrôles de structure en direct (docs/adr/0041)', () => {
  const reject = async (operations: unknown[]) => {
    try {
      await op('updateCompetitionFormula', { competitionId, operations });
    } catch (e) {
      return e as { code: string; message: string };
    }
    throw new Error('formule acceptée');
  };

  it('S3 : refus invalid_settings, une remarque par ligne avec la clé de la phase', async () => {
    const e = await reject([
      { op: 'insertPhase', brick: 'pool', at: 1 },
      {
        op: 'setPhase',
        phase: 'pool-0',
        settings: { qualification: { mode: 'fixed_count', count: 3 } },
      },
    ]);
    expect(e.code).toBe('invalid_settings');
    expect(e.message).toMatch(
      /^Formule refusée :\n\[pool-0\] tour 1 : 3 qualifié\(s\) pour des poules/
    );
    expect(db.getCompetition(competitionId)?.settings?.formula).toBeUndefined();
  });

  it('S4 : l’effectif connu borne la somme des parts d’une scission par rang', async () => {
    for (const i of [1, 2, 3])
      db.addFencer(competitionId, {
        lastName: `N${i}`,
        firstName: `P${i}`,
        gender: Gender.MALE,
        category: Category.SENIOR,
        club: 'Paris',
        ranking: i,
        status: FencerStatus.CHECKED_IN,
      });
    const e = await reject([
      { op: 'removePhase', phase: 'tableau' },
      { op: 'insertPhase', brick: 'split', at: 1 },
    ]);
    expect(e.message).toContain('[split] scission : les parts (16 tireurs)');
  });

  it('S6 : tour clos (closePoolRound), la qualification qui en sort est verrouillée dès la clôture', async () => {
    const qualify = (count: number) => [
      {
        op: 'setPhase',
        phase: 'pool-0',
        settings: { qualification: { mode: 'fixed_count', count } },
      },
    ];
    await op('updateCompetitionFormula', { competitionId, operations: qualify(8) });
    // Tour 1 lancé, pas clos : la règle reste modifiable
    db.saveSessionState(competitionId, {
      currentPhase: 2,
      currentPoolRound: 1,
      pools: [{ id: 'p1', matches: [] }],
      poolsLaunched: true,
    });
    await op('updateCompetitionFormula', { competitionId, operations: qualify(6) });
    // Tour 1 clos : archivé, plus de poules, tableau pas tiré
    db.saveSessionState(competitionId, {
      currentPhase: 1,
      currentPoolRound: 2,
      poolHistory: [[{ id: 'p1', matches: [] }]],
      pools: [],
      poolsLaunched: false,
    });
    const e = await reject(qualify(4));
    expect(e.code).toBe('invalid_settings');
    expect(e.message).toContain('[pool-0] qualification du tour : le tour est clos');
    // Même règle : admise ; autres réglages du tour : admis
    await op('updateCompetitionFormula', { competitionId, operations: qualify(6) });
    expect(
      db.getCompetition(competitionId)?.settings?.formula?.phases.find(p => p.kind === 'pool')
    ).toMatchObject({ qualification: { mode: 'fixed_count', count: 6 } });
  });

  it('S6 : updateCompetitionSettings ne contourne pas le verrou du tour clos', async () => {
    await op('updateCompetitionFormula', {
      competitionId,
      operations: [
        {
          op: 'setPhase',
          phase: 'pool-0',
          settings: { qualification: { mode: 'fixed_count', count: 8 } },
        },
      ],
    });
    db.saveSessionState(competitionId, {
      currentPhase: 1,
      currentPoolRound: 2,
      poolHistory: [[{ id: 'p1', matches: [] }]],
      pools: [],
      poolsLaunched: false,
    });
    const formula = db.getCompetition(competitionId)!.settings!.formula!;
    const changed = {
      ...formula,
      phases: formula.phases.map(p =>
        p.kind === 'pool' ? { ...p, qualification: { mode: 'fixed_count', count: 4 } } : p
      ),
    };
    await expect(
      op('updateCompetitionSettings', { competitionId, settings: { formula: changed } })
    ).rejects.toMatchObject({ code: 'invalid_settings' });
    expect(
      db.getCompetition(competitionId)?.settings?.formula?.phases.find(p => p.kind === 'pool')
    ).toMatchObject({ qualification: { mode: 'fixed_count', count: 8 } });
    // Réglage hors formule : admis
    await op('updateCompetitionSettings', { competitionId, settings: { expertMode: true } });
    // Autre réglage plat (Q15) : admis, reporté dans la formule, la règle du tour clos gardée
    await op('updateCompetitionSettings', {
      competitionId,
      settings: { defaultTableTimerSeconds: 240 },
    });
    expect(
      db.getCompetition(competitionId)?.settings?.formula?.phases.find(p => p.kind === 'pool')
    ).toMatchObject({ qualification: { mode: 'fixed_count', count: 8 } });
    // Qualification changée par un réglage plat : refusée
    await expect(
      op('updateCompetitionSettings', { competitionId, settings: { poolWinnersOnly: true } })
    ).rejects.toMatchObject({ code: 'invalid_settings' });
  });

  it('ADR-0043 F4b : petite finale et « toutes les places » modifiables jusqu’au tirage du tableau', async () => {
    const mode = (thirdPlace: boolean, allPlaces: boolean) => [
      { op: 'setPhase', phase: 'tableau', settings: { thirdPlace, allPlaces } },
    ];
    // Tableau pas tiré : modifiable
    await op('updateCompetitionFormula', { competitionId, operations: mode(true, false) });
    await op('updateCompetitionFormula', { competitionId, operations: mode(false, true) });
    // Tableau tiré
    db.saveSessionState(competitionId, {
      currentPhase: 3,
      poolHistory: [[{ id: 'p1', matches: [] }]],
      tableauMatches: [{ id: 'm1', round: 2, position: 0 }],
    });
    const e = await reject(mode(true, false));
    expect(e.code).toBe('invalid_settings');
    expect(e.message).toContain('[tableau] tableau déjà tiré');
    // Ni par les réglages plats
    await expect(
      op('updateCompetitionSettings', { competitionId, settings: { playAllPositions: false } })
    ).rejects.toMatchObject({ code: 'invalid_settings' });
    expect(db.getCompetition(competitionId)?.settings?.playAllPositions).toBe(true);
  });

  it('S6 : après un tour joué, la phase commencée ne se retire plus', async () => {
    await op('updateCompetitionFormula', {
      competitionId,
      operations: [{ op: 'insertPhase', brick: 'pool', at: 1 }],
    });
    // Tour 1 clos (historique), tour 2 en cours
    db.saveSessionState(competitionId, {
      currentPhase: 2,
      currentPoolRound: 2,
      poolHistory: [[{ id: 'p1', matches: [] }]],
      pools: [{ id: 'p2', matches: [] }],
    });
    const e = await reject([{ op: 'removePhase', phase: 'pool-1' }]);
    expect(e.code).toBe('invalid_settings');
    expect(e.message).toContain('[pool-1] phase déjà commencée (tour de poules)');
    // Un tour ajouté après la dernière phase commencée reste permis
    await op('updateCompetitionFormula', {
      competitionId,
      operations: [{ op: 'insertPhase', brick: 'pool', at: 2 }],
    });
    expect(db.getCompetition(competitionId)?.settings?.formula?.phases).toHaveLength(4);
  });
});
