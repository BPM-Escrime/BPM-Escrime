# ADR-0028 — Les cartons des épreuves par équipes passent par le moteur

- **Statut** : Proposée
- **Date** : 2026-11-23
- **Tickets** : #2100 (suite), #1980, #1981 (épique #1978)

## Contexte

L'[ADR-0024](0024-tableaux-separes-equipes-moteur.md) fait passer toutes les écritures des épreuves
par équipes par les commandes du moteur (`contractTeams.ts`, `teams.ts`, `teamRelays.ts`,
`teamTableau.ts`, rejeu `projectTeams.ts`). Elle laisse dehors les cartons, « de la traçabilité,
sans effet sur le score », en renvoyant à « la décision qui sera prise pour les cartons
individuels ». Cette décision n'existe pas encore.

**Deux sortes de cartons d'équipe, deux tables** (migrations 15 et 19, sans ADR à l'époque) :

| Carton                                       | Table              | Rattachement                                       | Forme                                                                                                                      |
| -------------------------------------------- | ------------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Carton d'équipe « E » (arène Sabre Laser)    | `team_match_cards` | rencontre (`match_id`) et équipe (`team_id`)       | `type` blanc / jaune / rouge / noir, `reason` (toujours `late_designation`), `created_at`                                  |
| Carton individuel d'un tireur dans un relais | `team_bout_cards`  | rencontre (`match_id`), relais (`bout_id`), tireur | `card_json` : `Card` sérialisé (type, motif `CardReason`, groupe `CardGroup`, `pointsAwarded`, `resultingExclusion`, date) |

Les deux tables cascadent sur `team_matches` ; `deleteTeamPoolMatches` et `deleteTeamMatches`
(nouveau tirage, `reopenRelay` qui retire la rencontre suivante) les vident explicitement.
`privacyRepo.ts` les purge avec la personne (RGPD).

**Qui écrit, qui lit** (hors moteur, hors transaction de commande, hors journal) :

| Chemin                                             | Écriture                                                                                                                               | Lecture                                                                            |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Écran `TeamManagerView.tsx`                        | `window.electronAPI.db.createTeamMatchCard` (`handleAddTeamCard`), `createTeamBoutCard` (`handleAddCard`, mise à jour optimiste)       | `getTeamMatchCards`, `getTeamBoutCards` à chaque changement de rencontres          |
| Canaux IPC                                         | `db:createTeamMatchCard`, `db:createTeamBoutCard` (`dbHandlers.ts`, `dbApi.ts`, `preload.ts`)                                          | `db:getTeamMatchCards`, `db:getTeamBoutCards`                                      |
| Tablette `/equipe{N}/arbitre` (`teamReferee.html`) | sockets `team_card` → `ctx.db.createTeamMatchCard`, `team_fencer_card` → `ctx.db.createTeamBoutCard` (`socketHandlers.ts:368`, `:400`) | `teamArena.ts:140` et `:167` à l'ouverture de l'arène                              |
| Appareils de piste (Cyrano, OPP2)                  | **aucune** : les cartons montrés par l'appareil restent en mémoire (`TeamArenaState.deviceCards`, `teamRelayDevice.ts:134`)            | `fencerMeetingCards` fusionne appareil et tablette (le plus grand compte par type) |
| MCP                                                | aucun outil                                                                                                                            | aucun                                                                              |

Ces quatre appels sont les derniers `window.electronAPI` de `TeamManagerView` ; les deux écritures
de `socketHandlers.ts` comptent dans le cliquet `directDbWrites`.

**Règles appliquées aujourd'hui** :

