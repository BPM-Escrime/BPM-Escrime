import { describe, expect, it } from 'vitest';
import {
  buildTeamImportTemplate,
  parseBirthDate,
  parseDelimited,
  parseImportGender,
  parseTeamImport,
  categoryFromBirthDate,
  TEAM_IMPORT_HEADER,
} from './teamImport';

const HEADER =
  'Référence commande;Date de la commande;Statut de la commande;Nom participant;Prénom participant;' +
  'Nom payeur;Prénom payeur;Email payeur;Raison sociale;Moyen de paiement;Billet;Numéro de billet;' +
  'Tarif;Montant tarif;Code Promo;Montant code promo;date de naissance;homme/femme;nom du club;' +
  'nom du 2nd tireur;prénom du 2nd tieur;date de naissance du 2nd tireur;homme/femme 2nd tieur;' +
  "nom du club (2nd tieur);nom de l'équipe (c'est l'info la plus importante !)";

const row = (cells: Record<number, string>) =>
  Array.from({ length: 25 }, (_, i) => cells[i] ?? '').join(';');

const REF = new Date(2025, 9, 26); // saison 2025-2026

describe('teamImport (#1211)', () => {
  it('parseDelimited gère BOM, guillemets et CRLF', () => {
    expect(parseDelimited('\uFEFFa;"b;c";"d""e"\r\nf;g;h')).toEqual([
      ['a', 'b;c', 'd"e'],
      ['f', 'g', 'h'],
    ]);
  });

  it('parseBirthDate lit JJ/MM/AAAA, ISO et série Excel', () => {
    expect(parseBirthDate('06/01/1989')).toEqual(new Date(1989, 0, 6));
    expect(parseBirthDate('1989-01-06')).toEqual(new Date(1989, 0, 6));
    expect(parseBirthDate('32514')).toEqual(new Date(1989, 0, 6));
    expect(parseBirthDate('')).toBeNull();
    expect(parseBirthDate('n/a')).toBeNull();
  });

  it('catégorie selon l’âge atteint dans l’année de début de saison', () => {
    const cat = (y: number) => categoryFromBirthDate(new Date(y, 5, 1), REF);
    expect(cat(2006)).toBe('M20');
    expect(cat(2005)).toBe('SENIOR');
    expect(cat(1986)).toBe('SENIOR');
    expect(cat(1985)).toBe('V1');
    expect(cat(1975)).toBe('V2');
    expect(cat(1965)).toBe('V3');
    expect(cat(1955)).toBe('V4');
    expect(categoryFromBirthDate(null, REF)).toBe('SENIOR');
    // Janvier 2026 : toujours la saison 2025-2026
    expect(categoryFromBirthDate(new Date(2006, 0, 1), new Date(2026, 0, 10))).toBe('M20');
  });

  it('parseImportGender reconnaît homme/femme et variantes', () => {
    expect(parseImportGender('Femme')).toBe('F');
    expect(parseImportGender('féminin')).toBe('F');
    expect(parseImportGender('F')).toBe('F');
    expect(parseImportGender('Homme')).toBe('M');
    expect(parseImportGender('H')).toBe('M');
    expect(parseImportGender('masculin')).toBe('M');
    expect(parseImportGender('')).toBeUndefined();
    expect(parseImportGender('?')).toBeUndefined();
  });

  it('parseTeamImport lit le sexe en R et W', () => {
    const csv = row({ 3: 'A', 4: 'a', 17: 'Femme', 19: 'B', 20: 'b', 22: 'Homme', 24: 'T' });
    expect(parseTeamImport(csv, REF).teams[0].info.fencers.map(f => f.gender)).toEqual(['F', 'M']);
  });

  it('parseTeamImport lit D/E/Q, T/U/V et Y, ignore l’en-tête et les lignes incomplètes', () => {
    const csv = [
      HEADER,
      row({
        3: 'Dupont',
        4: 'Anne',
        16: '06/01/1989',
        19: 'Martin',
        20: 'Paul',
        21: '14/06/2008',
        24: 'Les Lames',
      }),
      row({ 3: 'Durand', 4: 'Luc', 16: '22/02/1958', 19: '', 24: 'Incomplète' }),
      row({
        3: 'Petit',
        4: 'Léa',
        16: '',
        19: 'Roux',
        20: 'Max',
        21: '27/08/1961',
        24: 'Brie; Seine',
      }),
      '',
    ].join('\r\n');
    const { teams, skipped } = parseTeamImport(csv.replace('Brie; Seine', '"Brie; Seine"'), REF);
    expect(skipped).toEqual([3]);
    expect(teams).toEqual([
      {
        name: 'Les Lames',
        info: {
          level: 'beginner',
          fencers: [
            { lastName: 'Dupont', firstName: 'Anne', category: 'SENIOR', birthDate: '1989-01-06' },
            { lastName: 'Martin', firstName: 'Paul', category: 'M20', birthDate: '2008-06-14' },
          ],
        },
        level: 1,
      },
      {
        name: 'Brie; Seine',
        info: {
          level: 'beginner',
          fencers: [
            { lastName: 'Petit', firstName: 'Léa', category: 'SENIOR' },
            { lastName: 'Roux', firstName: 'Max', category: 'V3', birthDate: '1961-08-27' },
          ],
        },
        level: 1,
      },
    ]);
  });
});

