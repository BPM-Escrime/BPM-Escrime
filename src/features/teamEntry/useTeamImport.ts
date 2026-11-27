/**
 * BPM - Escrime - Entrée en équipes : import d'un export d'inscriptions (#1211, #1118)
 * Une équipe (binôme) est un tireur de l'épreuve : l'import écrit ses membres, son niveau, son
 * HANDI, sa catégorie et son sexe avec l'inscription (docs/adr/0043). L'ajout et la modification
 * d'une équipe passent par la fiche du tireur (F4c).
 * Licensed under GPL-3.0
 */

import { useState } from 'react';
import { Fencer, FencerStatus, Gender } from '../../shared/types';
import { useTranslation } from '../../renderer/hooks/useTranslation';
import { usePlatform } from '../../renderer/platform/PlatformContext';
import type { TeamNotify } from './teamNotify';
import {
  DEFAULT_TEAM_LEVELS,
  levelLabel,
  teamMembersLabel,
} from '../../shared/domain/fencers/teamEntry';
import { rapieresTeamEntry } from '../../shared/domain/rapieres/rapieresEntry';
import { buildTeamImportTemplate, parseTeamImport } from './teamImport';
import type { TeamImportDraft } from './teamImport';

type NewFencer = Omit<Fencer, 'id' | 'createdAt' | 'updatedAt'>;

interface UseTeamImportOptions {
  competitionDate?: Date | string;
  /** Ajout groupé : addFencer en boucle n'en garde qu'un (closure sur la liste périmée) */
  bulkAddFencers: (fencers: NewFencer[]) => Promise<Fencer[]>;
  /** Notification de l'écran (toast) */
  notify: TeamNotify;
  /** Libellés des niveaux de la formule (`entry.levels`), du plus faible au plus fort */
  levels?: readonly string[];
}

export function useTeamImport({
  competitionDate,
  bulkAddFencers,
  notify,
  levels = DEFAULT_TEAM_LEVELS,
}: UseTeamImportOptions) {
  const { t } = useTranslation();
  const platform = usePlatform();
  // Codes des niveaux par défaut : libellé traduit (« Débutant »…)
  const levelText = (code: string) => t(`teamEntry.level_${code}`);
  // Fichier lu, en attente de sélection des équipes (fenêtre d'import)
  const [pendingImport, setPendingImport] = useState<{
    filename: string;
    teams: TeamImportDraft[];
    skipped: number[];
  } | null>(null);

  // Nom = nom d'équipe, prénom = noms des deux tireurs, club / région = séparations des poules
  // (#1441) ; membres, niveau, HANDI, catégorie et sexe d'équipe portés par le tireur (F4c,
  // docs/adr/0043) : l'import (CSV / XLSX) les écrit avec l'inscription
  const teamFencerFields = (team: TeamImportDraft) => ({
    lastName: team.name,
    firstName: teamMembersLabel(team.info.fencers),
    club: team.info.club ?? '',
    region: team.info.region ?? '',
    ...rapieresTeamEntry(team.info, competitionDate ? new Date(competitionDate) : new Date()),
    // Niveau lu dans les niveaux de la formule (colonne Z), pas dans les trois niveaux des rapières
    level: team.level,
  });

  const newTeamFencer = (team: TeamImportDraft) =>
    ({
      gender: Gender.MIXED,
      ...teamFencerFields(team),
      nationality: 'FRA',
      status: FencerStatus.NOT_CHECKED_IN,
    }) as NewFencer;

  // Import d'un export d'inscriptions (CSV / XLSX), une équipe par ligne (#1211)
  const handleImportTeams = async () => {
    const result = await platform.openFile({
      title: t('teamEntry.import_teams'),
      filters: [
        { name: 'CSV / Excel', extensions: ['csv', 'xlsx'] },
        { name: '*', extensions: ['*'] },
      ],
    });
    if (!result) return;
    const refDate = competitionDate ? new Date(competitionDate) : new Date();
    const { teams, skipped } = parseTeamImport(result.content || '', refDate, levels, levelText);
    if (teams.length === 0) {
      notify(t('teamEntry.import_empty'), 'error');
      return;
    }
    const filename = result.name;
    setPendingImport({ filename, teams, skipped });
  };

  // Modèle CSV attendu par l'import (mêmes colonnes que l'export d'inscriptions)
  const handleDownloadTemplate = async () => {
    await platform.saveFile({
      title: t('teamEntry.download_template'),
      suggestedName: 'modele-import-equipes.csv',
      filters: [
        { name: 'CSV', extensions: ['csv'] },
        { name: t('fencerList.all_files'), extensions: ['*'] },
      ],
      content: buildTeamImportTemplate(levelLabel(1, levels, levelText)),
      mimeType: 'text/csv;charset=utf-8',
    });
  };

  // Équipes cochées dans la fenêtre d'import : ajout groupé
  const confirmImport = async (teams: TeamImportDraft[]) => {
    if (teams.length === 0) return;
    const added = await bulkAddFencers(teams.map(newTeamFencer));
    notify(t('teamEntry.import_done', { n: String(added.length) }), 'success');
  };

  return {
    teamFencerFields,
    handleImportTeams,
    handleDownloadTemplate,
    /** Boutons d'import et de modèle de la liste des appels (props de FencerList) */
    importButtons: {
      customImport: { label: t('teamEntry.import_teams'), onClick: handleImportTeams },
      customImportTemplate: {
        label: t('teamEntry.download_template'),
        onClick: handleDownloadTemplate,
      },
    },
    /** Props de la fenêtre de sélection (null = fermée) */
    teamImportModal: pendingImport && {
      ...pendingImport,
      levels,
      onImport: confirmImport,
      onClose: () => setPendingImport(null),
    },
  };
}
