/**
 * BPM - Escrime - Rapières : pont vers l'entrée en équipes (docs/adr/0043, F4c). Membres, niveau
 * et HANDI vivent sur le tireur ; `rapieres.teams` est lu en repli (alias, jusqu'à F4e).
 * Licensed under GPL-3.0
 */
import { Category, type Fencer, type FencerMember, type Gender } from '../../types';
import { teamCategory, teamGender } from '../fencers/teamEntry';
import type {
  RapieresAgeCategory,
  RapieresFencer,
  RapieresLevel,
  RapieresTeamInfo,
} from './rapieres.types';

/** Niveaux des rapières = liste par défaut de la formule (du plus faible au plus fort) */
const LEVEL_NUMBER: Record<RapieresLevel, number> = { beginner: 1, intermediate: 2, expert: 3 };

export const rapieresLevelNumber = (level: RapieresLevel): number => LEVEL_NUMBER[level];

export const rapieresLevelOfNumber = (level: number): RapieresLevel =>
  level <= 1 ? 'beginner' : level === 2 ? 'intermediate' : 'expert';

/** Catégorie saisie (M20, SENIOR, V1…) → catégorie du tireur ; HANDI n'est plus une catégorie */
const LEGACY_CATEGORY: Partial<Record<RapieresAgeCategory, Category>> = {
  M20: Category.U20,
  SENIOR: Category.SENIOR,
  V1: Category.V1,
  V2: Category.V2,
  V3: Category.V3,
  V4: Category.V4,
};

/** Date « AAAA-M-J » ou « AAAA-MM-JJ » → AAAA-MM-JJ, sinon undefined */
function isoDay(v: string | undefined): string | undefined {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v ?? '');
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : undefined;
}

/** Champs du tireur-équipe écrits pour une composition (alias de setRapieresTeams) */
export function rapieresTeamEntry(
  info: RapieresTeamInfo,
  refDate: Date
): { members: FencerMember[]; level: number; handicap: boolean } & Partial<
  Pick<Fencer, 'category' | 'gender'>
> {
  const members: FencerMember[] = info.fencers
    .filter(f => f.lastName.trim() || f.firstName.trim())
    .map(f => {
      const birthDate = isoDay(f.birthDate);
      return {
        lastName: f.lastName,
        firstName: f.firstName,
        ...(f.gender ? { gender: f.gender } : {}),
        ...(birthDate ? { birthDate } : {}),
      };
    });
  const typed = info.fencers.find(f => f.category !== 'HANDI')?.category;
  const category = teamCategory(members, refDate) ?? (typed && LEGACY_CATEGORY[typed]);
  const gender: Gender | undefined = teamGender(members);
  return {
    members,
    level: rapieresLevelNumber(info.level),
    handicap: info.fencers.some(f => f.category === 'HANDI'),
    ...(category ? { category } : {}),
    ...(gender ? { gender } : {}),
  };
}

/**
 * Composition vue par le mode rapières : champs du tireur de préférence, sinon `rapieres.teams`
 * (`fallback`) ; undefined si aucune des deux.
 */
export function rapieresInfoOf(
  fencer: Pick<Fencer, 'members' | 'level' | 'handicap' | 'club' | 'region'>,
  fallback?: RapieresTeamInfo
): RapieresTeamInfo | undefined {
  if (!fencer.members?.length && fencer.level === undefined) return fallback;
  const member = (i: number): RapieresFencer => {
    const m = fencer.members?.[i];
    const category = fallback?.fencers[i]?.category ?? 'SENIOR';
    return {
      lastName: m?.lastName ?? '',
      firstName: m?.firstName ?? '',
      category: i === 0 && fencer.handicap ? 'HANDI' : category === 'HANDI' ? 'SENIOR' : category,
      ...(m?.gender ? { gender: m.gender } : {}),
      ...(m?.birthDate ? { birthDate: m.birthDate } : {}),
    };
  };
  const club = fencer.club || fallback?.club;
  const region = fencer.region || fallback?.region;
  return {
    level:
      fencer.level !== undefined
        ? rapieresLevelOfNumber(fencer.level)
        : (fallback?.level ?? 'beginner'),
    fencers: [member(0), member(1)],
    ...(club ? { club } : {}),
    ...(region ? { region } : {}),
  };
}

/** Compositions par tireur : champs du tireur d'abord, `rapieres.teams` en repli */
export function rapieresTeamsOf(
  fencers: ReadonlyArray<Fencer>,
  sessionTeams: Record<string, RapieresTeamInfo>
): Record<string, RapieresTeamInfo> {
  const teams = { ...sessionTeams };
  for (const f of fencers) {
    const info = rapieresInfoOf(f, sessionTeams[f.id]);
    if (info) teams[f.id] = info;
  }
  return teams;
}
