/**
 * Feuille de route : variables, horaires, saison, complétude, relecture
 * Licensed under GPL-3.0
 */

import { describe, expect, it } from 'vitest';
import {
  completeness,
  expandVariables,
  deadlineOf,
  emptyInfo,
  frenchTime,
  moveItem,
  nextId,
  normalizeRoadmap,
  parseBlocks,
  resolveText,
  roadmapVariables,
  seasonOf,
  splitVariables,
  suggestSchedule,
  variablesOfField,
} from './roadmap';
import { SUGGESTED_SECTIONS, createRoadmap, sectionFromSeed } from './presets';

const fmt = (iso: string) => `D:${iso}`;

describe('roadmap : dates et horaires', () => {
  it('saison sportive à partir du 1er septembre', () => {
    expect(seasonOf('2026-12-20')).toBe('2026-2027');
    expect(seasonOf('2027-03-01')).toBe('2026-2027');
    expect(seasonOf('2026-09-01')).toBe('2026-2027');
    expect(seasonOf('2026-08-31')).toBe('2025-2026');
    expect(seasonOf('')).toBe('');
  });

  it('date limite : N jours avant, change de mois', () => {
    expect(deadlineOf('2026-12-20', 6)).toBe('2026-12-14');
    expect(deadlineOf('2026-03-02', 3)).toBe('2026-02-27');
    expect(deadlineOf('bad', 3)).toBe('');
  });

  it('ouverture et scratch suggérés depuis le début', () => {
    expect(suggestSchedule('10:00')).toEqual({ openTime: '09:15', scratchTime: '09:50' });
    expect(suggestSchedule('00:20')).toEqual({ openTime: '23:35', scratchTime: '00:10' });
    expect(suggestSchedule('')).toBeNull();
    expect(suggestSchedule('25:00')).toBeNull();
  });

  it('heure à la française', () => {
    expect(frenchTime('09:15')).toBe('9h15');
    expect(frenchTime('10:00')).toBe('10h00');
  });
});

describe('roadmap : champs → variables', () => {
  it('chaque champ annonce les variables qu’il alimente', () => {
    expect(variablesOfField('venue')).toEqual(['lieu']);
    expect(variablesOfField('date')).toEqual(['date', 'date_limite', 'saison']);
    expect(variablesOfField('deadlineDays')).toEqual(['date_limite']);
    expect(variablesOfField('contactName')).toEqual(['contact']);
    expect(variablesOfField('contact2Email')).toEqual(['contact']);
  });
});

describe('roadmap : variables', () => {
  const info = {
    ...emptyInfo(),
    title: 'Open de Briva Isara',
    date: '2026-12-20',
    startTime: '10:00',
    deadlineDays: 6,
    contactName: 'A',
    contactEmail: 'a@x.fr',
    contact2Name: 'B',
  };
  const vars = roadmapVariables(info, fmt);

  it('valeurs dérivées', () => {
    expect(vars.date).toBe('D:2026-12-20');
    expect(vars.date_limite).toBe('D:2026-12-14');
    expect(vars.saison).toBe('2026-2027');
    expect(vars.debut).toBe('10h00');
    expect(vars.contact).toBe('A : a@x.fr ou B');
  });

  it('remplace les connues, signale les vides, laisse les inconnues', () => {
    expect(resolveText('Avant le {date_limite}, {lieu} {inconnue}', vars)).toBe(
      'Avant le D:2026-12-14, … {inconnue}'
    );
    const pieces = splitVariables('{titre} – {lieu}', vars);
    expect(pieces).toEqual([
      { text: 'Open de Briva Isara', variable: 'titre' },
      { text: ' – ' },
      { text: '{lieu}', variable: 'lieu', missing: true },
    ]);
  });

  it('expandVariables garde les vides', () => {
    expect(expandVariables('{debut} {lieu}', vars)).toBe('10h00 {lieu}');
  });

  it('puces et paragraphes', () => {
    expect(parseBlocks('Il comprend :\n- Masque\n• Gants\n\n* Coquille')).toEqual([
      { kind: 'para', text: 'Il comprend :' },
      { kind: 'bullet', text: 'Masque' },
      { kind: 'bullet', text: 'Gants' },
      { kind: 'bullet', text: 'Coquille' },
    ]);
  });
});

