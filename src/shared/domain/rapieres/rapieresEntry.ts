/**
 * BPM - Escrime - Tournoi des rapières : pont vers l'entrée en équipes (docs/adr/0043, F4c)
 * Les membres, le niveau et le marqueur HANDI vivent sur le tireur (`Fencer.members`, `level`,
 * `handicap`) ; la clé de session `rapieres.teams` est un alias de compatibilité, lu seulement
 * quand le tireur n'a pas ces champs, jusqu'à F4e. Domaine pur : date de saison injectée.
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

/** Niveaux des rapières comme niveaux de la formule : 1 = le plus fort (docs/adr/0043) */
const LEVEL_NUMBER: Record<RapieresLevel, number> = { expert: 1, intermediate: 2, beginner: 3 };

export const rapieresLevelNumber = (level: RapieresLevel): number => LEVEL_NUMBER[level];

export const rapieresLevelOfNumber = (level: number): RapieresLevel =>
  level <= 1 ? 'expert' : level === 2 ? 'intermediate' : 'beginner';

/** Catégorie legacy (M20, SENIOR, V1…) → catégorie du tireur ; HANDI n'est plus une catégorie */
const LEGACY_CATEGORY: Partial<Record<RapieresAgeCategory, Category>> = {
  M20: Category.U20,
  SENIOR: Category.SENIOR,
  V1: Category.V1,
  V2: Category.V2,
  V3: Category.V3,
  V4: Category.V4,
};

/** Date saisie « AAAA-M-J » ou « AAAA-MM-JJ » → AAAA-MM-JJ, sinon undefined */
function isoDay(v: string | undefined): string | undefined {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v ?? '');
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : undefined;
}

/** Champs du tireur-équipe écrits pour une composition de rapières (alias de setRapieresTeams) */
export function rapieresTeamEntry(
  info: RapieresTeamInfo,
  /** Date de référence (saison) : injectée, domaine pur */
  refDate: Date
): Pick<Fencer, 'members' | 'level' | 'handicap'> &
  Partial<Pick<Fencer, 'category' | 'gender'>> & { members: FencerMember[] } {
  const members: FencerMember[] = info.fencers
    .filter(f => f.lastName.trim() || f.firstName.trim())
    .map(f => ({
      lastName: f.lastName,
      firstName: f.firstName,
      ...(f.gender ? { gender: f.gender } : {}),
      ...(isoDay(f.birthDate) ? { birthDate: isoDay(f.birthDate) } : {}),
    }));
  const category =
    teamCategory(members, refDate) ??
    LEGACY_CATEGORY[
      info.fencers.find(f => f.category && f.category !== 'HANDI')?.category ?? 'HANDI'
    ];
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
 * Composition d'une équipe vue par le mode rapières : champs du tireur de préférence (membres,
 * niveau, HANDI), sinon `rapieres.teams` (alias de compatibilité). undefined : aucune des deux.
 */
export function rapieresInfoOf(
  fencer: Pick<Fencer, 'members' | 'level' | 'handicap' | 'club' | 'region'>,
  fallback?: RapieresTeamInfo
): RapieresTeamInfo | undefined {
  if (!fencer.members?.length && fencer.level === undefined) return fallback;
  const legacy = fallback?.fencers;
  const member = (i: number): RapieresFencer => {
    const m = fencer.members?.[i];
    return m
      ? {
          lastName: m.lastName,
          firstName: m.firstName,
          category: legacy?.[i]?.category ?? 'SENIOR',
          ...(m.gender ? { gender: m.gender } : {}),
          ...(m.birthDate ? { birthDate: m.birthDate } : {}),
        }
      : { lastName: '', firstName: '', category: legacy?.[i]?.category ?? 'SENIOR' };
  };
  const fencers: [RapieresFencer, RapieresFencer] = [member(0), member(1)];
  if (fencer.handicap) fencers[0] = { ...fencers[0], category: 'HANDI' };
  else
    fencers.forEach(
      (f, i) => f.category === 'HANDI' && (fencers[i] = { ...f, category: 'SENIOR' })
    );
  const club = fencer.club || fallback?.club;
  const region = fencer.region || fallback?.region;
  return {
    level:
      fencer.level !== undefined
        ? rapieresLevelOfNumber(fencer.level)
        : (fallback?.level ?? 'beginner'),
    fencers,
    ...(club ? { club } : {}),
    ...(region ? { region } : {}),
  };
}

/** Compositions par tireur : champs du tireur d'abord, `rapieres.teams` en repli (compatibilité) */
export function rapieresTeamsOf(
  fencers: ReadonlyArray<Fencer>,
  sessionTeams: Record<string, RapieresTeamInfo>
): Record<string, RapieresTeamInfo> {
  const teams: Record<string, RapieresTeamInfo> = { ...sessionTeams };
  for (const f of fencers) {
    const info = rapieresInfoOf(f, sessionTeams[f.id]);
    if (info) teams[f.id] = info;
  }
  return teams;
}
