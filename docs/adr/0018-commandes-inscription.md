# ADR-0018 — Commandes d'inscription : tireurs, arbitres, épreuves, saison

- **Statut** : Acceptée (noms validés le 2026-11-22)
- **Date** : 2026-11-22
- **Tickets** : #1981 (lot 2)

## Contexte

Après les PR #2081 à #2084, l'écran appelle encore `window.electronAPI.db` pour écrire les
données d'inscription : `addFencer`, `updateFencer`, `deleteFencer`, `deleteAllFencers`,
`createReferee`, `updateReferee`, `deleteReferee`, `createCompetition`, `updateCompetition`,
`deleteCompetition`, et les épreuves de la saison. Ce sont des écritures de table, sans règle.
L'[ADR-0008](0008-nommage-contrat.md) interdit de les recopier telles quelles dans le contrat
(`updateFencer(patch)`).

## Décision

On remplace ces écritures par des commandes d'intention. Aucune n'est journalisée : ce sont des
données d'inscription, antérieures au tirage ([ADR-0017](0017-projections-etat-epreuve.md)) ;
le journal commence au tirage.

| Domaine  | Commande                                              | Règle                                                                                                                                      |
| -------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Tireurs  | `registerFencers`                                     | Une ou plusieurs inscriptions ; statut initial non pointé ou pointé seulement ; doublons (licence, ou nom et prénom) signalés, pas refusés |
|          | `updateFencerDetails`                                 | Identité, club, licence, nation, latéralité, photo. Jamais le statut, le classement ni un score                                            |
|          | `setFencerRankings`                                   | Classement d'entrée ; refusé une fois les poules tirées ou le tableau généré                                                               |
|          | `unregisterFencers`                                   | Avant le tirage seulement ; après, c'est un retrait (`withdrawFencer`, [ADR-0016](0016-retrait-reintegration-tireur.md))                   |
| Arbitres | `registerReferees`, `updateRefereeDetails`            | Identité, club, niveau                                                                                                                     |
|          | `setRefereeAvailability`                              | Pointage de l'arbitre (disponible / indisponible)                                                                                          |
|          | `unregisterReferee`                                   | Refusé s'il arbitre un match en cours                                                                                                      |
| Épreuves | `createCompetition`                                   | Réglages par défaut calculés par le moteur                                                                                                 |
|          | `updateCompetitionDetails`                            | Titre, date, lieu : données sans règle                                                                                                     |
|          | `updateCompetitionSettings`                           | Fusion validée ; réglage figé (arme, formule) refusé après le tirage                                                                       |
|          | `deleteCompetition`                                   | Le serveur distant de l'épreuve est arrêté                                                                                                 |
| Saison   | `includeInSeason`, `excludeFromSeason`, `resetSeason` | Requête `getSeasonRanking` pour la lecture                                                                                                 |

On lit les tireurs par la requête `listFencers` (dates en ISO 8601).

Les épreuves que le moteur ne pilote pas encore (tableaux séparés, épreuves par équipes : exceptions
de #1980) gardent leur chemin local pour le statut et le classement après le tirage.

## Conséquences

- Une PR par domaine, dans l'ordre du tableau. Le cliquet `electronApiCalls` baisse à chacune.
- Les outils MCP de ces commandes viendront quand un agent en aura besoin (ADR-0008).

## Alternatives écartées

- `updateFencer(patch)` dans le contrat — patch libre qui touche le statut et le classement,
  contourne les règles (ADR-0008).
- Journaliser l'inscription — le rejeu commence au tirage ; journaliser l'inscription
  alourdirait le journal sans fait rejouable de plus.
