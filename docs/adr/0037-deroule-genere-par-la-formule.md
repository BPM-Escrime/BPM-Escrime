# ADR-0037 — Déroulé généré par la formule v2 : navigation, 0 tour de poules, tableau arrêté à N, phase après un tableau

- **Statut** : Acceptée (arbitrage du 2026-11-25 : Q5 « par tour, puis rang d'entrée » ; découpage D1 / D2) ; amendée le 2026-11-25 (D2b, validé par le mainteneur : navigation dérivée par `formulaSteps.ts`, pas d'identifiant indexé pour une seule phase après le tableau, section « Écran (D2b) ») ; amendée le 2026-11-26 (scission après un tableau arrêté, [ADR-0039](0039-scission-competitions-filles.md), validé par le mainteneur : D2b, retrait de la dernière phase d'après, Q5, scission ouverte au MCP, publication GREG / FTP du classement du tableau arrêté)
- **Date** : 2026-11-25
- **Tickets** : #2013 (étape D ; question Q5), #1948 ; complète [ADR-0036](0036-formule-v2-arbre-par-phase.md), [ADR-0007](0007-format-evenement.md) et [ADR-0017](0017-projections-etat-epreuve.md)

## Contexte

- L'ordre des écrans de l'épreuve est codé en dur (`useCompetitionPhases`) :
  `checkin → poolprep → pools → ranking → tableau → results`, avec deux variantes pour le Tour
  Quest. Les tours de poules réutilisent les mêmes écrans (`currentPoolRound`).
- « Sans poule » existe déjà, mais comme un choix fait le jour J : la commande `skipPools`
  (événement `PoolsSkipped`) place le tableau au classement d'entrée.
- Le tableau va toujours jusqu'à la finale ; rien ne peut le suivre.
- La formule v2 (ADR-0036) sait décrire 0 à 5 tours, et déclare `TableauPhase.stopAt` sans que
  le moteur l'exécute.

## Décision

**Déroulé dérivé de la formule** (`shared/domain/formula/formulaSteps.ts`, domaine pur)

- `formulaSteps(formula)` rend la suite des étapes de l'épreuve : appel ; une étape « poules »
  par suite de tours consécutifs (préparation, poules, classement) ; Tour Quest ; tableau, avec
  son `stopAt` éventuel ; phase qui suit un tableau arrêté ; résultats.
- L'écran dérive sa barre de navigation de la formule par les fonctions de `formulaSteps.ts` :
  `startsWithTableau` (0 tour), `formulaSegment` (tours et tableau de la partie en cours,
  tableau arrêté). `formulaSteps` rend le déroulé complet (agent, documentation) ; un test
  vérifie que les onglets suivent `formulaSteps` (`useCompetitionPhases.test.tsx`).
  _(Amendé le 2026-11-25, D2b : remplace « construit sa barre de navigation à partir de ces
  étapes ».)_
- Les identifiants d'écran existants (`poolprep`, `pools`, `ranking`, `tableau`, `results`,
  `quest`) sont gardés. Les tours de poules qui suivent un tableau arrêté réutilisent les
  écrans des tours de poules, numérotés à la suite ; un identifiant indexé ne sera introduit
  que si plusieurs phases distinctes peuvent suivre un tableau (#1948). _(Amendé le
  2026-11-25, D2b : remplace « une étape qui suit un tableau arrêté reçoit un identifiant
  indexé ».)_
- Une épreuve sans formule enregistrée garde le déroulé actuel : `formulaOf` construit la même
  suite depuis ses réglages (ADR-0036).

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
  - quand une scission suit le tableau arrêté (ADR-0039), les N restants sont classés dans
    les compétitions filles ; l'épreuve d'origine classe les éliminés du tableau, puis des
    poules. _(Ajout du 2026-11-26, ADR-0039.)_
- **État de session** (JSON, sans migration de schéma) : une liste `stageHistory` garde les
  étapes closes (poules d'un tour, tableau arrêté), à côté de `poolHistory`, conservé pour les
  lecteurs actuels. La projection du journal (ADR-0017) rejoue `TableauStageClosed`.
- Les tablettes, l'arène et les PDF lisent l'étape en cours ; une étape close reste
  consultable, comme un tour de poules terminé aujourd'hui.
- **Écran (D2b, amendement du 2026-11-25)** :
  - `stopAt` de 2 à 128 (puissance de 2) réglé sur le tableau ; un tableau arrêté est précédé
    d'au moins un tour de poules et suivi d'un tour de poules ou d'une scission (ADR-0039),
    sans Tour Quest _(Amendé le 2026-11-26 : remplace « un tableau arrêté est précédé et suivi
    d'au moins un tour de poules »)_ ; le retrait de la dernière phase d'après (tour de
    poules ou scission) rend le tableau complet ; tant qu'une scission le suit, il reste arrêté
    _(Amendé le 2026-11-26 : remplace « le retrait du dernier tour d'après rend le tableau
    complet »)_ ;
  - les tours du tableau après l'arrêt restent affichés ; leur score est refusé par le moteur
    (`tableau_round_after_stop`), pour l'écran, les tablettes et les appareils ;
  - au-dessus du tableau, un bandeau appelle `closeTableauStage` une fois les tours avant
    l'arrêt joués ; le tour suivant est réparti par rang d'entrée au tableau
    (`rankingAfterStage`, comme le moteur) ;
  - étape close : onglet « Tableau (clos) » en lecture seule ; classement final, CSV, XML, PDF
    du classement et livret par `rankAfterStages` (libellé « Tableau de N ») et
    `resultsTableauMatches` (tableau clos). La publication GREG / FTP par le moteur reprend le
    classement de l'écran (`rankAfterStages`, `originFinalRanking`). Le pilotage du tableau
    arrêté par le MCP relève de l'étape F, sauf la scission (`split_competition`, ADR-0039).
    _(Amendé le 2026-11-26 : remplace « La publication GREG / FTP par le moteur et le pilotage
    par le MCP relèvent de l'étape F. »)_

## Conséquences

- D1 ne change pas le moteur : il branche la navigation sur la formule et réutilise
  `skipPools`. D2 ajoute une commande, un événement et une clé d'état de session.
- Le serveur MCP continue de refuser plusieurs tours de poules (`assertSupported`) pour le tirage
  des poules et du tableau sans placement fourni par l'écran ; seule la scission (`split_competition`,
  [ADR-0039](0039-scission-competitions-filles.md)) lui est ouverte dès l'étape E, y compris
  après plusieurs tours ou un tableau arrêté. L'ouverture au MCP du reste des formules à
  plusieurs tours et du tableau arrêté relève de l'étape F. _(Amendé le 2026-11-26 : remplace
  « Le serveur MCP continue de refuser plusieurs tours de poules (`assertSupported`) ;
  l'ouverture au MCP des formules à plusieurs tours et du tableau arrêté relève de l'étape
  F. »)_
- Chaque PR en draft, sans auto-merge (ticket `refactor`).

## Alternatives écartées

- **Garder l'ordre codé en dur** et ajouter des exceptions par format : chaque nouvelle
  formule de #1948 ajouterait une branche à `useCompetitionPhases`.
- **Une épreuve fille par phase après le tableau** (comme la scission de BellePoule V6) : le
  classement final serait à recomposer entre épreuves ; c'est le choix de la brique Scission
  (étape E), pas d'une simple phase intercalée.
- **Classer les éliminés du tableau arrêté par l'indice des poules** (variante de Q5) : écartée
  à l'arbitrage du 2026-11-25 au profit du rang d'entrée, usage de BellePoule et d'Engarde.