- Carton individuel : `createCard` (`shared/utils/cardSystem.ts`) calcule le type depuis le motif
  et les cartons précédents **du tireur sur toute la rencontre** (écran et tablette filtrent sur
  la rencontre, pas sur le relais ; même cumul que `fencerMeetingCards`, #1829). Groupe 1 :
  blanc puis jaune ; groupe 2 : jaune puis rouge ; groupe 3 : rouge puis noir ; groupe 4 : noir.
  `pointsAwarded` (1 pour jaune ou rouge, table `scoreImpact` par arme) et `resultingExclusion`
  sont **enregistrés mais jamais appliqués** : ni touche à l'adversaire, ni retrait du tireur.
  `createCard` tire un `uuid` et lit l'horloge : la fonction n'est pas pure
  ([ADR-0002](0002-couches-et-dependances.md)) et vit encore dans `shared/utils`.
- Carton « E » : `determineTeamCardEscalation` (`shared/domain/teams/teamCardEscalation.ts`,
  pur) rend blanc pour la première désignation tardive de la rencontre, jaune ensuite (cumul sur
  les 9 assauts). Ce n'est qu'une **suggestion** surlignée à l'écran (`TeamPoolView.tsx:480`) :
  l'écran comme la tablette enregistrent le type choisi. Rouge et noir E sont manuels ; le
  règlement Sabre Laser ne leur donne aucun effet en points.
- Carton noir : la tablette refuse le noir E si `settings.blackCardEnabled` n'est pas vrai ;
  l'écran le propose toujours. Un noir individuel issu de l'escalade passe partout.
- Les `CardGroup` / `CardReason` de Sabre Laser (groupes de pénalités du règlement FFE 2025-2026)
  servent à toutes les armes (`WEAPON_CARD_CONFIGS`).

**Cartons individuels hors équipes, pour comparaison** : ils ne sont pas non plus des faits du
journal. Le contrat ne les lit que (`getMatchCards`, `getCardsByMatchIds`, droit `cards:read`,
[ADR-0005](0005-journal-un-fait-un-chemin.md) étape 2). Ils s'écrivent par `ctx.db.saveCard`
après la fin d'un match de tablette (`matchFinish.ts:307`, motif `unknown`, groupe 1, 0 point) et
par `replaceSimulatedMatchEvents` (commande sans journal). Le carton noir passe, lui, par
`withdrawFencer` (`blackCard: true`, `FencerWithdrawn`, [ADR-0016](0016-retrait-reintegration-tireur.md)).
Il n'y a donc pas de modèle à suivre : cette ADR fixe la forme, que les cartons individuels
reprendront par une ADR à part.

**Règles FIE en équipes** (à confirmer par le mainteneur, voir questions) : les cartons d'un
tireur se cumulent sur toute la rencontre ; le carton rouge donne une touche à l'adversaire, qui
compte dans le score du relais en cours ; le carton noir exclut le tireur de la compétition.

## Décision

### 1. Deux commandes, une par sorte de carton

Verbe + objet ([ADR-0008](0008-nommage-contrat.md)), droit `score:write`, outils MCP du même
nom en snake_case :

| Commande        | Entrée                                                                                                          | Règle                                                                                                                                                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `giveTeamCard`  | `{ competitionId, matchId, teamId, type?, dryRun?, expectedRevision?, commandId? }`                             | Arène Sabre Laser seulement. `type` absent : celui de `determineTeamCardEscalation`. Noir refusé sans `blackCardEnabled`. L'équipe doit être de la rencontre. Motif fixe `late_designation`                             |
| `giveRelayCard` | `{ competitionId, matchId, relayId, side: 'A' \| 'B', reason?, type?, dryRun?, expectedRevision?, commandId? }` | Exactement un de `reason` (écran, tablette, MCP : type calculé par l'escalade sur la rencontre) ou `type` (appareil de piste, qui n'a pas de motif). Le tireur est celui du côté dans le relais. Rencontre non terminée |

Recommandation : **deux commandes** plutôt qu'une `giveCard` à cible variable. Les entrées, les
règles et les sorties diffèrent ; une commande à deux formes rendrait sa sortie non stricte et
l'outil MCP ambigu (même argument que l'ADR-0024 contre `recordScore` pour les relais).
`side` plutôt que `fencerId` : c'est ce que donnent la tablette et l'appareil, et le moteur
résout le tireur (remplaçant compris) sans faire confiance au client.

