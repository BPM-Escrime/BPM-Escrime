/**
 * BPM - Escrime - Entrée en équipes (binômes) : règles du tireur-équipe (docs/adr/0043, F4c).
 * Catégorie = moyenne des années de naissance des membres, arrondie au-dessus (39,5 ans → 40),
 * saison au 1er septembre ; sexe = celui des membres s'il est commun, sinon mixte ; niveau :
 * 1 = le plus fort. Domaine pur : date de saison injectée.
 * Licensed under GPL-3.0
 */
import { Gender, type Category, type Fencer, type FencerMember } from '../../types';
import { ageCategoryFromBirthYear } from './ageCategory';

/** Libellés de niveau par défaut, du plus fort au plus faible (stockés tels quels dans la formule) */
export const DEFAULT_TEAM_LEVELS: readonly string[] = ['Expert', 'Intermédiaire', 'Débutant'];

export const TEAM_SIZE = 2;

/** Année de naissance d'un membre (AAAA-MM-JJ), sinon undefined */
export function memberBirthYear(member: Pick<FencerMember, 'birthDate'>): number | undefined {
  const m = /^(\d{4})-\d{1,2}-\d{1,2}/.exec(member.birthDate ?? '');
  return m ? Number(m[1]) : undefined;
}

/** Catégorie d'une équipe d'après les années de naissance connues ; undefined si aucune */
export function teamCategory(
  members: ReadonlyArray<Pick<FencerMember, 'birthDate'>>,
  refDate: Date
): Category | undefined {
  const years = members.map(memberBirthYear).filter((y): y is number => typeof y === 'number');
  if (years.length === 0) return undefined;
  // Âge moyen arrondi au-dessus = année moyenne arrondie au-dessous
  const average = years.reduce((sum, y) => sum + y, 0) / years.length;
  return ageCategoryFromBirthYear(Math.floor(average), refDate) as Category;
}

/** Sexe d'une équipe ; undefined si un membre n'a pas de sexe renseigné */
export function teamGender(
  members: ReadonlyArray<Pick<FencerMember, 'gender'>>
): Gender | undefined {
  if (members.length === 0 || members.some(m => !m.gender)) return undefined;
  const first = members[0].gender;
  if (!members.every(m => m.gender === first)) return Gender.MIXED;
  return first === 'F' ? Gender.FEMALE : Gender.MALE;
}

/** Prénom affiché de l'équipe : noms des membres, séparés par « / » */
export function teamMembersLabel(members: ReadonlyArray<Pick<FencerMember, 'lastName'>>): string {
  return members
    .map(m => m.lastName.trim().toUpperCase())
    .filter(Boolean)
    .join(' / ');
}

/** Libellé d'un niveau (1 = le plus fort), vide si inconnu */
export function levelLabel(level: number | undefined | null, levels: readonly string[]): string {
  return level && Number.isInteger(level) ? (levels[level - 1] ?? '') : '';
}

/** Rang de regroupement du tirage « par niveau » : du plus faible au plus fort, sans niveau en dernier */
export function levelRankOf(fencer: Pick<Fencer, 'level'>): number {
  return fencer.level ? -fencer.level : 0;
}
