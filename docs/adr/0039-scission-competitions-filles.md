# ADR-0039 — La scission est une phase de la formule : chaque branche devient une compétition fille, classée à part

- **Statut** : Acceptée (validée par le mainteneur le 2026-11-26) ; amendée le 2026-11-26 (état `splitHistory` de l'épreuve d'origine, `stayInCompetition` et reprise de la compétition couplée à partir d'E3, entrée en vigueur appliquée par E2a, validé par le mainteneur) ; amendée le 2026-11-26 (étape E3 : `stayInCompetition` réservé au critère sexe, reprise de la compétition couplée, scission manuelle à l'écran, validé par le mainteneur) ; amendée le 2026-11-26 (mélange retiré : rester dans l'épreuve seulement si toutes les branches restent, validé par le mainteneur)
- **Date** : 2026-11-26
- **Tickets** : #2013 (étape E ; questions Q6, Q7), #1948 ; précise [ADR-0036](0036-formule-v2-arbre-par-phase.md) (`SplitPhase`), s'appuie sur [ADR-0024](0024-tableaux-separes-equipes-moteur.md) (`splitOffGroup`, `GroupSplitOff`, `SplitRankingImported`) et [ADR-0011](0011-migrations-schema-3-0.md) (migration)

## Contexte

- La seule scission existante est la « compétition couplée » : `settings.postPoolSplitCriteria
= 'gender'`, tableaux séparés par sexe dans la même épreuve, ou extraction d'un groupe en
  épreuve séparée par `splitOffGroup` (ADR-0024). Pas de scission par rang (Tableau A / B,
  N1 / N2), ni par catégorie (vétérans V1 à V4 mélangés en poules), ni manuelle.
- ADR-0036 déclare `SplitPhase { criterion, branches: { label, phases }[] }` sans l'ouvrir à la
  grammaire.
- Le tireur n'a pas de catégorie : seulement `birthDate`. Une épreuve n'a qu'une catégorie.
- Vérification des logiciels existants (2026-11-26) : Fencing Time (« Continuation Events »,
  guide v4.5d p. 70), BellePoule V5 (`splitting.cpp`, compétition dupliquée au verrouillage) et
  Engarde (extraction XML) créent une **compétition séparée** ; Fencing Fox (manuel 2026,
  § 7.5.21.3) laisse le choix. Aucun ne fait de classement à la suite A puis B ; Fencing Time
  le dit impossible ; BellePoule transmet A et B à GREG comme deux compétitions. Fencing Fox
  porte la catégorie sur le tireur, calculable depuis la date de naissance.
- Arbitrages du mainteneur du 2026-11-26 : Q7 « compétition fille par défaut, tous critères » ;
  Q6 « classement par branche, toujours » ; branche « poules ou tableau » ; catégorie = champ du
  tireur rempli par import, calcul et saisie ; rang par nombre **ou** pourcentage ; sélection
  manuelle dans E ; une ADR puis trois PR.

## Décision

**La brique Scission** (`shared/domain/formula`)

- On ouvre `SplitPhase` à la grammaire, en dernière phase de la formule de l'épreuve. Elle suit
  un tour de poules ou un tableau arrêté à N (ADR-0037), jamais un tableau qui va jusqu'à la
  finale. Deux branches au moins.
- On précise sa forme (ADR-0036 la déclarait sans ces champs) :

```ts
interface SplitPhase {
  kind: 'split';
  id: string;
  criterion: 'gender' | 'category' | 'rank' | 'manual';
  branches: SplitBranch[];
}
interface SplitBranch {
  label: string; // « Tableau A », « N1 », « Dames », « V1 »… : titre de la fille, libellé GREG
  phases: FormulaPhaseV2[]; // formule de la branche : poules et / ou tableau (sans scission)
  gender?: Gender; // critère gender
  categories?: Category[]; // critère category : une ou plusieurs (V3 + V4)
  take?: AdvancementRule; // critère rank : fixed_count ou percentage ; absent = le reste
  stayInCompetition?: boolean; // critère gender, toutes les branches ou aucune, `phases` = un tableau
}
```

_(Amendé le 2026-11-26 : le commentaire de `stayInCompetition` remplace « critère gender,
`phases` = un tableau (voir plus bas) », qui remplaçait lui-même « seulement si `phases` = un
tableau (voir plus bas) » (étape E3).)_

- Contrôles de structure (bloquants) : chaque branche a au moins une phase (S5 de #2013) ; une
  branche ne contient pas de scission ; par rang, une seule branche « le reste », en dernier ;
  par catégorie et par sexe, une valeur n'appartient qu'à une branche.

**Exécution : une commande, des compétitions filles**

- On ajoute la commande **`splitCompetition`** (`{ competitionId, assignments?, dryRun?,
expectedRevision?, commandId? }`, droit `competition:write`, outil MCP `split_competition`).
  Elle se lance quand la phase qui précède la scission est close (tour de poules terminé,
  tableau arrêté clos) ; sinon refus avec les codes existants `pools_not_complete` ou
  `tableau_stage_not_complete`.
- Entrée : le classement de cette phase (classement après le tour de poules, qualification du
  tour appliquée ; ou restants du tableau arrêté par rang d'entrée, Q5). Les tireurs non
  qualifiés restent classés dans l'épreuve d'origine.
- Répartition (domaine pur, `planSplit`) : par sexe et par catégorie, selon le champ du
  tireur ; par rang, les branches prennent dans l'ordre leur nombre ou leur pourcentage, ex
  aequo à la borne départagés comme la qualification ; manuelle, d'après `assignments`
  (`{ fencerId, branch }[]`) envoyé par l'écran. Un tireur sans valeur pour le critère (sexe ou
  catégorie absent) refuse la commande (`split_value_missing`) ; la simulation (`dryRun`) les
  liste.
- **Par défaut, chaque branche devient une compétition fille**, dans **une** transaction :
  épreuve créée avec la formule de la branche (`settings.formula`), titre « titre d'origine –
  libellé », copies des tireurs pointés avec leur rang dans la phase de scission comme
  classement initial. On réutilise `GroupSplitOff` (épreuve d'origine, `group` = libellé de
  la branche) et `SplitRankingImported` (premier fait de la fille) : aucun nouvel événement.
  `splitOffCompetitionIds` de l'origine reçoit `{ libellé: id de la fille }`. _(Amendé le
  2026-11-26 : remplace « `splitOffCompetitionIds` de l'origine reçoit
  `{ libellé: id de la fille }` ; quand une autre branche par sexe reste dans l'épreuve, il
  reçoit aussi `{ sexe: id de la fille }`, groupe extrait des tableaux séparés comme avec
  `splitOffGroup` (ADR-0024). », qui remplaçait lui-même « `splitOffCompetitionIds` de
  l'origine reçoit `{ libellé: id de la fille }`. » (étape E3).)_
- **Exception, critère sexe seulement : la compétition couplée.** Dans une scission par sexe
  qui suit un tour de poules, deux branches (Hommes, Dames) réduites chacune à un tableau, avec
  les mêmes réglages de tableau, peuvent rester ensemble dans l'épreuve d'origine
  (`stayInCompetition`). Elles se jouent alors comme les tableaux séparés (`groupTableaux`,
  ADR-0024, moteur inchangé). Rester dans l'épreuve vaut pour toutes les branches ou pour
  aucune : dès qu'une branche part en compétition fille, toutes partent ; la grammaire refuse
  une scission dont une partie seulement des branches reste. Pour les autres critères, chaque
  branche est une compétition fille : la grammaire refuse `stayInCompetition` hors du critère
  sexe ou sur une branche qui n'est pas un tableau seul. La compétition couplée n'a rien à
  créer : `splitCompetition` la refuse (`invalid_settings`) et l'écran ne la propose pas ; à
  l'écran, une seule case « Rester dans l'épreuve » vaut pour la scission entière. _(Amendé le
  2026-11-26 : remplace « **Exception, critère sexe seulement** : dans une scission par sexe
  qui suit un tour de poules, une branche réduite à un tableau peut rester dans l'épreuve
  d'origine (`stayInCompetition`). Elle se joue alors comme les tableaux séparés
  (`groupTableaux`, ADR-0024, moteur inchangé) ; les branches restées ont les mêmes réglages de
  tableau. Pour les autres critères, chaque branche est une compétition fille : la grammaire
  refuse `stayInCompetition` hors du critère sexe ou sur une branche qui n'est pas un tableau
  seul. Toutes les branches restées (compétition couplée) : rien à créer, `splitCompetition`
  refuse (`invalid_settings`) et l'écran ne la propose pas. Une branche restée, une autre
  partie : `splitCompetition` crée la fille de la branche partie, la branche restée se joue en
  tableau séparé. », qui remplaçait lui-même (étape E3) « **Exception, à partir de l'étape E3** :
  une branche réduite à un tableau peut rester dans l'épreuve d'origine (`stayInCompetition`).
  Elle se joue alors comme les tableaux séparés d'aujourd'hui (`groupTableaux`, ADR-0024). C'est
  le cas de la compétition couplée par sexe. Jusqu'à E3 (reprise de la compétition couplée), la
  grammaire refuse `stayInCompetition` : E2 ne crée que des compétitions filles. », qui
  remplaçait lui-même « **Exception** : une branche réduite à un tableau peut rester dans
  l'épreuve d'origine (`stayInCompetition`). »)_
- L'épreuve d'origine garde dans son état de session
  `splitHistory: [{ label, competitionId, fencerIds }]` (JSON, sans migration), écrit par
  `splitCompetition` dans sa transaction ; la projection du journal le rejoue depuis
  `GroupSplitOff` (ADR-0017). _(Ajout du 2026-11-26.)_

**Classement : par branche, toujours** (Q6)

- Chaque fille a son classement final, numéroté depuis 1, publié à part (GREG, FTP, PDF) avec
  le libellé de sa branche. Une branche restée dans l'épreuve a son propre classement,
  numéroté depuis 1.
- L'épreuve d'origine classe seulement les tireurs non passés dans une branche (éliminés
  avant la scission) ; ses résultats renvoient aux filles. Pas de classement combiné ; un
  export combiné pourra venir plus tard, sans changer ce choix.

**Catégorie du tireur**

- On ajoute la colonne **`fencers.category`** (`TEXT NULL`, codes de `Category` : `U9` …
  `SEN`, `V1` … `V4`) par la **migration 53**, additive, sans valeur par défaut, avec son test
  depuis une base en version 52 (ADR-0011).
- Remplissage : import (format FFE et autres formats qui portent la catégorie du tireur) ;
  action « Calculer les catégories » d'après la date de naissance et la saison de l'épreuve
  (règles d'âge communes, domaine pur, saison injectée) ; saisie et correction à la main.
  Commandes d'inscription et de modification du tireur : champ `category` optionnel (ADR-0018).

**Compétition couplée existante**

- `formulaOf` lit `postPoolSplitCriteria = 'gender'` (épreuve sans formule enregistrée, ou
  formule enregistrée avant E3 avec ce réglage) comme une scission par sexe « Hommes »,
  « Dames » dont les deux branches sont le tableau de l'épreuve, restées dans l'épreuve.
  `flatSettingsOf` écrit `postPoolSplitCriteria = 'gender'` (avec `hasDirectElimination` et les
  réglages de ce tableau) pour une scission par sexe dont toutes les branches restent dans
  l'épreuve, et pour elle seulement. _(Amendé le 2026-11-26 : remplace « `flatSettingsOf` écrit
  `postPoolSplitCriteria = 'gender'` (avec `hasDirectElimination` et les réglages de ce
  tableau) pour une scission par sexe dont une branche au moins reste dans l'épreuve, et pour
  elle seulement. »)_ Sans place pour la scission (Tour Quest, pas de tour de
  poules juste avant le tableau), l'ancien réglage est gardé tel quel. Une épreuve existante se
  déroule à l'identique ; « Créer la compétition Femmes » (`splitOffGroup`) reste disponible.
  Contrat : `setGeneral` `postPoolSplitCriteria` pose ou retire cette scission ; `setPhase`
  sur `tableau` règle le tableau des branches restées. _(Amendé le 2026-11-26, étape E3 : remplace
  « À partir de l'étape E3, `formulaOf` lit `postPoolSplitCriteria = 'gender'` comme une
  scission par sexe dont les deux branches sont un tableau qui reste dans l'épreuve ;
  `flatSettingsOf` écrit `postPoolSplitCriteria` pour cette forme seulement. Jusque-là, la
  compétition couplée reste un réglage hors de la scission, inchangé. », amendement précédent
  du même jour.)_

## Conséquences

- Une migration (53), une commande et un outil MCP, un code d'erreur (`split_value_missing`) ;
  aucun nouvel événement, aucun nouveau format de journal.
- Le moteur des poules par branche n'est pas écrit : une branche avec des poules est une
  fille, qui se déroule avec le moteur actuel. Les branches restées dans l'épreuve se limitent
  à un tableau, dans une scission par sexe dont toutes les branches restent (compétition
  couplée). _(Amendé le 2026-11-26 : remplace « Les branches restées dans l'épreuve se limitent
  à un tableau, dans une scission par sexe. », qui remplaçait lui-même « Les branches restées
  dans l'épreuve se limitent à un tableau. » (étape E3).)_
- Contrat : la sortie de `splitCompetition` gagne `entrants` (classement d'entrée, dans
  l'ordre : répartition manuelle à l'écran) et `stayInCompetition` par branche, toujours
  `false` (la compétition couplée est refusée, les autres scissions partent entières), sans
  changer les champs existants. _(Ajout du 2026-11-26, étape E3 ; amendé le 2026-11-26 :
  remplace « et `stayInCompetition` par branche, sans changer les champs existants. »)_
- **Amendements portés par E2** : ADR-0036 (`SplitPhase.branches` de la forme `SplitBranch[]`
  décrite ici) et ADR-0037 (D2b : tableau arrêté suivi d'un tour de poules ou d'une
  scission ; Q5 : restants classés dans les filles, l'épreuve d'origine classe les éliminés du
  tableau, puis des poules), réécrits sur place dans ces ADR avec le code qui les prouve
  (E2a : grammaire, `planSplit`, `splitCompetition`, `originFinalRanking` pour le classement
  de l'origine). _(Amendé le 2026-11-26 : remplace « **Entrée en vigueur avec E2** : tant que
  la brique Scission n'est pas dans la grammaire, ADR-0036 et ADR-0037 s'appliquent telles
  quelles. La PR E2 porte, avec le code qui les prouve, les amendements validés par le
  mainteneur le 2026-11-26 » et sa liste.)_
- Découpage, chaque PR en draft, `/adr-check`, sans auto-merge :
  - **E1** : champ catégorie du tireur (migration 53, import, calcul, saisie, contrat).
  - **E2** : brique Scission (grammaire, éditeur), `planSplit`, `splitCompetition`, filles,
    classement par branche (écran, exports).
  - **E3** (faite) : scission manuelle (répartition tireur par tireur dans la fenêtre de
    lancement, sans nouvel écran), `stayInCompetition` pour le critère sexe, toutes les
    branches ou aucune, et reprise de la compétition couplée dans la formule. _(Amendé le
    2026-11-26 : remplace « **E3** (faite) : scission manuelle (répartition tireur par tireur
    dans la fenêtre de lancement, sans nouvel écran), `stayInCompetition` pour le critère sexe
    et reprise de la compétition couplée dans la formule. », qui remplaçait lui-même
    « **E3** : scission manuelle (écran de répartition) et reprise de la compétition couplée
    dans la formule. » (étape E3).)_
- Le classement d'une fille ne remonte pas dans l'épreuve d'origine : un DT qui veut un
  classement unique A puis B ne l'a pas (choix Q6, comme les logiciels étudiés).

## Alternatives écartées

- **Branches dans la même compétition, poules comprises** — demande un moteur de tours de
  poules parallèles (taille L) ; aucun logiciel étudié ne le fait ; Q7 tranchée pour la fille.
- **Classement à la suite pour le rang (A puis B)** — aucun logiciel étudié ne le fait, GREG
  attend des compétitions distinctes ; Q6 révisée le 2026-11-26.
- **Catégorie calculée à la volée depuis la date de naissance, sans champ** — pas de
  correction possible, tireur sans date de naissance inclassable ; arbitrage pour le champ.
- **Nouvel événement `CompetitionSplit`** — `GroupSplitOff` et `SplitRankingImported` portent
  déjà les faits (qui part, vers quelle épreuve, avec quel rang).