**Pas de commande d'annulation** dans cette ADR : aucun client n'annule un carton aujourd'hui
(ADR-0008, « une opération n'existe que si un client en a besoin »). Si le mainteneur la veut
(question 3), elle s'appellera `cancelTeamCard` / `cancelRelayCard`, avec `TeamCardCancelled` /
`RelayCardCancelled`.

### 2. La règle dans le domaine, pure

- `src/shared/domain/penalties/cards.ts` reçoit `determineCardType` et les tables de
  `cardSystem.ts` (motif → groupe, effet par arme). `createCard` y devient
  `buildCard({ id, at, … })` : identifiant et heure injectés. `cardSystem.ts` réexporte le temps
  de la migration des appelants.
- `src/shared/domain/teams/teamCards.ts` : `relayCardFor(rencontre, côté, relais, motif |
type, cartons de la rencontre, arme)` et `teamCardFor(rencontre, équipe, type?, cartons,
blackCardEnabled)`. Elles rendent le carton ou un code de refus. `teamCardEscalation.ts` y est
  absorbé.
- `newDeviceCards(enregistrés, montrés)` : cartons montrés par l'appareil et pas encore
  enregistrés (compte par type, même fusion que `fencerMeetingCards`).

### 3. Effet sur le score : aucun effet automatique

Recommandation : le carton **n'écrit pas** de touche. Le score du relais reste le fait de
`recordRelayScore`, et il contient déjà la touche de pénalité, comptée par l'arbitre sur la
tablette ou par l'appareil. Ajouter la touche à la commande du carton la compterait deux fois.
`pointsAwarded` reste calculé par le domaine et affiché (feuille, tablette). C'est aussi le
comportement des cartons individuels hors équipes.

Option écartée pour l'instant : la touche du rouge ajoutée au score en direct de l'arène par la
commande. Elle demande que l'appareil et la tablette cessent de la compter, ce qui touche les
protocoles Cyrano et OPP2 (question 1).

### 4. Carton noir

- **Noir individuel** (`giveRelayCard` dont le type rendu est noir) : dans **la même
  transaction**, le moteur applique le retrait de l'[ADR-0016](0016-retrait-reintegration-tireur.md)
  (`reason: 'exclusion'`, `blackCard: true`, `matchId` de la rencontre), avec les règles
  équipes de l'ADR-0024 §3 : statut et motif posés, `FencerWithdrawn` avec
  `forfeitedMatchIds: []`, aucun relais touché. Les deux événements partagent le `commandId`. Le
  client n'enchaîne pas deux commandes (même raison que `specialStatus` dans l'ADR-0016).
- Le remplacement reste explicite (`substituteTeamFencer`). Sans remplaçant, rien n'est
  automatique : le forfait d'une équipe n'existe pas (ADR-0024 ; question 2).
- **Noir E** : traçabilité, aucun effet, comme le règlement.
- Annulation d'un noir individuel : `reinstateFencer`, qui existe ; le carton reste au dossier
  (question 3).

### 5. Rattachement

- Carton E : à la **rencontre** et à l'équipe (inchangé).
- Carton individuel : au **relais** où il est donné, et à la rencontre pour le cumul. L'escalade
  compte les cartons du tireur sur la rencontre entière, tous relais confondus.
- Un carton se donne sur le relais en cours (premier non terminé) ou sur le dernier relais
  terminé tant que le suivant n'a pas commencé (carton signalé juste après le END de
  l'appareil). Sinon `relay_out_of_order`.

### 6. Journal

Événements ([ADR-0007](0007-format-evenement.md) : passé, PascalCase, identifiants et codes
seulement, aucun nom) :

