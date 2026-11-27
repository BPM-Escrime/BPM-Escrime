/**
 * BPM - Escrime - Rapières : pont vers l'entrée en équipes (docs/adr/0043, F4c, F4e). Membres,
 * niveau et HANDI vivent sur le tireur ; la clé de session `rapieres.teams` d'une épreuve
 * enregistrée en mode spécial est lue en alias (`withLegacyTeams`).
 * Licensed under GPL-3.0
 */
import { Category, type Fencer, type FencerMember, type Gender } from '../../types';
import { teamCategory, teamGender } from '../fencers/teamEntry';
import type { RapieresAgeCategory, RapieresLevel, RapieresTeamInfo } from './rapieres.types';

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

/** Champs du tireur-équipe d'une composition : import des équipes, lecture de l'ancienne clé de session */
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
 * Équipes d'une épreuve enregistrée en mode spécial rapières, lues comme champs du tireur
 * (docs/adr/0043, F4e) : avant la migration 54, la composition n'était que dans l'état de session
 * (clé `rapieres.teams`, lue en alias). Les champs du tireur (membres, niveau) priment ; sans eux,
 * la composition de la session les fournit (membres, niveau, HANDI, catégorie et sexe d'équipe,
 * club et région). Aucune écriture : copies du tireur pour l'affichage.
 */
export function withLegacyTeams<T extends Fencer>(
  fencers: readonly T[],
  sessionTeams: Record<string, RapieresTeamInfo> | undefined,
  /** Date de la saison (catégorie d'équipe), injectée */
  refDate: Date
): T[] {
  // Même tableau rendu quand rien ne change : l'écran le passe à des effets qui le comparent
  if (!sessionTeams || Object.keys(sessionTeams).length === 0) return fencers as T[];
  const read = fencers.map(f => {
    const info = sessionTeams[f.id];
    if (!info || f.members?.length || f.level !== undefined) return f;
    const entry = rapieresTeamEntry(info, refDate);
    return {
      ...f,
      ...entry,
      category: f.category ?? entry.category,
      club: f.club || info.club || f.club,
      region: f.region || info.region || f.region,
    };
  });
  return read.every((f, i) => f === fencers[i]) ? (fencers as T[]) : read;
}
