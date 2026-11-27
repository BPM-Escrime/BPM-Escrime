/**
 * BPM - Escrime - Brouillon de saisie d'une équipe (binôme) : champs du tireur (`members`,
 * `level`, `handicap`) ↔ chaînes du formulaire (docs/adr/0043, F4c).
 * Licensed under GPL-3.0
 */
import { Gender, type Category, type Fencer } from '../../shared/types';
import { TEAM_SIZE, teamGender, teamMembersLabel } from '../../shared/domain/fencers/teamEntry';

type DraftMember = {
  lastName: string;
  firstName: string;
  gender: '' | 'M' | 'F';
  birthDate: string;
};

/** Deux membres, niveau ('' : non précisé) et marqueur HANDI */
export interface TeamEntryDraft {
  members: DraftMember[];
  level: string;
  handicap: boolean;
}

const emptyMember = (): DraftMember => ({ lastName: '', firstName: '', gender: '', birthDate: '' });

export const emptyTeamEntryDraft = (): TeamEntryDraft => ({
  members: Array.from({ length: TEAM_SIZE }, emptyMember),
  level: '',
  handicap: false,
});

/** Brouillon d'un tireur-équipe existant */
export function teamEntryDraftOf(
  f: Pick<Fencer, 'members' | 'level' | 'handicap'>
): TeamEntryDraft {
  const draft = emptyTeamEntryDraft();
  (f.members ?? []).slice(0, TEAM_SIZE).forEach((m, i) => {
    draft.members[i] = {
      ...emptyMember(),
      ...m,
      gender: m.gender ?? '',
      birthDate: m.birthDate ?? '',
    };
  });
  return { ...draft, level: f.level ? String(f.level) : '', handicap: !!f.handicap };
}

/** Au moins un membre nommé */
export const teamEntryComplete = (draft: TeamEntryDraft): boolean =>
  draft.members.some(m => m.lastName.trim() || m.firstName.trim());

/**
 * Champs de l'équipe à écrire : membres nommés, niveau, HANDI, prénom affiché et sexe. La catégorie
 * est déduite par le moteur (moyenne des années de naissance) sauf si elle a été saisie, ou si elle
 * existe et que les dates de naissance n'ont pas changé.
 */
export function teamEntryUpdates(input: {
  draft: TeamEntryDraft;
  /** Équipe avant la saisie (modification) */
  initial?: Pick<Fencer, 'members' | 'category' | 'gender'>;
  category?: { value: string; touched: boolean };
  gender?: { value: Gender; touched: boolean };
}): Partial<Fencer> {
  const { draft, initial } = input;
  const members = draft.members
    .filter(m => m.lastName.trim() || m.firstName.trim())
    .map(m => ({
      lastName: m.lastName.trim().toUpperCase(),
      firstName: m.firstName.trim(),
      ...(m.gender ? { gender: m.gender } : {}),
      ...(m.birthDate ? { birthDate: m.birthDate } : {}),
    }));
  const births = (list: ReadonlyArray<{ birthDate?: string }>) =>
    list.map(m => m.birthDate).join('|');
  const keep = !input.category?.touched && births(initial?.members ?? []) === births(members);
  const category = input.category?.touched ? input.category.value : keep ? initial?.category : '';
  return {
    members,
    level: draft.level ? Number(draft.level) : undefined,
    handicap: draft.handicap,
    firstName: teamMembersLabel(members),
    gender: input.gender?.touched
      ? input.gender.value
      : (teamGender(members) ?? initial?.gender ?? Gender.MIXED),
    ...(category ? { category: category as Category } : {}),
  };
}
