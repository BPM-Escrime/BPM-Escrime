# ADR-0032 — Les membres du Mode Club ont un surnom

- **Statut** : Acceptée (2026-11-25)
- **Date** : 2026-11-25
- **Tickets** : Mode Club #1872 ; complète [ADR-0022](0022-fonctions-du-poste-contrat.md), soumise à [ADR-0011](0011-migrations-schema-3-0.md)

## Contexte

Dans un club, les tireurs se connaissent souvent par un surnom. La fiche d'un membre n'a que
nom, prénom et licence ; `club_members` n'a aucune colonne pour le surnom.

## Décision

- **Migration 52** : colonne nullable `club_members.nickname TEXT`. `NULL` : pas de surnom.
- `ClubMember.nickname` (optionnel) ; le champ `nickname` s'ajoute aux entrées de
  `registerClubMember` / `updateClubMember` (contrat, MCP), 100 caractères au plus. Une chaîne
  vide efface le surnom. Pas de nouvelle opération.
- Affichage : fiche du membre (création, correction), colonne de la liste des membres,
  recherche. Le surnom ne remplace pas le nom ailleurs (tablettes, classements, PDF).
- Sauvegardes `.bpclub` et synchronisation : copie générique des colonnes ; une sauvegarde
  plus ancienne se restaure sans surnom. Purge RGPD : la ligne part avec le membre.

## Conséquences

- Les membres existants n'ont pas de surnom.
- L'affichage du surnom sur les tablettes ou les écrans reste possible plus tard, sans schéma.

## Alternatives écartées

- **Surnom dans `notes`** : non structuré, ni affichable ni cherchable proprement.
