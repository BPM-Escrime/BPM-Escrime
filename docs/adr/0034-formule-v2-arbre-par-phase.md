# ADR-0034 — Formule v2 : un arbre de phases pour toutes les armes, lu par phase par le moteur, sans migration de schéma

- **Statut** : Proposée (choix de fond arbitrés le 2026-11-25 : arbre, sans migration SQL, réglage de répartition du tour suivant)
- **Date** : 2026-11-25
- **Tickets** : #2013 (étape C ; questions Q3, Q4, Q19), #1948 (ex-lot 0) ; complète [ADR-0012](0012-formule-domaine.md), [ADR-0032](0032-formule-interface-unique-apercu.md) et [ADR-0033](0033-modeles-de-formule.md), soumise à [ADR-0011](0011-migrations-schema-3-0.md)

## Contexte

- Deux modèles de formule coexistent (ADR-0032) :
  - `FormulaDraft`, réécrit en réglages plats (`poolRounds`, `defaultPoolMaxScore`…), pour
    l'épée, le fleuret, le sabre et le Sabre Laser ;
  - `CustomFormulaConfig` v1 (`customFormula`), pour l'arme « Autre », réduite en réglages
    plats par `deriveSettingsFromFormula`.
- Le moteur, les tablettes et les exports ne lisent que les réglages plats : **un seul jeu de
  touches, de chrono et de taille de poule pour tous les tours**. Les réglages du tour 2 et
  suivants sont masqués dans la nouvelle interface (ADR-0032, bridage P2).
- Les écrans et l'agent modifient déjà la formule par des opérations de frise
  (`updateCompetitionFormula`, ADR-0033) : c'est le seul endroit à adapter côté écriture.
- Arbitrages du 2026-11-25 :
  - **arbre** plutôt que graphe (Q3) ;
  - **sans migration de schéma** : la formule vit dans les réglages JSON de l'épreuve ;
  - **répartition du tour suivant** : réglage avancé du tour, défaut inchangé (Q4).

## Décision

**Modèle v2** (`src/shared/domain/formula/formulaV2.ts`, domaine pur)

```ts
interface FormulaV2 {
  version: 2;
  phases: FormulaPhaseV2[]; // dans l'ordre ; l'appel et le classement final sont implicites
  general: { restTimeSeconds: number; ruleSet?: 'modern' | 'laser' }; // ruleSet : arme « Autre »
}

type FormulaPhaseV2 = PoolRoundPhase | QuestPhase | TableauPhase | SplitPhase;

interface PoolRoundPhase {
  kind: 'pool';
  id: string;
  label?: string;
  sizeMin: number;
  sizeMax: number;
  maxScore: number;
  timerSeconds: number;
  scoring?: CustomScoringConfig; // barème à zones, arme « Autre »
  qualification: AdvancementRule; // vers la phase suivante : all, percentage, fixed_count, pool_winner…
  seeding: 'previous_round' | 'cumulative'; // Q4 : défaut previous_round (comportement actuel)
  boutOrder: 'fie' | 'free';
}

interface QuestPhase {
  kind: 'quest';
  id: string;
  hasPreliminaryPools: boolean;
  qualifiersCount?: number; /* … QuestPhaseConfig */
}

interface TableauPhase {
  kind: 'tableau';
  id: string;
  label?: string;
  maxScore: number;
  timerSeconds: number;
  thirdPlace: boolean;
  allPlaces: boolean;
  scoring?: CustomScoringConfig;
  stopAt?: number; // étape D : tableau arrêté à N tireurs (tableau intercalé)
}

interface SplitPhase {
  kind: 'split';
  id: string;
  criterion: 'gender' | 'category' | 'rank' | 'manual';
  branches: { label: string; phases: FormulaPhaseV2[] }[];
} // étape E
```

- **Arbre** : une suite de phases ; une scission porte ses branches, chacune suite de phases.
  Les exemptés et le tableau préliminaire de #1948 seront des réglages du tableau, pas des
  arêtes. `quest`, `stopAt` et `split` sont déclarés ici mais n'entrent dans la grammaire de
  la frise qu'aux étapes D et E.
- **Grammaire** : celle de la frise (ADR-0032), désormais définie sur `FormulaV2`. Les
  opérations de `updateCompetitionFormula` (ADR-0033) ne changent pas de forme ; `setPhase`
  accepte les réglages **de chaque tour**, plus seulement du premier.

**Stockage, sans migration de schéma**

- Nouvelle clé **`CompetitionSettings.formula`** (`FormulaV2`). Une seule clé pour toutes les
  armes : `customFormula` (v1) n'est plus écrite, seulement lue pour la conversion.
  - Écart assumé avec la formulation de l'arbitrage (« customFormula, version 2 ») : garder une
    clé dont le contenu change de forme selon la version obligerait chaque lecteur à tester la
    version, et `customFormula` laisse croire à une formule réservée à l'arme « Autre ».
