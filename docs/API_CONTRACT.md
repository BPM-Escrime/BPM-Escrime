# Contrat d'API unique (#1981)

Chaque opération est décrite **une seule fois** dans `src/shared/api/contract.ts` (schémas zod).
L'IPC Electron et les outils MCP en sont dérivés ; le WebSocket suivra (lot 3).

## Déclarer une opération

```ts
// src/shared/api/contract.ts
recordScore: command({
  description: '…',
  input: z.object({ competitionId: Id, matchId: Id, scoreA: z.number().int(), … }),
  output: z.looseObject({ dryRun: z.boolean(), kind: z.enum(['pool', 'bracket']) }),
  permission: 'score:write',
  mcp: { name: 'record_score', title: 'Saisir un score', idempotent: true },
}),
```

- `command` : écriture ; `query` : lecture ; `subscription` : flux d'événements.
- `mcp` (facultatif) : outil MCP généré. Commande → outil d'écriture (si « Autoriser l'écriture »),
  requête → outil de lecture. Schéma JSON tiré de zod ; `npm run docs:mcp` le documente.
- Implémentation : `handlers` dans `src/main/engine/api/engine.ts` (appel à `src/main/engine/commands`).

## Transports

| Transport | Fichier                             | Entrée                                                                    |
| --------- | ----------------------------------- | ------------------------------------------------------------------------- |
| IPC       | `src/main/engine/api/ipcAdapter.ts` | `api:invoke`, `api:subscribe` / `api:unsubscribe`, événements `api:event` |
| MCP       | `src/main/engine/api/mcpAdapter.ts` | `tools/call`                                                              |
| WebSocket | `src/main/engine/api/wsAdapter.ts`  | espace de noms Socket.IO `/api`, mêmes messages que l'IPC ; client `WsClient` |

WebSocket ([ADR-0020](adr/0020-transport-websocket-contrat.md)) : servi par le serveur distant de
l'épreuve, derrière l'espace « Vue DT » (cookie `bp_dt_token`). Lecture seule jusqu'à #1982 :
requêtes et abonnements `competition:read` / `cards:read` de l'épreuve du serveur ; le reste →
`permission_denied`. Données filtrées par `publicDto` (noms selon le réglage RGPD, licence et
date de naissance retirées).

Même validation partout. Erreur : `ApiError { code, message, data? }`. Les codes viennent d'un
catalogue unique, `src/shared/api/errors.ts` ([ADR-0009](adr/0009-codes-erreur.md)) : un code
absent ne compile pas (`CommandError`, `ApiError`). Un code inconnu reçu par le client devient
`internal`. Retirer ou renommer un code est un changement cassant (notes de version).

