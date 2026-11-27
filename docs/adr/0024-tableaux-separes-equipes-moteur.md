# ADR-0024 — Tableaux séparés et épreuves par équipes passent par le moteur

- **Statut** : Acceptée (2026-11-23) ; amendée le 2026-11-27 (poules, placement du tableau et ordre des relais lus dans la formule d'équipe, ADR-0044 ; validé par le mainteneur)
- **Date** : 2026-11-23
- **Tickets** : #2100, #1980, #1981 (épique #1978)

## Contexte

L'[ADR-0017](0017-projections-etat-epreuve.md) fait de `session_state` un cache écrit par le seul
moteur. Elle laisse deux formats hors de son périmètre : les **tableaux séparés après les poules**
(`settings.postPoolSplitCriteria`) et les **épreuves par équipes** (`isTeamEvent`). Pour eux,
l'écran écrit encore l'état lui-même :

```ts
// useCompetitionSessionSync.ts
const persistLocally = !!competition.settings?.postPoolSplitCriteria || !!competition.isTeamEvent;
```

| Écriture de l'écran                                                                                                                                                                                                                                                                                                                          | Fichier                                                | Format           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------- |
| Bloc `session_state` entier, 500 ms après chaque changement, et à la fermeture (`saveSessionStateSync`)                                                                                                                                                                                                                                      | `useCompetitionSession.ts`, `useCompetitionRestore.ts` | Les deux         |
| Matchs de poule (`db.updateMatch`) et de tableau (`db.upsertMultipleTableauMatches`)                                                                                                                                                                                                                                                         | `useMatchDbSync.ts`                                    | Les deux         |
| Épreuve séparée : `createCompetition`, `addFencer` par tireur, `saveSessionState`, `updateCompetition` (`splitOffCompetitionIds`), sans transaction                                                                                                                                                                                          | `useSplitGroups.ts`                                    | Tableaux séparés |
| Équipes, composition, rencontres, relais, scores, cartons (`createTeam`, `upsertTeamFencer`, `createTeamMatch`, `createTeamBout`, `updateTeamBout`…)                                                                                                                                                                                         | `TeamManagerView.tsx` (18 appels)                      | Équipes          |
| Repli « local » des commandes (`unsupported_format`) : poules (`poolPersistence.ts`, `syncPoolSnapshot` dans `AddFencerToPoolModal.tsx`), retrait (`handleFencerForfeit`, instantané `saveAbandonSnapshot` / `getAbandonSnapshot` dans `usePoolManagement.ts`), statut et motif d'exclusion par `db.updateFencer` (`useFencerManagement.ts`) | —                                                      | Les deux         |

Le moteur refuse ces formats : `generatePools` et `recordScore` (`assertSupported`,
`assertScoreSupported`, `sport.ts`) pour les équipes ; `generateTableau` avec placement,
`recordScore` au tableau (`recordBracketScore`) et `withdrawFencer` au tableau pour les tableaux
séparés.

Côté serveur distant, les équipes contournent aussi le moteur : `advanceTeamBout`
(`teamArena.ts:59`), `reopenPreviousRelay` et `substituteRelayFencer` (`teamRelayDevice.ts`)
écrivent dans `team_bouts` par `ctx.db`, hors transaction de commande et hors journal. C'est le
chemin des tablettes `/equipe{N}/arbitre` et des appareils de piste (Cyrano, OPP2,
`teamRelayPiste.ts`).

Deux défauts propres aux tableaux séparés :

- Seul le tableau du groupe affiché est enregistré (`tableauMatches`). Les autres groupes vivent en
  mémoire (`splitTableauStates`, `competitionViewState.ts`) : ils sont perdus au rechargement.
- Les identifiants de match du tableau (`32-0`, `16-3`…) sont les mêmes d'un groupe à l'autre.
  Dans la table `matches` (`id = competitionId-matchId`), le tableau d'un groupe écrase celui de
  l'autre.

Conséquences communes : deux chemins pour un même fait ([ADR-0005](0005-journal-un-fait-un-chemin.md)),
`rebuildCompetitionState` et `compareWithState` aveugles sur ces épreuves, et un cliquet
`electronApiCalls` (49 fichiers) qui ne peut pas descendre à 0.

## Décision

### 1. Tableaux séparés : un tableau par groupe, dans la même épreuve

On garde le produit actuel : poules communes, puis un tableau par groupe (aujourd'hui le sexe),
affichés en onglets dans la même épreuve. Un groupe peut toujours être extrait dans une épreuve
séparée.

**Règles** (`src/shared/domain/ranking/splitGroups.ts`, pures) :

- On y déplace `splitRankingByGender` (`poolCalculations.ts`), la part « groupe » de
  `computeEffectiveTableauRanking`, et les fonctions de `shared/utils/splitCompetition.ts`
  (`extractSplitGroupRanking`, `buildSplitCompetitionData`, `toSplitFencerData`).
- `planSplitGroups(ranking, criteria, splitOffIds)` rend les groupes restants, chacun avec ses
  tireurs dans l'ordre du classement.
- Le **partage n'est pas un fait** : c'est un dérivé du classement après poules et du groupe de
  chaque tireur. Le fait, c'est le tableau tiré pour un groupe, avec son placement complet.

**Projection** :

- `session_state` gagne `groupTableaux: Record<groupe, { tableauMatches, consolationBrackets,
finalResults }>`. Pour une épreuve à tableaux séparés, `tableauMatches`, `consolationBrackets`
  et `finalResults` à la racine restent vides.
- Les identifiants de match d'un tableau de groupe sont préfixés par le groupe (`F:32-0`). Ils sont
  uniques dans l'épreuve et dans la table `matches`, sans changer `table_id` ni le schéma.
- Une fonction de lecture, `allTableauMatches(session)`, rend les matchs de tous les tableaux. Les
  lecteurs du cache s'en servent : `sessionTableau` du moteur, résultats publics, arbitres des
  tablettes (`refereeResolver.ts`), coordonnées Cyrano (`matchCoords.ts`).
- Le groupe affiché (`activeSplitGroup`) devient une préférence de l'écran, par poste, comme
  l'onglet ([ADR-0017](0017-projections-etat-epreuve.md) §4). `splitTableauStates` disparaît.

**Commandes** :

| Commande                                     | Changement                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generateTableau`                            | Entrée `group` : exigée quand `postPoolSplitCriteria` est posé, refusée sinon (`invalid_input`). Le moteur calcule le classement du groupe ; le placement venu de l'écran (`composition`) est admis comme pour les autres formats                                                                                                                                                                                                 |
| `clearTableau`                               | Entrée `group`, même règle                                                                                                                                                                                                                                                                                                                                                                                                        |
| `recordScore`, `clearScore`, `assignMatches` | Pas de changement d'entrée : l'identifiant du match désigne son tableau                                                                                                                                                                                                                                                                                                                                                           |
| `withdrawFencer`, `reinstateFencer`          | Le refus « tableaux séparés » tombe. `planWithdrawal` s'applique au tableau du groupe du tireur                                                                                                                                                                                                                                                                                                                                   |
| **`splitOffGroup`** (nouvelle)               | `{ competitionId, group, title, dryRun?, expectedRevision?, commandId? }`. Dans **une** transaction : crée l'épreuve séparée (réglages de `buildSplitCompetitionData`), y inscrit les copies des tireurs (pointés, rang après poules), écrit sa projection de départ, puis pose `splitOffCompetitionIds` sur l'épreuve d'origine. Refus si le groupe a déjà un tableau tiré ou une épreuve séparée. Outil MCP : `split_off_group` |

**Événements** ([ADR-0007](0007-format-evenement.md), identifiants seulement) :

- `TableauGenerated`, `TableauCleared` et `TableauCompleted` gagnent un champ facultatif
  `group`, en `schemaVersion` 1. Son absence veut dire « tableau unique ». C'est le précédent de
  `rapieresTableauMode` et de `correction` : les événements déjà stockés restent valides.
- `ScoreRecorded`, `TableauMatchDecided`, `ScoreCleared`, `FencerWithdrawn` ne changent pas.
- `GroupSplitOff { group, targetCompetitionId, fencerIds }` au journal de l'épreuve d'origine.
- `SplitRankingImported { sourceCompetitionId, group, ranking: [{ fencerId, sourceFencerId, rank }] }`,
  premier fait de l'épreuve séparée. Les deux événements partagent le `commandId`.

**Rejeu** :

- `projectCompetition` rend `groupTableaux: Record<groupe, TableauFact>` à côté de `tableau`. Une
  décision de tableau est rangée dans le tableau qui contient son match.
- `compareWithState` compare chaque tableau de groupe à `groupTableaux`.
- Le journal d'une épreuve séparée est **complet** quand il commence par `SplitRankingImported`
  (même rôle que `PoolsSkipped`). Les statistiques de poule du classement importé sont des dérivés
  de l'épreuve d'origine : `rebuildCompetitionState` les relit dans sa projection, et garde les
  rangs seuls si elle a été supprimée.

### 2. Équipes : le moteur tient le relais

**Où vit l'état.** Les tables `teams`, `team_fencers`, `team_matches`, `team_bouts` restent la
projection des équipes, écrite par le seul moteur, dans la transaction de la commande
(`runCommand`). On ne recopie pas les équipes dans `session_state`. `getCompetitionState` gagne un
bloc `teams` (équipes et composition, rencontres, relais, classement de poule, tableau), en sortie
stricte, et nul pour une épreuve individuelle. L'écran relit ce bloc sur signal de journal, comme
le reste.

**Modèle de relais** (`src/shared/domain/teams/relay.ts`, pur, à partir de `teamCalculations.ts`,
`teamRelayLive.ts`, `laserArenaCalculations.ts`) :

- **Rencontre** : deux équipes, `N²` relais. Les tireurs et l'ordre des relais
  (`relayOrderFor(teamSize, weapon)` sans formule d'équipe ; sinon la règle de rencontre de la
  phase, [ADR-0044](0044-equipes-formule-v2.md)) sont fixés à la création de la rencontre, à
  partir des titulaires classés par `teamOrder`. Une rencontre créée garde son ordre. _(Amendé le
  2026-11-27 : remplace « (`relayOrderFor(teamSize, weapon)`) » ; ADR-0044.)_
- **Relais** : le fait enregistré est le score **du relais**, pas le cumul. Le cumul, le palier
  (`min(ordre × pas, cible)` en relais FIE, plafond par assaut en arène Sabre Laser) et le
  vainqueur du relais se calculent.
- **Ordre** : un relais ne s'enregistre que si les précédents sont terminés.
- **Fin de rencontre** : tous les relais terminés. Score de la rencontre = cumul des touches.
  Égalité à la fin du dernier relais : le vainqueur est donné en entrée (minute avec priorité),
  comme `winner` de `recordScore`.
- **Remplaçant** (o.99.5, o.99.6) : le remplaçant prend la place du tireur sortant dans les
  relais non tirés de la rencontre. Un seul remplaçant par équipe et par rencontre. Règle reprise
  de `substituteRelayFencer`.
- **Identifiants déterministes** pour les rencontres créées par le moteur :
  `${competitionId}-t${tour}-${position}` au tableau, `${matchId}-r${ordre}` pour un relais. Les
  rencontres déjà en base gardent leur UUID.
- **Composition** : modifiable jusqu'au tirage des poules d'équipes. Ensuite, seul le
  remplacement la change.

**Commandes** (verbe + objet, [ADR-0008](0008-nommage-contrat.md)) :

| Commande                                 | Rôle                                                                                                                                                                                                                                                                                                | Journal                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `registerTeam`, `unregisterTeam`         | Créer, supprimer une équipe (nom, club). Suppression refusée après le tirage                                                                                                                                                                                                                        | Non : inscription ([ADR-0018](0018-commandes-inscription.md))                      |
| `assignTeamFencer`, `unassignTeamFencer` | Titulaire ou remplaçant, ordre. Refusé après le tirage                                                                                                                                                                                                                                              | Non : inscription                                                                  |
| `generateTeamPools`                      | Rencontres de poule et leurs relais. Relais FIE : poules lues dans la formule d'équipe (ADR-0044) ; sans formule d'équipe, poule unique tous contre tous _(amendé le 2026-11-27 : remplace « poule unique tous contre tous »)_. Arène Sabre Laser : calendrier figé de 8 ou 12 équipes, sinon refus | `TeamPoolsGenerated`, puis un `TeamMatchScheduled` par rencontre                   |
| `generateTeamTableau`                    | Placement au classement d'entrée du tableau : classement de poule coupé par la qualification, ou rang d'entrée sans poule (ADR-0044) ; évitement de revanche en arène ; rencontres du premier tour _(amendé le 2026-11-27 : remplace « Placement du classement de poule »)_                         | `TeamTableauGenerated`, `TeamMatchScheduled`                                       |
| `recordRelayScore`                       | `{ competitionId, matchId, relay, scoreA, scoreB, winner?, expectedRevision?, commandId? }`. Termine le relais. Si la rencontre se termine : vainqueur, puis, au tableau, rencontre suivante créée dès que ses deux équipes sont connues                                                            | `RelayScoreRecorded`, puis `TeamMatchDecided` et `TeamMatchScheduled` selon le cas |
| `reopenRelay`                            | Rouvre le dernier relais terminé pour correction (PREV de l'appareil, remise à zéro de l'écran). Refus si une rencontre suivante du tableau a commencé (`next_match_played`)                                                                                                                        | `RelayReopened`                                                                    |
| `substituteTeamFencer`                   | `{ competitionId, matchId, teamId, outFencerId }`                                                                                                                                                                                                                                                   | `TeamFencerSubstituted`                                                            |

`generatePools`, `recordScore` et `generateTableau` gardent `unsupported_format` pour une épreuve
par équipes, avec un message qui nomme la commande d'équipe. Outils MCP : mêmes noms en
snake_case (`generate_team_pools`, `record_relay_score`…), droit d'écriture sportive.

**Événements** :

- `TeamPoolsGenerated { pools: [{ number, teamIds }] }` ;
- `TeamTableauGenerated { size, slots: [{ round, position, teamAId | null, teamBId | null, isBye }] }` ;
- `TeamMatchScheduled { matchId, teamAId, teamBId, pool | null, round | null, position | null, relays: [{ relayId, order, fencerAId, fencerBId }] }` ;
- `RelayScoreRecorded { matchId, relayId, scoreA, scoreB }` ;
- `RelayReopened { matchId, relayId }` ;
- `TeamMatchDecided { matchId, winnerTeamId }` ;
- `TeamFencerSubstituted { matchId, teamId, outFencerId, inFencerId, relayIds }`.

Les dérivés ne sont pas journalisés : cumul, classement de poule d'équipes, avancement du
tableau. `projectCompetition` rend un bloc `teams` (poules, rencontres, relais, tableau,
décisions). `compareWithState` le compare aux tables par une vue `teamStateView`. Le journal
d'une épreuve par équipes est complet quand son premier fait est `TeamPoolsGenerated` ou
`TeamTableauGenerated`.

**Serveur distant et appareils.** On garde l'état d'arène en mémoire (`teamArenaState` : touches
en direct, chrono, relais courant). Il ne fait pas partie de l'épreuve. Seules ses écritures
changent :

| Chemin                                                           | Aujourd'hui                                          | Demain                                                                                                                  |
| ---------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Relais suivant (tablette `team_advance_bout`, END de l'appareil) | `advanceTeamBout` → `ctx.db.updateTeamBout`          | `recordRelayScore` par `invokeCommandSync`, source `tablet`, `cyrano` ou `opp2`. ACK/NAK de l'appareil selon la réponse |
| PREV de l'appareil                                               | `reopenPreviousRelay` → `ctx.db.reopenTeamBout`      | `reopenRelay`. L'arène reprend le score du relais comme score en direct                                                 |
| Remplaçant (tablette, appareil)                                  | `substituteRelayFencer` → `ctx.db.setTeamBoutFencer` | `substituteTeamFencer`. Les motifs de refus deviennent des codes du catalogue                                           |

Après chaque commande, l'arène relit la rencontre (`getTeamMatchDetail`) et diffuse
`team_arena_state` comme aujourd'hui. Les pages `/equipe{N}` et le relais FIE `teamRelayPiste`
ne changent pas de protocole.

**Hors de cette ADR** : les cartons d'équipe « E » (`team_match_cards`) et les cartons
individuels des relais (`team_bout_cards`). Ils restent de la traçabilité, sans effet sur le
score. Ils suivront la décision qui sera prise pour les cartons individuels, qui ne sont pas non
plus des faits du journal. Le retrait d'une équipe entière n'existe pas aujourd'hui : il n'est pas
créé ([ADR-0008](0008-nommage-contrat.md), « une opération n'existe que si un client en a
besoin »).

### 3. Statut d'un tireur : on réutilise `withdrawFencer`

- Pas de nouvel événement ni de commande `setFencerStatus`. Abandon, forfait et exclusion (motif
  carton noir) passent par `withdrawFencer` et `reinstateFencer`
  ([ADR-0016](0016-retrait-reintegration-tireur.md)) dans les deux formats.
- Tableaux séparés : la règle de l'ADR-0016 s'applique au tableau du groupe du tireur.
- Équipes : `withdrawFencer` pose le statut et le motif, et journalise `FencerWithdrawn` avec
  `forfeitedMatchIds: []`. Aucun effet automatique sur les rencontres : le remplacement
  (`substituteTeamFencer`) reste une décision explicite.
- L'élimination en fin de tour passe par `closePoolRound`, qui existe. Le pointage passe par
  `checkIn`. Le patch de statut de `useFencerManagement` (`db.updateFencer` avec `status` ou
  `exclusionReason`, `setFencersStatus`) disparaît.

### 4. Instantanés d'abandon : écrits par le moteur seul

- La table `fencer_abandons` reste l'instantané de `withdrawFencer`, écrit dans sa transaction.
  `saveAbandonSnapshot`, `getAbandonSnapshot` et `handleUndoAbandon` sortent de l'écran et du
  préload.
- Un instantané écrit par l'écran avant la mise à jour garde le même format (`AbandonSnapshot`).
  `reinstateFencer` le lit : un test le vérifie.
- Équipes : pas d'instantané. Le retrait d'un tireur ne touche aucun relais, et la charge des
  événements suffit à défaire ce qui doit l'être.

### 5. Nettoyage et ordre des lots

Une PR par lot, chacune avec ses tests sur base réelle et son test de rejeu. Pour un même fait,
les lots qui le journalisent sont empilés et mergés ensemble, sans journal partiel
([ADR-0005](0005-journal-un-fait-un-chemin.md)).

| Lot | Contenu                                                                                                                                                                                                                                                                                                                                                                                                     | Critère de sortie                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| A1  | `splitGroups.ts` dans le domaine. `groupTableaux`, `allTableauMatches`, champ `group` des événements de tableau. `generateTableau` et `clearTableau` par groupe. Les refus « tableaux séparés » tombent dans `recordScore` et `withdrawFencer`. Rejeu et `compareWithState` par groupe                                                                                                                      | Une épreuve à deux groupes se joue par les commandes et se rejoue sans écart |
| A2  | Écran : onglets lus dans la projection, groupe affiché en préférence du poste, `splitTableauStates` supprimé                                                                                                                                                                                                                                                                                                | Recharger l'écran garde les tableaux des deux groupes                        |
| A3  | `splitOffGroup`, `GroupSplitOff`, `SplitRankingImported`. `useSplitGroups` n'écrit plus rien                                                                                                                                                                                                                                                                                                                | L'épreuve séparée est créée en une transaction et rejouée seule              |
| E1  | `relay.ts` dans le domaine, commandes d'inscription des équipes, `generateTeamPools`, bloc `teams` de `getCompetitionState` et du rejeu                                                                                                                                                                                                                                                                     | Poules d'équipes tirées par le moteur, relues par l'écran                    |
| E2  | `recordRelayScore`, `reopenRelay`, `substituteTeamFencer`, `generateTeamTableau` : moteur et outils MCP                                                                                                                                                                                                                                                                                                     | Rencontre complète par les commandes, rejeu sans écart                       |
| E3  | Écran (`TeamManagerView` → `useBpmClient`)                                                                                                                                                                                                                                                                                                                                                                  | Plus aucun appel `window.electronAPI` d'écriture dans `TeamManagerView`      |
| E4  | Tablettes et appareils (`teamArena`, `teamRelayDevice`, `teamRelayPiste`)                                                                                                                                                                                                                                                                                                                                   | Relais FIE complet depuis le simulateur Cyrano et OPP2 ; ACK/NAK inchangés   |
| N   | Nettoyage : `persistLocally`, `useMatchDbSync`, sauvegarde de l'écran dans `useCompetitionSession` / `useCompetitionRestore`, `saveSessionState` et `saveSessionStateSync` du préload, replis « local » sur `unsupported_format`, `poolPersistence.ts`, `syncPoolSnapshot`, instantanés de l'écran, canaux `db:*Team*` d'écriture. Cliquets `electronApiCalls`, `electronApiUses` et `ipcChannels` abaissés | Critères de #2100                                                            |

E2, E3 et E4 sont empilés : les événements de relais n'existent dans une version publiée qu'une
fois les trois chemins (écran, tablette, appareil) passés par les commandes. A1 et A2 de même pour
le champ `group`.

**Critères d'acceptation** (ceux de #2100, rendus vérifiables) :

- `grep persistLocally src` est vide ; `saveSessionState` n'est plus dans le préload.
- Un test de rejeu par format (deux groupes, épreuve séparée, relais FIE, arène Sabre Laser) :
  `compareWithState(projectCompetition(journal), état)` ne rend aucun écart.
- Les tablettes, les appareils de piste et le MCP passent par les mêmes commandes (tests des
  routes et des pilotes sur base réelle).

## Conséquences

- **Aucune migration** ([ADR-0011](0011-migrations-schema-3-0.md)) : `session_state` est du JSON,
  les tables des équipes existent, `table_id` ne change pas. Si un lot en découvre le besoin, il
  passe par une nouvelle ADR.
- **Épreuves en cours au moment de la mise à jour** :
  - Tableaux séparés : à la première lecture, le moteur range le `tableauMatches` existant dans
    le groupe de ses tireurs. Ses identifiants restent sans préfixe : ils sont uniques, puisque
    les autres groupes n'étaient pas enregistrés. Les tableaux des autres groupes, qui n'étaient
    qu'en mémoire, sont à retirer : on le dit dans les notes de version 3.0, rubrique
    « Changements de comportement » (lot A2) :

    > Tableaux séparés après les poules : chaque groupe garde désormais son tableau, y compris
    > après un redémarrage. Pour une épreuve en cours tirée avec une version précédente, seul le
    > tableau du groupe affiché au dernier enregistrement est repris ; les tableaux des autres
    > groupes, qui n'étaient pas enregistrés, ne sont pas récupérés : ils sont à tirer de nouveau.

  - Équipes : les rencontres et relais en base sont repris tels quels (UUID). Le journal de ces
    épreuves est incomplet. `rebuildCompetitionState` part alors des tables, comme pour toute
    épreuve antérieure au premier palier.
  - Une arène d'équipe ouverte pendant la mise à jour perd son état en mémoire, comme à tout
    redémarrage. Le dernier relais terminé est en base.
- **Saisie à l'écran des relais** : on enregistre la fin du relais, plus chaque touche
  (`handleScoreBout` écrit aujourd'hui une ligne par touche). Le compteur de touches devient un
  état de l'écran.
- **Catalogue des erreurs** ([ADR-0009](0009-codes-erreur.md)), dans la PR de la commande :
  `team_not_found`, `team_incomplete` (titulaires manquants au tirage), `relay_out_of_order`,
  `no_reserve`, `reserve_used`, `no_later_relay`, `split_group_not_found`. On réutilise
  `invalid_input`, `match_not_ready`, `next_match_played`, `unsupported_format`.
- `docs/API_CONTRACT.md` (faits rejouables), `docs/MCP.md` (`npm run docs:mcp`) et
  `docs/TEAM_COMPETITIONS.md` (limites connues) suivent chaque lot.
- L'étape 4c de l'ADR-0017 n'a plus d'exception. `unsupported_format` reste au catalogue pour les
  commandes individuelles appelées sur une épreuve par équipes.

## Questions tranchées à la revue (2026-11-23)

Le mainteneur a retenu les recommandations :

1. **Onglets ou épreuves séparées** : on garde les tableaux par groupe dans la même épreuve.
2. **Saisie à l'écran** : seule la fin du relais est enregistrée ; le compteur de touches reste
   un état de l'écran.
3. **Composition après le tirage** : figée, sauf remplacement.
4. **État des équipes** : bloc `teams` dans `getCompetitionState`.
5. **Tableaux des groupes perdus des épreuves en cours** : une note de version suffit.

## Alternatives écartées

- **Tableaux séparés toujours extraits en épreuves séparées** : le moteur n'aurait qu'un tableau
  par épreuve, et toutes les commandes resteraient telles quelles. Mais le produit change (plus
  d'onglets), les tireurs sont toujours copiés, et il faut un serveur distant par groupe pour
  tirer les deux tableaux en même temps. C'est une décision de produit, pas d'architecture (voir
  les questions tranchées).
- **Concaténer les tableaux des groupes dans `tableauMatches` avec un champ `group`** : moins de
  lecteurs à toucher, mais toutes les règles du tableau (propagation, classement final, tableaux
  de classement) raisonnent sur un seul tableau par tour et par position. Il faudrait les filtrer
  partout.
- **Journaliser le partage du classement (`RankingSplit`)** : c'est un dérivé du classement et du
  groupe de chaque tireur. Le placement complet de `TableauGenerated` suffit au rejeu.
- **Équipes dans `session_state`** : il faudrait recopier les tables, que les tablettes, les
  appareils et les exports lisent déjà. Deux projections divergeraient.
- **Réutiliser `generatePools` et `recordScore` pour les équipes** : les entrées et les sorties
  différeraient selon le format. Ce seraient des sorties non strictes, et un agent MCP lirait mal
  une commande à deux formes.
- **Journaliser chaque touche d'un relais** : le journal enfle, sans fait de plus. Une touche est
  un état d'arène, comme le score en direct d'un match individuel.
- **Instantané pour les équipes (`fencer_abandons` avec un identifiant d'équipe)** : détournement
  de la table, alors que rien n'est à restaurer.