describe('teamImport : club de l’équipe (#1441)', () => {
  it('club des deux tireurs (colonnes S et X) : distincts joints par « / », identiques une seule fois', () => {
    const csv = [
      HEADER,
      row({ 3: 'A', 4: 'a', 18: 'Escrime Nord', 19: 'B', 20: 'b', 23: 'Escrime Sud', 24: 'Mix' }),
      row({ 3: 'C', 4: 'c', 18: 'Lame', 19: 'D', 20: 'd', 23: 'Lame', 24: 'Same' }),
      row({ 3: 'E', 4: 'e', 19: 'F', 20: 'f', 24: 'Sans' }),
    ].join('\r\n');
    const { teams } = parseTeamImport(csv, REF);
    expect(teams.map(t => t.info.club)).toEqual(['Escrime Nord / Escrime Sud', 'Lame', undefined]);
  });
});

describe("buildTeamImportTemplate (modèle d'import des équipes)", () => {
  it("commence par un BOM, reprend les 25 colonnes de l'export d'inscriptions, puis « niveau »", () => {
    const template = buildTeamImportTemplate();
    expect(template.charCodeAt(0)).toBe(0xfeff);
    const [header] = parseDelimited(template);
    expect(header).toHaveLength(26);
    expect(header[25]).toBe('niveau');
    expect(header).toEqual([...TEAM_IMPORT_HEADER]);
  });

  it("est relu par l'import : une équipe d'exemple, colonnes correctement placées", () => {
    const { teams, skipped } = parseTeamImport(buildTeamImportTemplate(), REF);
    expect(skipped).toEqual([]);
    expect(teams).toHaveLength(1);
    expect(teams[0].name).toBe('EXEMPLE Les Lames Rouges');
    expect(teams[0].info.fencers[0]).toMatchObject({
      lastName: 'DUPONT',
      firstName: 'Jean',
      gender: 'M',
      birthDate: '1995-03-15',
    });
    expect(teams[0].info.fencers[1]).toMatchObject({
      lastName: 'MARTIN',
      firstName: 'Marie',
      gender: 'F',
    });
    expect(teams[0].info.club).toBe('Club A / Club B');
  });

  it("un modèle sans ligne d'exemple ne produit aucune équipe", () => {
    const headerOnly = buildTeamImportTemplate().split('\r\n')[0];
    expect(parseTeamImport(headerOnly, REF).teams).toEqual([]);
  });
});

describe('niveau des équipes (colonne Z, niveaux de la formule, ADR-0043)', () => {
  const LEVELS = ['Loisir', 'Compétition', 'Élite'];
  const lvl = (level: string) =>
    row({ 3: 'A', 4: 'a', 19: 'B', 20: 'b', 24: `T-${level}` }) + `;${level}`;

  it('libellé des niveaux de la formule, sans majuscules ni accents, ou rang', () => {
    const csv = [HEADER, lvl('elite'), lvl('COMPÉTITION'), lvl('3'), lvl('Loisir')].join('\r\n');
    const { teams } = parseTeamImport(csv, REF, LEVELS);
    expect(teams.map(t => t.level)).toEqual([3, 2, 3, 1]);
  });

  it('absent, inconnu ou rang hors liste : premier niveau', () => {
    const csv = [
      HEADER,
      row({ 3: 'A', 4: 'a', 19: 'B', 20: 'b', 24: 'Sans' }),
      lvl('Pro'),
      lvl('4'),
    ].join('\r\n');
    expect(parseTeamImport(csv, REF, LEVELS).teams.map(t => t.level)).toEqual([1, 1, 1]);
  });

  it('niveaux par défaut : code ou libellé traduit', () => {
    const tr = (code: string) =>
      ({ beginner: 'Débutant', intermediate: 'Intermédiaire', expert: 'Expert' })[code] ?? code;
    const csv = [HEADER, lvl('intermediaire'), lvl('expert'), lvl('Débutant')].join('\r\n');
    expect(parseTeamImport(csv, REF, undefined, tr).teams.map(t => t.level)).toEqual([2, 3, 1]);
  });

  it('le modèle porte le premier niveau en exemple, relu par l’import', () => {
    const { teams } = parseTeamImport(buildTeamImportTemplate('Compétition'), REF, LEVELS);
    expect(teams[0].level).toBe(2);
  });
});