Catégories : `transport` (corriger l'appel), `not_found` (relire les identifiants), `conflict`
(relire puis renvoyer), `rule` (corriger la demande), `permission`, `internal` (panne
journalisée). Données jointes : `revision_conflict` → `{ revision, missing }`,
`command_already_applied` → `{ revision, commandId }` (`ApiErrorDataByCode`).

<!-- codes-erreur:début (généré par npm run docs:mcp, ne pas éditer) -->

| Code | Catégorie | Sens |
| --- | --- | --- |
| `invalid_input` | transport | Entrée refusée par le schéma de l’opération |
| `unknown_operation` | transport | Opération absente du contrat |
| `competition_not_found` | not_found | Épreuve introuvable |
| `fencer_not_found` | not_found | Tireur introuvable dans l’épreuve |
| `referee_not_found` | not_found | Arbitre introuvable |
| `pool_not_found` | not_found | Poule introuvable |
| `match_not_found` | not_found | Match introuvable |
| `withdrawal_not_found` | not_found | Aucun retrait à annuler pour ce tireur |
| `dir_not_found` | not_found | Dossier introuvable |
| `revision_conflict` | conflict | Révision attendue périmée : relire le journal puis renvoyer |
| `command_already_applied` | conflict | Commande déjà appliquée (même commandId) |
| `bracket_exists` | conflict | Tableau déjà construit |
| `bracket_has_scores` | conflict | Tableau déjà commencé : scores saisis |
| `pools_have_scores` | conflict | Poules déjà commencées : scores saisis |
| `next_match_played` | conflict | Un match qui suit a déjà été joué |
| `round_closed` | conflict | Tour de poules déjà clos |
| `draw_done` | conflict | Tirage déjà fait |
| `already_withdrawn` | conflict | Tireur déjà retiré |
| `referee_busy` | conflict | Arbitre déjà occupé sur ce créneau |
| `file_exists` | conflict | Fichier déjà présent |
| `score_invalid` | rule | Score non entier ou négatif |
| `score_above_max` | rule | Score au-delà du score maximal |
| `tie_at_max` | rule | Égalité au score maximal (o.17) |
| `draw_needs_winner` | rule | Égalité : vainqueur ou priorité requis |
| `draw_not_allowed` | rule | Égalité interdite (Sabre Laser) |
| `priority_not_allowed` | rule | Priorité non prévue pour cette arme |
| `winner_required` | rule | Vainqueur requis |
| `winner_contradicts_score` | rule | Vainqueur contraire au score |
| `winner_unresolved` | rule | Vainqueur impossible à déterminer |
| `correction_special_refused` | rule | Correction après tirage : pas de statut spécial |
| `match_not_ready` | rule | Match pas encore formé |
| `pools_not_complete` | rule | Poules non terminées |
| `no_pools` | rule | Aucune poule |
| `no_ranking` | rule | Aucun classement |
| `no_direct_elimination` | rule | Pas de tableau dans la formule |
| `no_final_results` | rule | Résultats finals pas encore disponibles |
| `no_referees` | rule | Aucun arbitre disponible |
| `not_enough_fencers` | rule | Pas assez de tireurs |
| `not_enough_qualifiers` | rule | Pas assez de qualifiés |
| `fencer_already_in_pool` | rule | Tireur déjà dans une poule |
| `tableau_complete` | rule | Tableau terminé |
| `invalid_composition` | rule | Composition invalide |
| `invalid_pool_count` | rule | Nombre de poules invalide |
| `invalid_pool_size` | rule | Taille de poule invalide |
| `invalid_wave` | rule | Vague invalide |
| `invalid_title` | rule | Titre invalide |
| `invalid_date` | rule | Date invalide |
| `invalid_name` | rule | Nom invalide |
| `not_in_season` | rule | Épreuve hors saison |
| `unknown_setting` | rule | Réglage inconnu |
| `invalid_settings` | rule | Réglages de formule hors bornes ou incohérents |
| `unsupported_format` | rule | Format d’épreuve non pris en charge |
| `invalid_path` | rule | Chemin invalide |
| `invalid_extension` | rule | Extension de fichier refusée |
| `path_not_allowed` | rule | Chemin hors des dossiers autorisés |
| `pdf_unavailable` | rule | Export PDF indisponible dans ce mode |
| `unavailable` | rule | Fonction indisponible dans ce mode |
| `remote_not_running` | rule | Saisie distante de l’épreuve non démarrée |
| `weak_password` | rule | Mot de passe trop court |
| `club_refused` | rule | Mode Club : demande refusée (message pour l’opérateur) |
| `permission_denied` | permission | Droit manquant pour cette opération |
| `internal` | internal | Panne interne, journalisée |
| `write_failed` | internal | Écriture impossible |

<!-- codes-erreur:fin -->

En MCP, le message devient `message (code)` dans un résultat `isError`.

## Écran

```ts
const client = useBpmClient();           // src/renderer/api/BpmClientContext.tsx
await client.call('checkIn', { competitionId, fencers: ids, present: true });
const cards = await client.query('getMatchCards', { matchId });
const off = client.subscribe('onCompetitionEvents', { competitionId }, e => …);
```

`BpmClientProvider` (monté dans `index.tsx`) fournit `IpcClient`. Hors React : `defaultBpmClient`.
Ne plus ajouter d'appel direct à `window.electronAPI` pour une opération du contrat.

## Opérations

| Opération                                                                                            | Nature                                                                                                                                                                                                                                                                                         | MCP                                               |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `checkIn`                                                                                            | commande                                                                                                                                                                                                                                                                                       | `check_in`                                        |
| `recordScore`                                                                                        | commande                                                                                                                                                                                                                                                                                       | `record_score`                                    |
| `generatePools`                                                                                      | commande — tirage par le moteur, ou composition préparée par le DT (`composition`), tour courant ; `PoolsGenerated` ([ADR-0017](adr/0017-projections-etat-epreuve.md))                                                                                                                         | `generate_pools`                                  |
| `addPoolFencer`                                                                                      | commande — tireur ajouté à une poule lancée, un match contre chacun ; `PoolFencerAdded`                                                                                                                                                                                                        | `add_pool_fencer`                                 |
| `closePoolRound`                                                                                     | commande — clôture du tour : qualifiés, éliminés, tour archivé avec son appel ; `PoolRoundClosed`                                                                                                                                                                                              | `close_pool_round`                                |
| `generateTableau`                                                                                    | commande — tableau planifié par le moteur, ou placement calculé par l'écran (`composition`) ; `TableauGenerated`                                                                                                                                                                               | `build_bracket` (nom 2.0 conservé)                |
| `launchRapieresWave` / `endRapieresWaves`                                                            | commandes — vagues des rapières lancées, arrêtées ou reprises                                                                                                                                                                                                                                  | `launch_rapieres_wave` / `end_rapieres_waves`     |
| `clearScore`                                                                                         | commande — score annulé : match de poule remis à jouer, match de tableau rouvert ; `ScoreCleared`                                                                                                                                                                                              | `clear_score`                                     |
| `assignMatches`                                                                                      | commande — arbitres et pistes des poules et des matchs (hors journal tant que les tablettes ont leur chemin)                                                                                                                                                                                   | `assign_matches`                                  |
| `adjustRanking` / `skipPools` / `clearTableau`                                                       | commandes — classement ajusté (ou recalculé), épreuve sans poules, tableau retiré                                                                                                                                                                                                              | `adjust_ranking` / `skip_pools` / `clear_tableau` |
| `setRapieresTeams`                                                                                   | commande — composition des équipes des rapières (journal : identifiants seulement)                                                                                                                                                                                                             | `set_rapieres_teams`                              |
| `createCompetition` / `updateCompetitionDetails` / `updateCompetitionSettings` / `deleteCompetition` | commandes (`competition:write`) — création sur les défauts du moteur, données sans règle, arme et réglages (clés vérifiées, arme et mode spécial figés au tirage, tablettes prévenues), suppression (saisie distante arrêtée) ; pas de journal ([ADR-0018](adr/0018-commandes-inscription.md)) | —                                                 |
| `configureDtView` / `getDtViewStatus` | commande (`competition:write`) et requête — espace « Vue DT » du serveur distant : ouvert, fermé, mot de passe (jamais renvoyé) ; codes `remote_not_running`, `weak_password` ([ADR-0020](adr/0020-transport-websocket-contrat.md)) | — |
| Mode Club : `listClubs` … `onClubSynced` (`src/shared/api/contractClub.ts`) | 77 opérations — clubs, cartes, membres, maîtres d'armes, séances, exercices, combats libres, statistiques, inventaire, tablettes du serveur d'entraînement, synchro et sauvegardes du poste. Requêtes et abonnement `club:read`, commandes `club:write` ; **jamais sur le réseau** (`WS_READ_PERMISSIONS`, test `wsClubRefusal.test.ts`), pas de journal. Refus d'un dépôt : `club_refused` (message pour l'opérateur). Hors contrat (fichiers, ADR-0021) : `importPhotos`, `exportBackup`, `importBackup`. Écran : `useClubApi` (`src/renderer/api/clubApi.ts`). [ADR-0022](adr/0022-fonctions-du-poste-contrat.md) | — |
| `includeInSeason` / `excludeFromSeason` / `resetSeason`                                              | commandes (`competition:write`) — épreuve versée au classement de saison (classement Quest calculé par le moteur), retirée, saison vidée ([ADR-0018](adr/0018-commandes-inscription.md))                                                                                                       | —                                                 |
| `registerFencers` / `updateFencerDetails` / `setFencerRankings` / `unregisterFencers`                | commandes (`fencers:write`) — inscription, identité, classement d'entrée (figé au tirage), désinscription avant le tirage ; pas de journal ([ADR-0018](adr/0018-commandes-inscription.md))                                                                                                     | —                                                 |
| `registerReferees` / `updateRefereeDetails` / `setRefereeAvailability` / `unregisterReferee`         | commandes (`referees:write`) — inscription, identité, pointage, désinscription (refusée pendant un match arbitré) ; pas de journal ([ADR-0018](adr/0018-commandes-inscription.md))                                                                                                             | —                                                 |
| `withdrawFencer`                                                                                     | commande — abandon, forfait, exclusion (carton noir) selon la phase ([ADR-0016](adr/0016-retrait-reintegration-tireur.md))                                                                                                                                                                     | `withdraw_fencer`                                 |
| `reinstateFencer`                                                                                    | commande — annule un retrait depuis l'instantané                                                                                                                                                                                                                                               | `reinstate_fencer`                                |
| `rebuildCompetitionState`                                                                            | commande de maintenance — journal rejoué, comparé à l'état, état aligné sur le journal (`dryRun` : écarts seuls) ; pas d'événement                                                                                                                                                             | `rebuild_competition_state`                       |
| `setRefereeingSettings`                                                                              | commande (`referees:write`) — réglages d'affectation, fusion côté moteur ([ADR-0014](adr/0014-affectation-arbitres-moteur-unique.md))                                                                                                                                                          | `set_refereeing_settings`                         |
| `assignReferees`                                                                                     | commande (`referees:write`) — arbitres des poules par le moteur unique                                                                                                                                                                                                                         | `assign_referees`                                 |
| `assignReferee`                                                                                      | commande (`referees:write`) — arbitre d'une poule à la main, neutralité signalée                                                                                                                                                                                                               | `assign_referee`                                  |
| `getCompetition` / `listCompetitions`                                                                | requêtes — une épreuve, ou toutes (nombre de tireurs) : identité, statut, réglages en schéma strict (`src/shared/api/competitionSchema.ts`), dates ISO 8601                                                                                                                                    | —                                                 |
| `listFencers`                                                                                        | requête — tireurs d'une épreuve, ordre des dossards, dates ISO 8601                                                                                                                                                                                                                            | —                                                 |
| `getSeasonRanking`                                                                                   | requête — classement de saison (cumul par tireur) et épreuves versées                                                                                                                                                                                                                          | —                                                 |
| `listScoreAudit` / `listRefereeComments` / `getTableauSignatures` / `getCompetitionStats` | requêtes — historique des scores, commentaires des formateurs, signatures du tableau, chiffres de l'épreuve (`src/shared/api/contractReports.ts`) | — |
| `listReferees`                                                                                       | requête — arbitres d'une épreuve (identité, club, nationalité, niveau, disponibilité) pour l'écran                                                                                                                                                                                             | —                                                 |
| `listRefereeMatches`                                                                                 | requête — matchs de poule avec leur arbitre (historique des arbitrages)                                                                                                                                                                                                                        | —                                                 |
| `getMatchTimeline` / `getCompetitionTimeline`                                                        | requêtes — journal d'un match ou de tous les matchs d'une épreuve (scores, touches, cartons, sorties d'arène)                                                                                                                                                                                  | —                                                 |
| `getPoolSignatures`                                                                                  | requête — signatures de la feuille d'une poule                                                                                                                                                                                                                                                 | —                                                 |
| `listFencerStats` / `getFencerStats`                                                                 | requêtes — statistiques des tireurs d'une épreuve, ou d'un tireur (null si absent) : touches, cartons, sorties d'arène, durées                                                                                                                                                                 | —                                                 |
| `getFencerHistory`                                                                                   | requête — matchs d'un tireur avec touches et cartons                                                                                                                                                                                                                                           | —                                                 |
| `listRefereeStats`                                                                                   | requête — statistiques des arbitres (matchs, durée, cartons, appels au DT, repos)                                                                                                                                                                                                              | —                                                 |
| `listMatchTimings` / `listRemoteEvents`                                                              | requêtes — horodatage des matchs et événements des saisies distantes (indicateurs d'organisation)                                                                                                                                                                                              | —                                                 |
| `getMatchCards`                                                                                      | requête                                                                                                                                                                                                                                                                                        | —                                                 |
| `getCardsByMatchIds`                                                                                 | requête                                                                                                                                                                                                                                                                                        | —                                                 |
| `getCompetitionEvents`                                                                               | requête                                                                                                                                                                                                                                                                                        | `get_competition_events`                          |
| `getCompetitionState`                                                                                | requête — état de l'épreuve tenu par le moteur, révision du journal ([ADR-0017](adr/0017-projections-etat-epreuve.md))                                                                                                                                                                         | —                                                 |
| `getMatchHistory`                                                                                    | requête                                                                                                                                                                                                                                                                                        | —                                                 |
| `onCompetitionEvents`                                                                                | abonnement                                                                                                                                                                                                                                                                                     | —                                                 |

Lot 2 commencé : `useCompetitionEvent` s'abonne par `onCompetitionEvents`, le choix d'arbitre
du tableau lit `listReferees`. `useMatchDbSync` n'écrit plus les matchs que pour les formats hors
moteur (tableaux séparés, équipes) : ailleurs le moteur les écrit dans la transaction de la
commande. Journal des matchs (`useMatchAuditStore`) et signatures de poule passent par le
contrat ; tests : `fakeApiBridge` (`src/renderer/testUtils/apiBridge.ts`) simule le pont.
Statistiques : `AnalyticsDashboard`, `FencerStatsTable`, `FencerDetailModal` et `analyticsService`
(stats des tireurs) lisent `listFencerStats`, `getFencerStats`, `getFencerHistory`,
`listRefereeStats`, `listMatchTimings` et `listRemoteEvents` ; `getCompetitionStats` et
`getPoolStats` (lecture brute des tables) restent sur `db.*` en attendant une requête
métier.
Code mort supprimé (`features/pools`, `features/competition`, `features/bracket` : services et
stores sans appelant). Arbitres et pistes : plus d'écriture directe en base à côté de
`assignMatches`. Tireurs (ADR-0018) : `useFencerManagement` lit `listFencers` et inscrit, modifie, classe et
désinscrit par les commandes ; le statut reste écrit directement pour les formats hors moteur.
Arbitres (ADR-0018) : `RefereeManager`, l'import d'arbitres et le choix d'arbitre d'une poule
passent par les commandes et `listReferees` / `listRefereeMatches`.
Épreuves (ADR-0018) : création, suppression, propriétés, petite finale, configuration Quest et
activation des arbitres passent par les commandes (`persistCompetitionUpdate`) ; la lecture
d'une épreuve passe par `getCompetition` / `listCompetitions` : les réglages ont un schéma zod
strict, vérifié à la compilation contre `CompetitionSettings` ; il valide aussi les réglages en
entrée (valeur invalide refusée). Seule la formule à la carte garde son type sans validation de
valeur au niveau du schéma. `validateFormulaSettings` (`src/shared/domain/formula`, ADR-0012)
juge ensuite bornes et cohérence (tours, qualifiés, tailles de poule, formule à la carte) à
chaque création et modification : refus `invalid_settings` avec le détail ; à la modification,
seuls les réglages modifiés sont jugés (épreuves 2.0 aux réglages anciens hors bornes).
Saison (ADR-0018) : `SeasonRankingView` lit `getSeasonRanking` et verse, retire ou vide par les
commandes ; le moteur calcule le classement Quest de l'épreuve versée.
Cliquet `electronApiCalls` : 112.

Lots suivants : suite de la migration de l'écran par domaine (2), `WsClient` + adaptateur WebSocket (3),
`PlatformServices` (4), pages distantes (5).

## Journal des événements par épreuve (#1980)

Table `competition_events` (migration 46, format [ADR-0007](adr/0007-format-evenement.md)) :
`event_id` (UUID, clé, stable entre postes), `command_id` (commun aux événements d'une commande),
`competition_id`, `revision` (ordre local, croissant par épreuve, unique avec l'épreuve), `type`
(fait au passé), `schema_version`, `payload` (JSON, identifiants seulement), `author`, `source`
(`screen`, `mcp`, `tablet`, `cyrano`, `opp2`, `engine`), `at`. Ajout seul
(`src/database/repos/eventLogRepo.ts`). Les tables actuelles et `session_state` restent la
lecture : le journal s'écrit **en plus**, dans la même transaction (`src/main/engine/commands/eventLog.ts`).

Types et charges : **`src/shared/api/events.ts`** (union zod `JournalEventBodySchema`, constantes
`JOURNAL_EVENT`). Le moteur n'écrit que ces types ; `getCompetitionEvents` / `getMatchHistory` rendent
des `JournalEvent` typés (`eventId`, `commandId`, `revision`, `schemaVersion`, `author`, `source`, `at`).
Faire évoluer une charge : nouvelle `schemaVersion` + nouveau membre de l'union ; un événement stocké
ne se réécrit jamais.

**Idempotence** : toute commande accepte `commandId` (choisi par l'appelant, UUID). Rejouée avec le
même identifiant (renvoi après une coupure), elle n'écrit rien et est refusée par
`command_already_applied`, `data: { revision, commandId }` — à traiter comme un succès. Sans
`commandId`, le moteur en génère un par commande.

| Commande                                       | Événements                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `checkIn`                                      | `FencerCheckedIn` / `FencerCheckedOut` (un par tireur modifié)                             |
| `recordScore` (poule)                          | `ScoreRecorded`, puis `PoolCompleted` si la poule se termine                               |
| `recordScore` (tableau)                        | `ScoreRecorded`, `TableauMatchDecided`, `TableauCompleted` en fin de tableau               |
| `recordScore` avec `specialStatus`             | en plus `FencerWithdrawn` (même `commandId`)                                               |
| `generatePools`                                | `PoolsGenerated` (tour, poules, tireurs, pistes, ordre des matchs : rejouable sans graine) |
| `addPoolFencer`                                | `PoolFencerAdded` (poule, tireur, matchs ajoutés dans l'ordre)                             |
| `closePoolRound`                               | `PoolRoundClosed` (tour, qualifiés dans l'ordre, éliminés, nombre de qualifiés)            |
| `generateTableau`                              | `TableauGenerated` (taille, petite finale, « toutes les places », placement complet)       |
| `launchRapieresWave` / `endRapieresWaves`      | `RapieresWaveLaunched` (vague, matchs) / `RapieresWavesEnded`                              |
| `clearScore`                                   | `ScoreCleared` (match, poule)                                                              |
| `adjustRanking` / `skipPools` / `clearTableau` | `RankingAdjusted` / `PoolsSkipped` / `TableauCleared`                                      |
| `withdrawFencer`                               | `FencerWithdrawn` ; au tableau, `TableauMatchDecided` (et `TableauCompleted`)              |
| `reinstateFencer`                              | `FencerReinstated`                                                                         |

- Source : `CommandContext.actor` (IPC : `screen` ; MCP : `mcp`, auteur `agent` ; défaut `engine`).
- Une commande qui écrit rend `revision` et diffuse `{ type: 'journal:appended', competitionId, revision }`
  aux abonnés `onCompetitionEvents`. `dryRun` n'écrit rien.
- `expectedRevision` (optionnel) : révision périmée → `ApiError` `revision_conflict`,
  `data: { revision, missing }` (200 événements manquants au plus ; au-delà, `getCompetitionEvents`).
  Contrôle, écritures et ajout au journal forment **une seule transaction** (`runCommand`,
  [ADR-0006](adr/0006-expected-revision.md)) : aucune écriture ne s'intercale, un refus ou une erreur
  annule tout. Une commande est donc **synchrone** (un `await` est refusé). Portée : seules les
  commandes du contrat sont détectées ; les écritures de l'écran et des tablettes qui n'y passent pas
  encore ne changent pas la révision (#1980, « un fait, un chemin »).
- Resynchronisation : `getCompetitionEvents { competitionId, since }`. Audit d'un match :
  `getMatchHistory { competitionId, matchId }`.
- Purge RGPD et archive `.bpm` : suivent `competition_id` comme les autres tables.

**Un fait, un chemin** ([ADR-0005](adr/0005-journal-un-fait-un-chemin.md)) : le pointage de l'écran
(bouton « Pointer », tout pointer / dépointer) passe uniquement par `checkIn` ; règle unique des statuts
spéciaux (`canToggleCheckIn`, `shared/domain/fencers`) ; succès affiché après la réponse. Les cartons
se lisent par `getMatchCards` / `getCardsByMatchIds`.

Scores : `recordScore` couvre tous les formats individuels (tours multiples, rapières, « toutes les
places ») ; les équipes gardent leur modèle de relais. Une seule écriture pour :

- l'écran : saisie en poule et au tableau (tableaux de classement compris) par `useRecordScore`,
  après écriture de la sauvegarde en attente ; l'écran relit la session (`session:changed`) ;
- les tablettes : fin de match (`finishArenaMatch`, fin hors arène) et feuille de poule, par
  `recordFinishedScore` (`src/main/remote/scoreCommand.ts`, `invokeCommandSync`) ; l'événement
  `match:finished` porte `recorded: true` et l'écran n'applique plus le score lui-même ;
- les appareils de piste (Cyrano, OPP2), par la même fin de match (source `cyrano`). L'ACK
  attend la commande : le score est contrôlé par `recordScore` en simulation (`checkArenaFinish`)
  et un refus (score maximal dépassé, égalité impossible…) vaut NAK, l'arbitre corrige puis
  valide à nouveau.

Journal des scores (`score_audit_log`) inchangé pour l'utilisateur : `ui`, nom de l'arbitre avec
l'adresse de la tablette, `device`, `mcp`. Le journal d'épreuve ne porte que l'identifiant de
l'arbitre (RGPD).

Restent sur le chemin historique (saisie locale de l'écran, ou écriture directe du serveur) : épreuves
par équipes, tableaux séparés après les poules, égalité sans vainqueur sur la feuille de poule, scores en cours et synchronisation hors ligne des
tablettes (`updateMatchScore`).

Retrait d'un tireur ([ADR-0016](adr/0016-retrait-reintegration-tireur.md)) : étape 1 faite, règle
unique `planWithdrawal` / `planReinstatement` (`shared/domain/fencers/withdrawal.ts`), commandes
`withdrawFencer` / `reinstateFencer`, instantané `fencer_abandons` tenu par le moteur.
Étape 2 faite : à l'écran, sortie médicale, forfait et réactivation depuis l'appel, statut changé
dans la fiche du tireur, abandon / forfait / exclusion (carton noir) d'un match de poule (par
`recordScore`, `blackCard` compris) et retrait au tableau passent par les commandes
(`useFencerWithdrawal`) ; repli local seulement hors moteur (`unsupported_format`, `unavailable`).
Étape 3 faite : carton noir de la tablette (fin de match, fin hors arène) et exclusion signalée
par l'appareil (statut E) passent par `recordScore` avec `specialStatus: 'exclusion'` et
`blackCard` (score et retrait sous une commande, contrôle avant l'ACK compris) ; abandon de
l'appareil confirmé par le DT par `withdrawFencer` ; abandon / forfait / exclusion sur la feuille
de poule par `recordScore` ; annulation du carton noir par `reinstateFencer`
(`reinstateByCommand`), le match interrompu étant rouvert par l'arène. `remote:fencer_excluded` et
`remote:fencer_reinstated` portent `recorded` : l'écran relit au lieu d'appliquer. Les trois PR
se mergent ensemble.

Projections ([ADR-0017](adr/0017-projections-etat-epreuve.md)) : étape 4a faite. L'écran lit
l'état par `getCompetitionState` et le relit quand `journal:appended` annonce une révision plus
récente que la sienne (ou sur `session:changed`, pour les écritures du moteur pas encore
journalisées) ; relectures coalescées, une seule par rafale. Étape 4b, palier « tirage » fait :
« Lancer les poules » envoie la composition préparée à `generatePools` (identifiants, pistes et
ordre des matchs conservés, tours multiples et rapières compris, vagues remises à zéro) ; le
moteur écrit tables, état et `PoolsGenerated`. La préparation (tirages, ajustements, annulation)
reste un brouillon de l'écran. Palier « composition » fait : un tireur ajouté à une poule lancée
passe par `addPoolFencer` (`PoolFencerAdded`). Palier « clôture de tour » fait : « Tour suivant »
passe par `closePoolRound` (simulation pour la confirmation, puis commande ; `PoolRoundClosed`).
Palier « tableau » fait : le tableau calculé à l'écran (`planTableau`, classement d'entrée de la
vue) part au moteur avec son placement complet (`generateTableau`, `TableauGenerated`) ; tableaux
séparés après les poules : tableau local. Palier « correction » fait : un score de poule corrigé
après le tirage passe par `recordScore` avec `correction { reason, rebuildTableau }` (motif au
journal des scores, `ScoreRecorded.correction`, tableau gardé ou retiré dans la même commande).
Palier « état d'interface » commencé : une relecture après une commande ne change plus l'onglet
affiché (seul le chargement de l'épreuve le reprend de l'état). Palier « rapières » fait : vagues
lancées, arrêtées ou reprises par `launchRapieresWave` / `endRapieresWaves` ; mode de tableau joint
à `generateTableau` (`rapieresTableauMode`, dans `TableauGenerated`). Annulation d'un score (poule
et tableau) par `clearScore` (`ScoreCleared`). Arbitres et pistes par `assignMatches`
(arbitres d'une poule, affectations de l'onglet Arbitres, piste d'une poule, pistes et arbitres
des matchs de tableau dont l'affectation automatique des pistes) ; pas encore d'événement : le
changement d'arbitre depuis une tablette a son propre chemin. Classement ajusté ou recalculé
(`adjustRanking`), poules passées (`skipPools`), tableau retiré quand le classement ou la petite
finale change et pour « Refaire le tableau » sans correction (`clearTableau`) ; résultats
déverrouillés : état d'interface du poste (le classement final reste celui du moteur). Retour arrière
et remplissage automatique du tableau traduits en commandes (`clearScore`, `recordScore`,
`assignMatches`, dans l'ordre des tours) ; arbitres du remplissage des poules par
`assignMatches` ; classement final de la Quest par `adjustRanking`. État d'interface du poste
(onglet affiché, bornes de taille de la préparation des poules, pistes de la saisie distante) :
gardé dans le navigateur par épreuve (`posteUiState`), plus dans l'état partagé ; au chargement,
l'onglet du poste est rouvert s'il ne devance pas la phase de l'épreuve. **Exception documentée**
(décision du mainteneur, 2026-11-21, révisable) : les tableaux séparés après les poules restent
écrits par l'écran, comme les épreuves par équipes ; l'étape 4c ne les couvre pas. Composition des
équipes des rapières par `setRapieresTeams` (`RapieresTeamsUpdated`, identifiants seulement :
la composition, personnelle, n'est pas rejouable). Tableaux de classement du
remplissage « toutes les places » : scores des matchs connus du moteur par commandes.

**Étape 4c faite** : l'écran n'écrit plus l'état de l'épreuve (`useCompetitionSession` ne
sauvegarde plus, ni en différé ni à la fermeture) ; seul le moteur l'écrit, l'écran le relit
(`getCompetitionState`). Exceptions documentées, où l'écran l'écrit encore : tableaux séparés
après les poules, épreuves par équipes (`persistLocally`). La préparation des poules (avant
« Lancer ») reste un brouillon de l'écran, non conservé au redémarrage.

**Étape 5 commencée** : `projectCompetition(events)` (`src/shared/domain/journal`) rejoue le
journal et rend les faits rejouables : statuts des tireurs nommés par le journal, tours de poules
(composition, ordre des matchs, résultats, clôture), tableau tiré et décisions du tableau principal
et des tableaux de classement, vague des rapières. Les dérivés (classements, tableaux de
classement, classement final) n'y sont pas. `compareWithState` liste les écarts entre ces faits et
l'état tenu par le moteur (identifiants et nombres seulement). Un journal est **complet** s'il
commence, après l'appel, par `PoolsGenerated`, `PoolsSkipped` ou `TableauGenerated` ; sinon seuls
les faits qu'il contient sont comparés. Ignorés au rejeu : `PoolCompleted`, `TableauCompleted`
(signaux), `RankingAdjusted` (dérivé), `RapieresTeamsUpdated` (composition personnelle). Les
tableaux de classement ont un identifiant déterministe, tiré de leur parent et de leur tour
(`cons-16`, `cons-16-8`) : plus d'heure dans l'identifiant. Test de rejeu
(`src/main/engine/commands/replay.test.ts`) : épreuve complète jouée par les commandes (appel,
poules, abandon, annulation, retrait et réintégration, tableau, « toutes les places », tours
multiples), journal rejoué, aucun écart.

`rebuildCompetitionState` (commande de maintenance, `src/main/engine/commands/rebuild.ts`) lit
tout le journal, le rejoue et liste les écarts. Avec `dryRun`, rien n'est écrit. Sinon l'état est
aligné sur le journal pour les faits rejouables, et seulement eux :

- statuts des tireurs (tables) ;
- scores de poule du tour courant, classements de poule et classement général recalculés ;
- décisions du tableau principal et des tableaux de classement, propagation et classement final
  recalculés ;
- vague et arrêt des rapières.

Restent dans `remaining`, sans correction : les écarts de structure (poules, tours, placement du
tableau, épreuve sans poules), les tours archivés, les abandons, forfaits et exclusions de poule
(le journal ne garde que le perdant, pas les touches), les décisions de l'état absentes du
journal. La commande n'ajoute aucun événement : elle ne crée aucun fait. L'écran relit l'état sur
le signal `session:changed`. Classement ajusté par le DT (`RankingAdjusted`) : recalculé seulement
si un score de poule est corrigé.