- **Lecture** : `formulaOf(competition)` rend `settings.formula`, sinon la construit depuis les
  réglages plats (épée… Sabre Laser) ou depuis `customFormula` v1 (arme « Autre »). Fonction
  pure, testée sur des sauvegardes réelles : **une épreuve existante se déroule à l'identique**.
- **Écriture** : toute commande qui modifie la formule écrit `formula` **et** les réglages
  plats dérivés (`flatSettingsOf(formula)`, valeurs du premier tour et du tableau), tant que
  des lecteurs plats existent. Une version antérieure de l'application qui ouvre la base
  continue donc de fonctionner.
- Une épreuve existante ne reçoit `formula` qu'à sa prochaine modification de formule. Aucune
  réécriture de masse.

**Lecture par phase dans le moteur**

- Une seule entrée pour les lecteurs : `phaseSettings(formula, ref)` avec `ref` =
  `{ kind: 'pool', round }` ou `{ kind: 'tableau' }`. Elle rend touches, chrono, barème, taille
  de poule, qualification et répartition de la phase.
- Les lecteurs qui ont besoin du tour (feuilles de poule, tablettes, arène, préparation des
  poules, clôture du tour) le prennent dans l'état de session (`currentPoolRound`), déjà tenu
  par le moteur (`poolRound.ts`). Les lecteurs qui ne connaissent pas le tour gardent les
  réglages plats (valeurs du premier tour) jusqu'à leur passage à `phaseSettings`.
- Points d'entrée à faire passer par `phaseSettings` (recensement du 2026-11-25, hors
  tests) ; les autres lecteurs en dépendent :
  - moteur : `effectiveSettings` (`engine/commands/sport.ts`), qui appelle
    `resolveCompetitionSettings` (`shared/utils/customFormulaSettings.ts`), et la clôture du
    tour (`engine/commands/poolRound.ts`, qualifiés par tour) ;
  - tablettes et arène : `main/remote/sessionSettings.ts`, seul lecteur côté serveur distant
    (les pages `src/remote` ne lisent pas la formule) ;
  - écran : `useCompetitionCore` (`renderer/hooks/competitionView`), qui alimente la
    navigation, les poules et le tableau ;
  - appareils de piste : `main/cyrano/matchCoords.ts` (nombre de tours).
- Le bridage (ADR-0032) se lève **réglage par réglage**, une fois que tous ses lecteurs
  passent par `phaseSettings` ; un test liste les lecteurs plats restants (cliquet).

**Modèles de formule** (ADR-0033) : nouveau corps `{ kind: 'formula'; formula: FormulaV2 }`.
Les corps `draft` et `custom` restent lisibles et sont convertis à la lecture ; les modèles
fournis sont réécrits en v2.

## Conséquences

- Découpage en trois PR, chacune en draft sans auto-merge :
  1. **Modèle v2 et conversion** dans le domaine (`formulaV2.ts`, `formulaOf`,
     `flatSettingsOf`, `phaseSettings`), tests de non-régression sur des sauvegardes réelles.
     Aucun effet visible.
  2. **Moteur** : écriture de `formula` + plats par les commandes de formule ; lecteurs du
     moteur, des tablettes et de la préparation des poules par `phaseSettings`.
  3. **Écran (aperçu) et MCP** : réglages par tour ouverts dans la frise et dans `setPhase`,
     répartition du tour suivant (Q4) en réglage avancé.
- `FormulaDraft` et la frise sur deux modèles (ADR-0032) disparaissent à la fin de la PR 2 ; la
  frise ne connaît plus que `FormulaV2`.
- `getCompetitionFormula` rend `formula` ; ses champs `draft` / `customFormula` restent une
  version pour la compatibilité de l'agent, puis disparaissent à la 3.0.
- `docs/MCP.md` et `docs/API_CONTRACT.md` régénérés à chaque PR qui touche le contrat.

## Alternatives écartées

- **Graphe à arêtes** (#1948 d'origine) : plus général (consolante, repêchage), mais la frise
  deviendrait un éditeur de graphe et les contrôles S1 à S6 se compliquent ; les cas visés
  s'expriment comme réglages de phase dans un arbre.
- **Migration de schéma** réécrivant toutes les épreuves en v2 : irréversible une fois
  mergée, risquée sur des sauvegardes anciennes, inutile puisque la formule se construit à la
  lecture.
- **Réutiliser `customFormula` avec `version: 2`** : un même champ à deux formes, et un nom
  trompeur pour une formule commune à toutes les armes.
- **Ne plus écrire les réglages plats** : casserait les lecteurs non migrés et les versions
  antérieures de l'application.
