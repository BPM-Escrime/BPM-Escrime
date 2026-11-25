# ADR-0035 — Déroulé généré par la formule v2 : navigation, 0 tour de poules, tableau arrêté à N, phase après un tableau

- **Statut** : Acceptée (arbitrage du 2026-11-25 : Q5 « par tour, puis rang d'entrée » ; découpage D1 / D2)
- **Date** : 2026-11-25
- **Tickets** : #2013 (étape D ; question Q5), #1948 ; complète [ADR-0034](0034-formule-v2-arbre-par-phase.md), [ADR-0007](0007-format-evenement.md) et [ADR-0017](0017-projections-etat-epreuve.md)

## Contexte

- L'ordre des écrans de l'épreuve est codé en dur (`useCompetitionPhases`) :
  `checkin → poolprep → pools → ranking → tableau → results`, avec deux variantes pour le Tour
  Quest. Les tours de poules réutilisent les mêmes écrans (`currentPoolRound`).
- « Sans poule » existe déjà, mais comme un choix fait le jour J : la commande `skipPools`
  (événement `PoolsSkipped`) place le tableau au classement d'entrée.
- Le tableau va toujours jusqu'à la finale ; rien ne peut le suivre.
- La formule v2 (ADR-0034) sait décrire 0 à 5 tours, et déclare `TableauPhase.stopAt` sans que
  le moteur l'exécute.

## Décision

**Déroulé dérivé de la formule** (`shared/domain/formula/formulaSteps.ts`, domaine pur)

- `formulaSteps(formula)` rend la suite des étapes de l'épreuve : appel ; une étape « poules »
  par suite de tours consécutifs (préparation, poules, classement) ; Tour Quest ; tableau, avec
  son `stopAt` éventuel ; phase qui suit un tableau arrêté ; résultats.
- L'écran construit sa barre de navigation à partir de ces étapes. Les identifiants d'écran
  existants (`poolprep`, `pools`, `ranking`, `tableau`, `results`, `quest`) sont gardés ; une
  étape qui suit un tableau arrêté reçoit un identifiant indexé (D2).
- Une épreuve sans formule enregistrée garde le déroulé actuel : `formulaOf` construit la même
  suite depuis ses réglages (ADR-0034).

**D1 : 0 tour de poules, plus de 3 tours**

- Formule sans tour de poules : pas de préparation ni de poules dans la navigation. À la sortie
  de l'appel, l'écran appelle la commande existante `skipPools` : tableau au classement
  d'entrée, placement strict. Les modes de tirage relèvent de #1948, lot 1.
- Plus de 3 tours : plafond inchangé (`MAX_POOL_ROUNDS = 5`), avertissement non bloquant
  au-delà de 3. La navigation par tour est déjà générique.
- Ni nouvel état de session, ni nouvel événement.

**D2 : tableau arrêté à N, phase après un tableau**

- Le moteur génère le tableau comme aujourd'hui, mais ne joue que les tours qui mènent à N
  tireurs restants. Quand le dernier match de ce tour est joué, la commande
  `closeTableauStage` (ADR-0008) clôt l'étape. Elle écrit l'événement `TableauStageClosed`
  (ADR-0007 : passé, PascalCase, identifiants seulement) : `{ stopAt, qualifiedIds,
eliminatedIds }`.
- **Classement (Q5)** :
  - les éliminés d'un tableau arrêté sont classés d'abord par tour atteint (le plus loin
    devant), puis, à tour égal, par rang d'entrée dans le tableau ;
  - les N restants entrent dans la phase suivante dans l'ordre de leur rang d'entrée ;
  - au classement final : les N restants selon la phase suivante, puis les éliminés du
    tableau, puis les éliminés des poules (ordre actuel).
- **État de session** (JSON, sans migration de schéma) : une liste `stageHistory` garde les
  étapes closes (poules d'un tour, tableau arrêté), à côté de `poolHistory`, conservé pour les
  lecteurs actuels. La projection du journal (ADR-0017) rejoue `TableauStageClosed`.
- Les tablettes, l'arène et les PDF lisent l'étape en cours ; une étape close reste
  consultable, comme un tour de poules terminé aujourd'hui.

## Conséquences

- D1 ne change pas le moteur : il branche la navigation sur la formule et réutilise
  `skipPools`. D2 ajoute une commande, un événement et une clé d'état de session.
- Le serveur MCP continue de refuser plusieurs tours de poules (`assertSupported`) ; l'ouverture
  au MCP des formules à plusieurs tours et du tableau arrêté relève de l'étape F.
- Chaque PR en draft, sans auto-merge (ticket `refactor`).

## Alternatives écartées

- **Garder l'ordre codé en dur** et ajouter des exceptions par format : chaque nouvelle
  formule de #1948 ajouterait une branche à `useCompetitionPhases`.
- **Une épreuve fille par phase après le tableau** (comme la scission de BellePoule V6) : le
  classement final serait à recomposer entre épreuves ; c'est le choix de la brique Scission
  (étape E), pas d'une simple phase intercalée.
- **Classer les éliminés du tableau arrêté par l'indice des poules** (variante de Q5) : écartée
  à l'arbitrage du 2026-11-25 au profit du rang d'entrée, usage de BellePoule et d'Engarde.