- `TeamCardGiven { matchId, teamId, cardId, type }` ;
- `RelayCardGiven { matchId, relayId, fencerId, cardId, type, reason | null }`.

Groupe, points et exclusion ne sont pas journalisés : ils se recalculent du motif et de l'arme.
Le motif est un code de `CardReason`, pas un texte libre.

Recommandation : **journaliser** plutôt qu'une commande sans journal (forme de
l'[ADR-0018](0018-commandes-inscription.md)) :

- le journal d'une épreuve par équipes est complet depuis `TeamPoolsGenerated` ; sans
  événement de carton, une reconstruction ou un nouveau tirage perd les cartons sans trace ;
- un carton se conteste (feuille de rencontre, rapport du carton noir) : la source
  (`screen`, `tablet`, `cyrano`, `opp2`, `mcp`) et l'heure sont celles du journal ;
- le noir individuel produit déjà `FencerWithdrawn` : le carton qui le cause doit être à côté.

Les cartons individuels hors équipes restent hors journal jusqu'à leur propre ADR ; elle
reprendra cette forme (`MatchCardGiven`).

### 7. État et rejeu

- `getCompetitionState.teams` : chaque rencontre gagne `teamCards: [{ id, teamId, type, at }]`
  et chaque relais `cards: [{ id, fencerId, type, reason, group, pointsAwarded, excludes, at }]`,
  en sortie stricte. `getTeamBoutCards` et `getTeamMatchCards` sortent du préload ; aucune
  requête séparée n'est créée.
- `projectTeams.ts` range `TeamCardGiven` et `RelayCardGiven` sous la rencontre et le relais ;
  `dropMatches` les retire avec la rencontre, comme les relais.
- `compareWithState` compare, par rencontre, les cartons (identifiant, type, équipe ou tireur,
  relais) à `teamStateView`, qui les lit dans les tables.

### 8. Tablette, appareils, MCP : les mêmes commandes

| Chemin                      | Aujourd'hui                        | Demain                                                                                                                              |
| --------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Écran, carton E             | `db.createTeamMatchCard`           | `giveTeamCard` par `useBpmClient`, succès affiché après la réponse ([ADR-0005](0005-journal-un-fait-un-chemin.md))                  |
| Écran, carton individuel    | `db.createTeamBoutCard`, optimiste | `giveRelayCard` avec `reason`                                                                                                       |
| Tablette `team_card`        | `ctx.db.createTeamMatchCard`       | `giveTeamCard` par `invokeCommandSync`, source `tablet` ; refus rendu par `team_arena_error`                                        |
| Tablette `team_fencer_card` | `ctx.db.createTeamBoutCard`        | `giveRelayCard` avec `reason`, source `tablet`                                                                                      |
| Appareil (Cyrano, OPP2)     | `deviceCards` en mémoire seulement | à chaque état reçu, `newDeviceCards` → `giveRelayCard` avec `type`, source `cyrano` / `opp2`. `deviceCards` ne sert plus qu'au DISP |
| MCP                         | rien                               | `give_team_card`, `give_relay_card` (écriture sportive)                                                                             |

Après chaque commande, l'arène relit la rencontre et diffuse `team_arena_state`, comme pour
`recordRelayScore`. Pas de changement de protocole des pages `/equipe{N}` ni de `teamRelayPiste`.

### 9. Schéma : pas de migration

Les deux tables suffisent ([ADR-0011](0011-migrations-schema-3-0.md)). Le moteur écrit
`team_bout_cards.card_json` au format `Card` actuel ; `id` et `created_at` viennent de
l'identifiant et de l'heure injectés de la commande. La source est au journal, pas en table. Si
un lot découvre un besoin de colonne, il passe par une nouvelle ADR.

### 10. Cartons déjà en base

