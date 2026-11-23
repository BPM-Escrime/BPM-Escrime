/**
 * BellePoule Modern - Types RGPD (#1882) : droits des personnes, conservation,
 * exposition réseau, archives .bpm chiffrées.
 * Licensed under GPL-3.0
 */

/** Une personne retrouvée dans la base : ses fiches tireur et ses fiches membre */
export interface PrivacyPerson {
  /** Clé de regroupement (licence, sinon nom + prénom + date de naissance) */
  key: string;
  lastName: string;
  firstName: string;
  birthDate: string | null;
  license: string | null;
  club: string | null;
  fencers: Array<{
    fencerId: string;
    competitionId: string;
    competitionTitle: string;
    competitionDate: string | null;
  }>;
  members: Array<{ memberId: string; clubId: string | null; clubName: string }>;
}

/** Fiches visées par une action RGPD */
export interface PrivacyPersonRef {
  fencerIds?: string[];
  memberIds?: string[];
}

type Row = Record<string, unknown>;

/** Export « droit d'accès / portabilité » : lignes brutes par table */
export interface PersonalDataExport {
  format: 'bellepoule-modern/personal-data';
  version: 1;
  exportedAt: string;
  subject: { lastName: string; firstName: string; license: string | null };
  competitions: Array<{ competition: Row | null; fencer: Row; related: Record<string, Row[]> }>;
  club: Array<{ club: Row | null; member: Row; attendance: Row[]; bouts: Row[] }>;
}

export interface RetentionCandidates {
  competitions: Array<{ id: string; title: string; date: string; fencerCount: number }>;
  members: Array<{
    id: string;
    lastName: string;
    firstName: string;
    clubName: string;
    lastActivity: string;
  }>;
}

/** Affichage des noms sur le réseau (pages du serveur distant) */
export type NameMasking = 'full' | 'initial' | 'initials';

export type RetentionAction = 'anonymize' | 'delete';

export interface PrivacySettings {
  /** Noms complets, « NOM P. » ou « N. P. » sur les pages servies en Wi-Fi */
  nameMasking: NameMasking;
  /** Durée de conservation des compétitions (mois) ; 0 = illimitée */
  competitionRetentionMonths: number;
  /** Durée de conservation des membres inactifs du club (mois) ; 0 = illimitée */
  memberRetentionMonths: number;
  /** Action appliquée aux données échues */
  retentionAction: RetentionAction;
  /** Application automatique au démarrage (sinon : rappel et purge assistée) */
  autoPurge: boolean;
}

export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  nameMasking: 'full',
  competitionRetentionMonths: 0,
  memberRetentionMonths: 0,
  retentionAction: 'anonymize',
  autoPurge: false,
};

export interface RetentionPurgeResult {
  competitions: number;
  members: number;
}

/**
 * Seul avis du RGPD resté dans le préload : Fichier → Ouvrir (menu natif, ADR-0021) a choisi une
 * archive .bpm chiffrée. L'écran demande le mot de passe puis l'ouvre par le contrat
 * (openCompetitionFile, contenu + mot de passe). Export JSON d'une personne (getPersonData) et
 * archives chiffrées (getEncryptedCompetitionFile) passent par le contrat d'API.
 */
export interface PrivacyAPI {
  /** Nom du fichier et contenu base64 de l'archive chiffrée choisie par le menu */
  onEncryptedBpmRequest: (callback: (fileName: string, content: string) => void) => () => void;
}
