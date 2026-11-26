/**
 * BPM - Escrime - Entrée en équipes (binômes) : règles du tireur-équipe (docs/adr/0043, F4c)
 * Une équipe est un tireur (nom = nom d'équipe) qui porte ses membres, son niveau et le
 * marqueur HANDI. Domaine pur : la date de saison est injectée (docs/adr/0002).
 *  - catégorie = moyenne des années de naissance des membres, arrondie au-dessus (39,5 ans →
 *    40), saison au 1ᵉʳ septembre (règle des rapières, #1441, #1864) ;
 *  - sexe = celui des membres s'il est commun, sinon mixte ;
 *  - niveau : 1 = le plus fort, indice (à partir de 1) dans les libellés de la formule.
 * Licensed under GPL-3.0
 */
import { Category, Gender, type Fencer, type FencerMember } from '../../types';
import { ageCategoryFromBirthYear } from './ageCategory';

/** Libellés de niveau par défaut, du plus fort (niveau 1) au plus faible (docs/adr/0043) */
export const DEFAULT_TEAM_LEVELS: readonly string[] = ['Expert', 'Intermédiaire', 'Débutant'];

/** Taille d'une équipe (binôme) */
export const TEAM_SIZE = 2;

/** Année de naissance d'un membre (depuis AAAA-MM-JJ), sinon undefined */
export function memberBirthYear(member: Pick<FencerMember, 'birthDate'>): number | undefined {
  const m = /^(\d{4})-\d{1,2}-\d{1,2}/.exec(member.birthDate ?? '');
  return m ? Number(m[1]) : undefined;
}

/**
 * Catégorie d'une équipe : moyenne des années de naissance connues des membres (un seul
 * membre daté suffit), âge arrondi au-dessus. Aucune date : undefined (catégorie saisie).
 */
export function teamCategory(
  members: ReadonlyArray<Pick<FencerMember, 'birthDate'>>,
  /** Date de référence (saison) : injectée, domaine pur */
  refDate: Date
): Category | undefined {
  const years = members.map(memberBirthYear).filter((y): y is number => typeof y === 'number');
  if (years.length === 0) return undefined;
  const average = years.reduce((sum, y) => sum + y, 0) / years.length;
  // Année moyenne décimale : l'âge est arrondi au-dessus, donc l'année au-dessous
  return ageCategoryFromBirthYear(Math.floor(average), refDate) as Category;
}

/**
 * Sexe d'une équipe : celui des membres s'il est commun, mixte sinon. Indéterminé
 * (undefined) si un membre n'a pas de sexe renseigné.
 */
export function teamGender(
  members: ReadonlyArray<Pick<FencerMember, 'gender'>>
): Gender | undefined {
  if (members.length === 0 || members.some(m => !m.gender)) return undefined;
  const first = members[0].gender;
  return members.every(m => m.gender === first)
    ? first === 'F'
      ? Gender.FEMALE
      : Gender.MALE
    : Gender.MIXED;
}

/** Prénom affiché de l'équipe : noms des membres, séparés par « / » */
export function teamMembersLabel(members: ReadonlyArray<Pick<FencerMember, 'lastName'>>): string {
  return members
    .map(m => m.lastName.trim().toUpperCase())
    .filter(Boolean)
    .join(' / ');
}

/** Libellé du niveau d'une équipe (1 = le plus fort), vide si inconnu ou hors des libellés */
export function levelLabel(level: number | undefined | null, levels: readonly string[]): string {
  return level && Number.isInteger(level) ? (levels[level - 1] ?? '') : '';
}

/**
 * Rang de regroupement « par niveau » (tirage des poules) : du plus faible au plus fort
 * (niveau le plus grand d'abord), comme les rapières ; sans niveau, en dernier.
 */
export function levelRankOf(fencer: Pick<Fencer, 'level'>): number {
  return fencer.level ? -fencer.level : 0;
}