Repris tels quels, sans événement fabriqué. Le journal d'une épreuve par équipes antérieure au
lot C1 n'a pas d'événement de carton : `compareWithState` ne compare les cartons que pour les
rencontres programmées **après** le premier événement de carton du journal, ou si la rencontre
n'a aucun carton en table (pas de faux écart sur les épreuves en cours). Les épreuves 2.0 ont un
journal incomplet de toute façon : `rebuildCompetitionState` part des tables.

### 11. Codes d'erreur

On réutilise `match_not_found`, `team_not_found`, `fencer_not_found`, `unsupported_format`
(carton E hors arène Sabre Laser, épreuve individuelle), `invalid_input` (ni ou les deux de
`reason` / `type`, type hors liste), `relay_out_of_order`.

On ajoute ([ADR-0009](0009-codes-erreur.md), dans la PR de la commande, puis `npm run docs:mcp`) :

- `relay_not_found` (`not_found`) : relais inconnu dans la rencontre ;
- `team_not_in_match` (`not_found`) : équipe étrangère à la rencontre (la tablette l'accepte
  aujourd'hui) ;
- `match_finished` (`rule`) : rencontre terminée, carton refusé ;
- `black_card_disabled` (`rule`) : carton noir désactivé sur l'épreuve.

### 12. Lots

Une PR par lot, tests sur base réelle et test de rejeu. C1 à C3 sont empilés et mergés ensemble :
un fait journalisé partout ou nulle part ([ADR-0005](0005-journal-un-fait-un-chemin.md)).

| Lot | Contenu                                                                                                                                                                                           | Critère                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| D   | Domaine : `penalties/cards.ts` (escalade pure, id et heure injectés), `teams/teamCards.ts`, `newDeviceCards`. `cardSystem.ts` réexporte                                                           | Tests du domaine ; aucun `uuid` ni `new Date` dans `shared/domain` (ESLint)        |
| C1  | `giveTeamCard`, `giveRelayCard` (moteur, MCP), noir individuel → retrait dans la transaction, événements, `projectTeams`, cartons dans `getCompetitionState.teams`, `teamStateView`, codes        | Rencontre avec cartons E, jaune, rouge et noir par les commandes, rejeu sans écart |
| C2  | Écran : `TeamManagerView` lit les cartons dans le bloc `teams` et écrit par `useBpmClient`                                                                                                        | `grep electronAPI src/renderer/components/TeamManagerView.tsx` vide                |
| C3  | Tablette (`team_card`, `team_fencer_card`) et appareils (`newDeviceCards`) par `invokeCommandSync`                                                                                                | Relais FIE depuis le simulateur Cyrano et OPP2 : cartons en base après redémarrage |
| N   | Retrait de `createTeamMatchCard`, `createTeamBoutCard`, `getTeamMatchCards`, `getTeamBoutCards` du préload, des canaux `db:*` et de `DatabaseManager` (le moteur lit le dépôt). Cliquets abaissés | Critères ci-dessous                                                                |

**Critères d'acceptation** :

- `grep -n "electronAPI" src/renderer/components/TeamManagerView.tsx` est vide.
- `grep -rn "db:createTeamMatchCard\|db:createTeamBoutCard\|db:getTeamMatchCards\|db:getTeamBoutCards" src` est vide.
- `scripts/quality-baseline.json` : `electronApiCalls` −1, `electronApiUses` −4, `ipcChannels`
  −4, `directDbWrites` −2, verrouillés par `--update`.
- Test de rejeu relais FIE et arène Sabre Laser avec cartons :
  `compareWithState(projectCompetition(journal), état)` ne rend aucun écart.
- Un noir individuel donne `RelayCardGiven` et `FencerWithdrawn` sous le même `commandId`.
- La tablette, l'appareil (Cyrano, OPP2) et le MCP passent par les mêmes commandes (tests des
  routes et des pilotes sur base réelle).

## Questions ouvertes pour le mainteneur