describe('roadmap : modèles et complétude', () => {
  it('modèle sabre laser : sections de la feuille Briva Isara', () => {
    const doc = createRoadmap('laser');
    expect(doc.sections.map(s => s.title)).toEqual([
      'LIEU & HORAIRES',
      'RÈGLEMENT & FORMULE',
      'RESTAURATION',
      'PAIEMENT',
      'DIRECTOIRE TECHNIQUE ET COURTOISIE',
      'CONTACT',
    ]);
    const ids = doc.sections.flatMap(s => [s.id, ...s.rows.map(r => r.id)]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(doc.info.fees).toContain('15 €');
  });

  it("l'essentiel connu est repris", () => {
    const doc = createRoadmap('fencing', { title: 'Coupe', venue: 'Gymnase' });
    expect(doc.info.title).toBe('Coupe');
    expect(doc.info.venue).toBe('Gymnase');
    expect(doc.info.deadlineDays).toBe(7);
  });

  it('complétude : champs requis, lignes vides, variables sans valeur', () => {
    const doc = createRoadmap('blank');
    const c = completeness(doc, roadmapVariables(doc.info, fmt));
    expect(c.missingInfo).toContain('title');
    expect(c.emptyRows.some(r => r.label === 'Règlement')).toBe(true);
    expect(c.missingVariables).toContain('lieu');
    expect(c.done).toBeLessThan(c.total);
  });

  it('section désactivée ignorée', () => {
    const doc = createRoadmap('blank');
    doc.sections = doc.sections.map(s => ({ ...s, enabled: false }));
    const c = completeness(doc, roadmapVariables(doc.info, fmt));
    expect(c.emptyRows).toEqual([]);
    expect(c.missingVariables).toEqual([]);
  });

  it('section de la bibliothèque : identifiants libres', () => {
    const used = ['row-1', 'row-7'];
    const s = sectionFromSeed(SUGGESTED_SECTIONS[4], 'sec-9', () => {
      const id = nextId('row', used);
      used.push(id);
      return id;
    });
    expect(s.rows.map(r => r.id)).toEqual(['row-8', 'row-9', 'row-10', 'row-11', 'row-12']);
  });

  it('moveItem borné', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(moveItem(items, 'b', -1).map(i => i.id)).toEqual(['b', 'a', 'c']);
    expect(moveItem(items, 'a', -1)).toBe(items);
  });
});

describe('roadmap : relecture', () => {
  it('aller-retour JSON', () => {
    const doc = createRoadmap('laser', { title: 'X', date: '2026-12-20' });
    expect(normalizeRoadmap(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it('rejette un autre fichier, nettoie les champs', () => {
    expect(normalizeRoadmap({ foo: 1 })).toBeNull();
    expect(normalizeRoadmap(null)).toBeNull();
    const doc = normalizeRoadmap({
      version: 1,
      preset: 'evil',
      accent: 'red',
      info: { title: 42, deadlineDays: -3 },
      logos: [{ dataUrl: 'javascript:alert(1)', width: 1, height: 1 }],
      sections: [{ title: 'A', layout: 'weird', rows: [{ label: 'L' }, 'x'] }],
    });
    expect(doc?.preset).toBe('blank');
    expect(doc?.accent).toBe('#c6e0b4');
    expect(doc?.info.title).toBe('');
    expect(doc?.info.deadlineDays).toBe(7);
    expect(doc?.logos).toEqual([]);
    expect(doc?.sections[0]).toMatchObject({ layout: 'table', enabled: true });
    expect(doc?.sections[0].rows).toEqual([{ id: 'row-1', label: 'L', value: '' }]);
  });
});
