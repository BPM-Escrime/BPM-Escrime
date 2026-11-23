# ADR-0028 — Les cartons des épreuves par équipes passent par le moteur

- **Statut** : Acceptée (2026-11-23), questions tranchées par les règlements (§ « Questions tranchées »)
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
  l'écran comme la tablette enregistrent le type choisi. Rouge et noir E sont manuels, sans
  effet en points dans le code ; aucun règlement ne les définit (Livret 2 XII : compétition par
  équipe « A venir »).
- Carton noir : la tablette refuse le noir E si `settings.blackCardEnabled` n'est pas vrai ;
  l'écran le propose toujours. Un noir individuel issu de l'escalade passe partout.
- Les `CardGroup` / `CardReason` de Sabre Laser (groupes de pénalités du règlement FFE 2025-2026)
  servent à toutes les armes (`WEAPON_CARD_CONFIGS`), escalade et points compris : c'est une
  erreur pour l'escrime olympique (#2207), et le barème du Sabre Laser n'a pas de source dans les
  règlements 2026-2027 (#2208, #2209). Voir « Deux règlements, deux barèmes ».

**Deux règlements, deux barèmes** (amendement du 2026-11-23). Les cartons des épreuves par
équipes relèvent de deux règlements distincts, qui ne se déduisent pas l'un de l'autre :

|                                   | Escrime olympique (épée, fleuret, sabre)                                                      | Sabre Laser                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Règlement                         | FIE, règlement technique et règles d'organisation (déc. 2025) ; FFE, règlement de l'arbitrage | ASL-FFE, Livrets 0, 1, 2 (2026-2027)                                                                   |
| Format par équipes                | Relais FIE (o.99, t.41)                                                                       | Relais ou arène : **aucune règle fédérale** (Livret 2 XII « A venir ») ; conventions du logiciel       |
| Jaune                             | Avertissement, 0 touche (t.162.1)                                                             | Points à l'adversaire : **barème à arbitrer** (#2208)                                                  |
| Rouge                             | Une touche à l'adversaire (t.162.2)                                                           | Points à l'adversaire : **barème à arbitrer** (#2208)                                                  |
| Blanc                             | N'existe pas                                                                                  | Existe (ex. matériel non conforme, Livret 2 V.3.2)                                                     |
| Escalade par groupe               | t.165 à t.169                                                                                 | Non précisée en 2026-2027, sauf fautes particulières (V.3.2) ; à arbitrer (#2208, #2209)               |
| Noir                              | Exclusion ; en équipe, rencontre perdue et équipe exclue (o.99.7.b)                           | Exclusion, points des adversaires conservés (VIII.7) ; en équipe : aucune règle                        |
| Cartons P (non-combativité)       | t.124                                                                                         | Absents des livrets 2026-2027 (l'anti-jeu y est une faute du 1er groupe)                               |
| Dépassement du palier d'un relais | Une touche, avec une pénalisation simultanée (t.41.1)                                         | Points : dernière touche en cible C (Livret 2 VIII.1, par analogie) ; touches : convention du logiciel |

Le domaine (lot D) porte **une configuration par règlement** ; aucune valeur, aucune escalade
ni aucun article ne passe d'une colonne à l'autre. Les règles FIE citées plus bas (§ 3, § 4,
§ 5 bis, questions 1 et 2) valent pour le relais FIE des armes olympiques. Pour le Sabre Laser,
ces sections s'appliquent une fois le barème et l'escalade tranchés (#2208, #2209) ; d'ici là,
le moteur enregistre le carton (type, motif, groupe) sans calculer de points.

**Cartons individuels hors équipes, pour comparaison** : ils ne sont pas non plus des faits du
journal. Le contrat ne les lit que (`getMatchCards`, `getCardsByMatchIds`, droit `cards:read`,
[ADR-0005](0005-journal-un-fait-un-chemin.md) étape 2). Ils s'écrivent par `ctx.db.saveCard`
après la fin d'un match de tablette (`matchFinish.ts:307`, motif `unknown`, groupe 1, 0 point) et
par `replaceSimulatedMatchEvents` (commande sans journal). Le carton noir passe, lui, par
`withdrawFencer` (`blackCard: true`, `FencerWithdrawn`, [ADR-0016](0016-retrait-reintegration-tireur.md)).
Il n'y a donc pas de modèle à suivre : cette ADR fixe la forme, que les cartons individuels
reprendront par une ADR à part.

**Sources réglementaires** (relues pour trancher les questions) :

- FIE, Règlement technique (décembre 2025) :
  - t.159 : les sanctions sont cumulables et valables pour le match (en équipes, la rencontre),
    sauf le carton noir, exclusion de l'épreuve ;
  - t.160 : l'équipe exclue à cause d'un carton noir d'un de ses membres n'est pas suspendue,
    seul le tireur l'est ;
  - t.162.2 : le carton rouge ajoute une touche au score de l'adversaire ; si c'est la dernière
    touche, le match est perdu ;
  - t.163 : tout carton, **et son groupe**, est porté sur la feuille de match, de poule ou de
    rencontre ;
  - t.41.1 : un relais peut finir au-delà de 5, 10, 15… quand une dernière touche valable et une
    touche de pénalisation arrivent ensemble ; les deux comptent ;
  - t.124 (non-combativité) : en équipes, cartons P donnés **aux deux équipes** (jaune P, puis
    rouge P) ; au troisième constat, carton noir P à l'équipe au score inférieur, ou à égalité à
    celle au moins bon classement initial ; l'autre gagne la rencontre. Les cartons P valent pour
    la rencontre (9 relais), ne se transfèrent pas ; l'équipe battue par un noir P est classée
    comme ayant perdu la rencontre ;
  - t.164, t.172 à t.174 : toute sanction relève de l'arbitre, le Directoire technique peut
    intervenir d'office ; une réclamation contre une application contraire au règlement est
    recevable.
- FIE, Règles d'organisation (décembre 2025), o.99 (formule équipes-relais) :
  - o.99.5 : remplacement à la demande du capitaine, après la fin d'un relais du tireur remplacé ;
  - o.99.7.a : tireur et remplaçant contraints à l'abandon, équipe incomplète : rencontre perdue,
    l'équipe se retire, **garde sa place** au classement ;
  - o.99.7.b : **tireur exclu lors d'une rencontre par équipes : son équipe a perdu la rencontre et
    l'équipe est exclue de la compétition sans classement final** ;
  - o.99.8 : une équipe qui ne termine pas l'épreuve suit les règles individuelles (o.74, o.79),
    l'équipe étant un seul concurrent.
- FFE, Règlement de l'arbitrage 2026-2027, 4.3 : rapport de carton noir (annexe 14) envoyé à la
  FFE sous 48 h avec la feuille ; à partir de M15, le noir P à égalité vise le moins bon
  classement initial **dans le tableau en cours**.
- FFE Sabre Laser, Livret 0 (organisation 2026-2027) : le dossier de résultats joint le rapport
  de carton noir.
- FFE Sabre Laser, Livret 2 (combat sportif 2026-2027, relu le 2026-11-23) :
  - XII « Compétition par équipe » : **« A venir. »** Aucune règle fédérale ne fixe la rencontre
    par équipes ni le carton E (désignation tardive) : ce sont des conventions du logiciel ;
  - carton noir (faute du 4e groupe, par exemple refus d'un défi) : « exclu de la compétition et
    donc du classement général », les points acquis par ses adversaires sont conservés (VIII.7) ;
    aucune disposition ne permet de désactiver le carton noir ;
  - combats en 15 points (3 min), score pouvant atteindre 19, et un carton donnant des points à
    l'adversaire peut le faire gagner (III, VIII.1, IX.1) ; en mort subite, les points de
    pénalité comptent et un carton qui fait dépasser 15 termine le combat (VII.4).
- Protocole Cyrano 1.1 : l'appareil envoie par tireur des **compteurs** (jaune 0-1, rouge 0-9,
  carton P 0-5), sans carton noir individuel ni motif ni groupe.

## Décision

### 1. Deux commandes, une par sorte de carton

Verbe + objet ([ADR-0008](0008-nommage-contrat.md)), droit `score:write`, outils MCP du même
nom en snake_case :

| Commande        | Entrée                                                                                                          | Règle                                                                                                                                                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `giveTeamCard`  | `{ competitionId, matchId, teamId, type?, dryRun?, expectedRevision?, commandId? }`                             | Arène Sabre Laser seulement. `type` absent : celui de `determineTeamCardEscalation`. Noir toujours accepté (§ Questions, 4). L'équipe doit être de la rencontre. Motif fixe `late_designation`                          |
| `giveRelayCard` | `{ competitionId, matchId, relayId, side: 'A' \| 'B', reason?, type?, dryRun?, expectedRevision?, commandId? }` | Exactement un de `reason` (écran, tablette, MCP : type calculé par l'escalade sur la rencontre) ou `type` (appareil de piste, qui n'a pas de motif). Le tireur est celui du côté dans le relais. Rencontre non terminée |

Recommandation : **deux commandes** plutôt qu'une `giveCard` à cible variable. Les entrées, les
règles et les sorties diffèrent ; une commande à deux formes rendrait sa sortie non stricte et
l'outil MCP ambigu (même argument que l'ADR-0024 contre `recordScore` pour les relais).
`side` plutôt que `fencerId` : c'est ce que donnent la tablette et l'appareil, et le moteur
résout le tireur (remplaçant compris) sans faire confiance au client.

**Annulation** : `cancelTeamCard` / `cancelRelayCard` (`TeamCardCancelled` /
`RelayCardCancelled`), écran et MCP seulement : c'est la décision du Directoire technique sur
réclamation ou d'office (t.164, t.172). Ni la tablette ni l'appareil n'annulent. Le noir
individuel ne s'annule pas ainsi (§ 4).

### 2. La règle dans le domaine, pure

- `src/shared/domain/penalties/cards.ts` reçoit `determineCardType` et les tables de
  `cardSystem.ts`, **séparées par règlement** : FIE pour les armes olympiques (motifs t.170,
  escalade t.165 à t.169, jaune sans touche, pas de blanc ; #2207), ASL-FFE pour le Sabre Laser
  (barème et escalade arbitrés dans #2208 et #2209). `createCard` y devient
  `buildCard({ id, at, … })` : identifiant et heure injectés. `cardSystem.ts` réexporte le temps
  de la migration des appelants.
- `src/shared/domain/teams/teamCards.ts` : `relayCardFor(rencontre, côté, relais, motif |
type, cartons de la rencontre, arme)` et `teamCardFor(rencontre, équipe, type?,
cartons)`. Elles rendent le carton ou un code de refus. `teamCardEscalation.ts` y est
  absorbé.
- `newDeviceCards(enregistrés, montrés)` : cartons montrés par l'appareil et pas encore
  enregistrés (compte par type, même fusion que `fencerMeetingCards`).

### 3. Effet sur le score : aucun effet automatique

Recommandation, pour les deux règlements : le carton **n'écrit pas** de touche ni de point. Le score du relais reste le fait de
`recordRelayScore`, et il contient déjà la touche de pénalité, comptée par l'arbitre sur la
tablette ou par l'appareil. Ajouter la touche à la commande du carton la compterait deux fois.
`pointsAwarded` reste calculé par le domaine et affiché (feuille, tablette). C'est aussi le
comportement des cartons individuels hors équipes.

Option écartée : la touche du rouge ajoutée au score en direct de l'arène par la commande. Elle
demande que l'appareil et la tablette cessent de la compter, ce qui touche les protocoles Cyrano
et OPP2.

Escrime olympique, conséquence de t.41.1 et t.162.2 : `recordRelayScore` accepte un relais au-delà de son palier
d'autant de touches que de cartons rouges donnés dans ce relais (aujourd'hui `score_above_max`),
et une rencontre gagnée par une touche de pénalisation.

### 4. Carton noir

- **Noir individuel** (`giveRelayCard` dont le type rendu est noir) : dans **la même
  transaction**, le moteur applique le retrait de l'[ADR-0016](0016-retrait-reintegration-tireur.md)
  (`reason: 'exclusion'`, `blackCard: true`, `matchId` de la rencontre), avec les règles
  équipes de l'ADR-0024 §3 : statut et motif posés, `FencerWithdrawn` avec
  `forfeitedMatchIds: []`, aucun relais touché. Les deux événements partagent le `commandId`. Le
  client n'enchaîne pas deux commandes (même raison que `specialStatus` dans l'ADR-0016).
- **L'équipe est exclue** (o.99.7.b), dans la même transaction : la rencontre est décidée pour
  l'adversaire (`TeamMatchDecided`, quel que soit le score), puis `TeamWithdrawn { teamId,
matchId, reason: 'exclusion' }`. Pas de remplacement : l'équipe ne tire plus. Ses rencontres
  restantes suivent o.99.8 et les règles individuelles (o.74.3, o.79.2) : résultats de poule
  annulés, rayée du tableau, classée « Exclue » sans rang. L'équipe n'est pas suspendue (t.160).
- **Abandon sans remplaçant** (o.99.7.a) : nouvelle commande `withdrawTeam { teamId, matchId,
reason: 'abandon' }`, même événement `TeamWithdrawn`. La rencontre est perdue, l'équipe se
  retire et **garde sa place** (« N'a pas terminé »).
- **Noir P** (t.124) : ce n'est pas une exclusion. La rencontre est décidée pour l'équipe au
  meilleur score, ou à égalité au meilleur classement initial (FFE à partir de M15 : du tableau
  en cours) ; la perdante est classée comme ayant perdu (§ 5 bis).
- **Noir E** : traçabilité, aucun effet (convention du logiciel : le Livret 2 renvoie la
  compétition par équipe à plus tard).
- Annulation d'un noir individuel : seulement par le Directoire technique, en réintégrant le
  tireur (`reinstateFencer`) et l'équipe ; le carton reste au dossier.

### 5. Rattachement

- Carton E : à la **rencontre** et à l'équipe (inchangé).
- Carton individuel : au **relais** où il est donné, et à la rencontre pour le cumul. L'escalade
  compte les cartons du tireur sur la rencontre entière, tous relais confondus.
- Un carton se donne sur le relais en cours (premier non terminé) ou sur le dernier relais
  terminé tant que le suivant n'a pas commencé (carton signalé juste après le END de
  l'appareil). Sinon `relay_out_of_order`.

### 5 bis. Cartons P (non-combativité)

Hors des deux tables actuelles, mais à traiter dans la même ADR : l'appareil les envoie déjà
(champ `P-card` de Cyrano 1.1) et la commande de fin de relais refuse aujourd'hui (NAK) le
vainqueur imposé par un noir P.

- `givePassivityCard { competitionId, matchId, dryRun?, expectedRevision?, commandId? }` : carton
  P donné **aux deux équipes** ; l'escalade (jaune P, rouge P, noir P) est celle de t.124, valable
  pour la rencontre. Le rouge P suit la règle du § 3 (touche dans le score saisi).
- Au noir P, le domaine désigne le vainqueur (score, puis classement initial) et la commande
  décide la rencontre (`TeamMatchDecided`). L'appareil qui envoie un noir P avec la fin de relais
  est accepté (ACK) au lieu d'un NAK.
- Événement `PassivityCardGiven { matchId, cardId, type }`. Stockage : `team_match_cards` avec
  `team_id` nul et `type` préfixé `p_` ; si le lot montre qu'une colonne manque, nouvelle ADR.

### 6. Journal

Événements ([ADR-0007](0007-format-evenement.md) : passé, PascalCase, identifiants et codes
seulement, aucun nom) :

- `TeamCardGiven { matchId, teamId, cardId, type }` ;
- `RelayCardGiven { matchId, relayId, fencerId, cardId, type, reason | null }` ;
- `PassivityCardGiven { matchId, cardId, type }` ;
- `TeamWithdrawn { teamId, matchId, reason: 'exclusion' | 'abandon' }` ;
- `TeamCardCancelled { matchId, cardId }`, `RelayCardCancelled { matchId, relayId, cardId }`.

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

- `team_withdrawn` (`rule`) : équipe retirée ou exclue, plus de relais ni de carton ;
- `card_not_found` (`not_found`) : carton à annuler inconnu ;

- `relay_not_found` (`not_found`) : relais inconnu dans la rencontre ;
- `team_not_in_match` (`not_found`) : équipe étrangère à la rencontre (la tablette l'accepte
  aujourd'hui) ;
- `match_finished` (`rule`) : rencontre terminée, carton refusé.

### 12. Lots

Une PR par lot, tests sur base réelle et test de rejeu. C1 à C3 sont empilés et mergés ensemble :
un fait journalisé partout ou nulle part ([ADR-0005](0005-journal-un-fait-un-chemin.md)).

| Lot | Contenu                                                                                                                                                                                                                                                  | Critère                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| D   | Domaine : `penalties/cards.ts` (escalade pure, id et heure injectés), `teams/teamCards.ts`, `newDeviceCards`. `cardSystem.ts` réexporte                                                                                                                  | Tests du domaine ; aucun `uuid` ni `new Date` dans `shared/domain` (ESLint)        |
| C1  | `giveTeamCard`, `giveRelayCard`, `cancel…Card`, `withdrawTeam` (moteur, MCP), noir individuel → retrait du tireur et exclusion de l'équipe dans la transaction, palier + rouges dans `recordRelayScore`, événements, `projectTeams`, bloc `teams`, codes | Rencontre avec cartons E, jaune, rouge et noir par les commandes, rejeu sans écart |
| C2  | Écran : `TeamManagerView` lit les cartons dans le bloc `teams` et écrit par `useBpmClient`                                                                                                                                                               | `grep electronAPI src/renderer/components/TeamManagerView.tsx` vide                |
| C3  | Tablette (`team_card`, `team_fencer_card`) et appareils (`newDeviceCards`) par `invokeCommandSync`                                                                                                                                                       | Relais FIE depuis le simulateur Cyrano et OPP2 : cartons en base après redémarrage |
| C4  | `givePassivityCard`, noir P qui décide la rencontre, appareil : P-card → commande, ACK au noir P                                                                                                                                                         | Noir P depuis le simulateur Cyrano : rencontre décidée, ACK, rejeu sans écart      |
| N   | Retrait de `createTeamMatchCard`, `createTeamBoutCard`, `getTeamMatchCards`, `getTeamBoutCards` du préload, des canaux `db:*` et de `DatabaseManager` (le moteur lit le dépôt). Cliquets abaissés                                                        | Critères ci-dessous                                                                |

**Critères d'acceptation** :

- `grep -n "electronAPI" src/renderer/components/TeamManagerView.tsx` est vide.
- `grep -rn "db:createTeamMatchCard\|db:createTeamBoutCard\|db:getTeamMatchCards\|db:getTeamBoutCards" src` est vide.
- `scripts/quality-baseline.json` : `electronApiCalls` −1, `electronApiUses` −4, `ipcChannels`
  −4, `directDbWrites` −2, verrouillés par `--update`.
- Test de rejeu relais FIE et arène Sabre Laser avec cartons :
  `compareWithState(projectCompetition(journal), état)` ne rend aucun écart.
- Un noir individuel donne `RelayCardGiven`, `FencerWithdrawn`, `TeamMatchDecided` et
  `TeamWithdrawn` sous le même `commandId` ; l'équipe sort du classement (« Exclue »).
- Un relais terminé à 6 avec un rouge dans le relais est accepté (t.41.1).
- La tablette, l'appareil (Cyrano, OPP2) et le MCP passent par les mêmes commandes (tests des
  routes et des pilotes sur base réelle).

## Questions tranchées (règlements relus le 2026-11-23)

1. **Touche du carton rouge** (escrime olympique) : elle s'ajoute au score de l'adversaire (t.162.2) et figure déjà
   dans le score que donnent la tablette et l'appareil ; le carton n'écrit pas de touche (§ 3).
   Le relais peut dépasser son palier d'autant de rouges (t.41.1).
2. **Noir individuel** (relais FIE, escrime olympique) : rencontre perdue et équipe exclue sans classement final (o.99.7.b),
   tireur seul suspendu (t.160), pas de remplacement. Abandon sans remplaçant : `withdrawTeam`,
   l'équipe garde sa place (o.99.7.a) (§ 4).
3. **Annulation** : oui, dès C1, par le Directoire technique seulement (t.164, t.172) (§ 1).
4. **Noir et `blackCardEnabled`** : aucun règlement ne permet de désactiver le carton noir
   (FIE t.167 à t.169, Livret 2 VIII.7). `blackCardEnabled` reste un réglage d'**affichage** de
   la tablette (bouton masqué contre les appuis involontaires) ; le moteur accepte toujours un
   carton noir, quelle que soit la source. Pas de code `black_card_disabled`. La tablette, qui
   refuse aujourd'hui le noir E sans ce réglage, s'aligne (#2186).
5. **Escalade E** : le Livret 2 ne règle pas la compétition par équipe (« A venir ») ; on garde
   le comportement actuel (imposée sans `type`, suggérée avec `type`), convention du logiciel à
   revoir quand la FFE publiera ces règles.
6. **Cartons de l'appareil** : enregistrés à chaque état reçu, par différence des compteurs
   Cyrano (jaune, rouge, P). Sans motif, ils n'ont pas de groupe : la feuille de rencontre les
   marque « groupe à compléter » (t.163 exige le groupe) et le Directoire technique le complète.
7. **Cartons individuels hors équipes** : ADR suivante, même forme (`giveMatchCard`,
   `MatchCardGiven`) ; t.163 vaut aussi pour eux. Elle tiendra compte d'un écart entre règlements
   pour le carton noir : en escrime, résultats de l'exclu annulés (o.74.3, o.79.2) ; au Sabre
   Laser, points de ses adversaires conservés (Livret 2 VIII.7).
8. **Épreuves en cours** : aucune règle sportive ne s'applique ; la comparaison partielle du § 10
   suffit.

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
- Le carton noir est une donnée du rapport FFE (annexe 14, 48 h) : le journal porte de quoi le
  préremplir (épreuve, personne, rencontre, source, heure) ; l'édition du rapport est un sujet à
  part.
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