1. **Touche du carton rouge** : on garde « aucun effet automatique » (la touche est dans le score
   saisi) ? Ou la commande doit-elle ajouter la touche au score en direct de l'arène, ce qui
   oblige appareils et tablette à ne plus la compter ?
2. **Noir individuel sans remplaçant** : faut-il un forfait d'équipe (commande
   `forfeitTeamMatch`, événement) ou la fin de rencontre reste-t-elle saisie relais par relais ?
   Et le noir d'un tireur l'exclut-il aussi des rencontres suivantes de l'équipe (statut seul,
   ou remplacement forcé) ?
3. **Annulation d'un carton** (erreur de saisie) : `cancelTeamCard` / `cancelRelayCard` dès C1,
   ou plus tard à la demande ?
4. **Noir E à l'écran** : on applique `blackCardEnabled` partout (l'écran le propose aujourd'hui
   sans condition) ?
5. **Escalade E imposée ou suggérée** : `giveTeamCard` sans `type` prend l'escalade ; avec
   `type`, l'arbitre peut-il donner un blanc après un premier blanc (aujourd'hui oui) ?
6. **Cartons de l'appareil** : enregistrés à chaque état reçu (recommandé) ou seulement au END
   du relais ? Sans motif (`reason: null`), ils n'ont pas de groupe : acceptable pour la feuille et
   les statistiques ?
7. **Cartons individuels hors équipes** : une ADR suivante les fait passer par le même schéma
   (`giveMatchCard`, `MatchCardGiven`, fin de `saveCard` dans `matchFinish.ts`) ?
8. **Épreuves en cours** : la règle de comparaison du §10 suffit-elle, ou préfère-t-on une note
   de version et des écarts acceptés ?

## Conséquences

- Les cartons d'équipe deviennent des faits : ils survivent à une reconstruction et portent leur
  source. Le journal d'une rencontre grossit d'un événement par carton.
- Les cartons d'équipe et les cartons individuels hors équipes ont deux régimes jusqu'à la
  question 7. La documentation du contrat le dit (`getMatchCards` : cartons individuels, hors
  journal).
- Les appareils de piste écrivent des cartons : un carton montré puis retiré sur l'appareil reste
  enregistré (pas d'annulation, question 3).
- `cardSystem.ts` quitte `shared/utils` pour le domaine ; ses appelants (`TeamPoolView`,
  `teamArena.ts`, `CardModal.tsx`, ce dernier sans aucun importateur) suivent par réexport.
- `docs/API_CONTRACT.md`, `docs/MCP.md` (`npm run docs:mcp`) et `docs/TEAM_COMPETITIONS.md`
  (« sans impact automatique sur le score », tablette, appareils) suivent chaque lot.
- `TeamArenaState.fencerCards` et `cards` deviennent une copie de l'état relu après commande,
  plus une source.

## Alternatives écartées

- **Une seule commande `giveCard`** pour les deux sortes : sortie non stricte, outil MCP à deux
  formes.
- **Commandes sans journal** (comme l'inscription) : les cartons disparaissent d'une
  reconstruction, et le carton qui cause un `FencerWithdrawn` n'a pas de trace.
- **Le client enchaîne `giveRelayCard` puis `withdrawFencer`** pour un noir : deux transactions,
  un retrait oublié si la seconde échoue ; refusé pour `specialStatus` dans l'ADR-0016.
- **Cartons dans `recordRelayScore`** (liste au moment du score) : le carton se donne pendant le
  relais, pas à sa fin, et la tablette doit l'afficher tout de suite.
- **Attendre l'ADR des cartons individuels** : elle dépend du chantier `matchFinish` des
  tablettes, plus large ; les équipes, déjà passées par le moteur, gardent sinon leurs quatre
  derniers appels `window.electronAPI` et leurs deux écritures directes.
- **Requête `listTeamCards`** à côté du bloc `teams` : l'écran relirait deux sources sur le même
  signal.
