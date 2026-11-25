# ADR-0032 — Formule : interface unique derrière un réglage expérimental du poste, réservé à l'écran

- **Statut** : Proposée
- **Date** : 2026-11-25
- **Tickets** : #2013 (étape B1, décisions D1 à D13), #1948 ; complète [ADR-0012](0012-formule-domaine.md) et [ADR-0022](0022-fonctions-du-poste-contrat.md)

## Contexte

Les décisions D1 à D13 de #2013 (2026-11-24 et 2026-11-25) fixent la cible :

- une seule interface de formule pour toutes les armes (D1) ;
- à la création, une formule repliée avec un résumé (D3) ;
- l'arme « À la carte » remplacée par « Autre », simple libellé (D4, D5) ;
- la formule modifiée depuis Organisation, plus dans les Propriétés (D11) ;
- des ＋ entre les phases, sans « + Classement » (D9, D10) ;
- une livraison au fil de l'eau dans `dev`, derrière un réglage expérimental (D13).

Deux contraintes du code :

- Jusqu'à l'étape C de #2013, il y a **deux modèles** de formule :
  - `FormulaDraft` (domaine, ADR-0012), écrit en réglages plats, pour l'épée, le fleuret, le sabre
    et le Sabre Laser ;
  - `CustomFormulaConfig`, pour l'arme `'C'`, réduit en réglages plats par
    `deriveSettingsFromFormula`. Ce modèle porte aussi les règles de qualification, le barème à
    zones, les règles de match (`ruleSet`) et le mode spécial des rapières.
- Le moteur ne doit suivre qu'un chemin par fait (« un fait, un chemin », #1979).

## Décision

- **Un réglage du poste `formulaPreview`** (booléen, défaut `false`) dans `AppSettings`. Il est
  lu et écrit par `getStationSettings` et `updateStationSettings` (ADR-0022), sans nouvelle
  opération. Son libellé est « Nouvelle interface de formule (aperçu) », dans Paramètres ▸ Système.
- **Le réglage n'agit que sur l'écran.** Le moteur, le contrat, le MCP et le mode headless ne le
  lisent jamais. Avec ou sans le réglage, une même formule produit les mêmes réglages enregistrés
  et le même déroulé.
- **Les opérations de la frise vivent dans le domaine** (`shared/domain/formula/formulaFrieze.ts`,
  dans la ligne de l'ADR-0012) :
  - la liste des phases affichées ;
  - les briques autorisées à chaque ＋ ;
  - l'insertion et le retrait d'une phase ;
  - le résumé sur une ligne ;
  - la normalisation d'une formule de l'arme `'C'`.

  Elles travaillent sur les deux modèles existants, sans en créer un troisième :
  - `FormulaDraft` pour les armes E, F, S et L ;
  - `CustomFormulaConfig` pour l'arme `'C'`.

  L'étape C remplacera les deux par le modèle unique, avec les mêmes opérations.

- **Grammaire bridée jusqu'à l'étape D**, pour ne rien afficher que le moteur n'exécute pas (P2) :
  - 1 à 5 tours de poules ;
  - puis le Tour Quest, au Sabre Laser seulement ;
  - puis au plus un tableau, toujours en dernier ;
  - le classement final est implicite et ne s'ajoute pas.
- **Normalisation de l'arme `'C'` à l'ouverture dans la nouvelle interface** : les phases
  `classification` sont retirées et seul le premier tableau est gardé, placé en dernier. C'est
  exactement ce que le moteur exécutait déjà (`deriveSettingsFromFormula`). Sans le réglage, la
  formule enregistrée n'est pas touchée.
- **L'arme `'C'` garde son code** ; seul son libellé devient « Autre » dans la nouvelle interface.
  Le barème à zones, les règles de match et le mode spécial y sont des réglages avancés (D5, D8).
- **Fin du réglage à la sortie de la 3.0** : le réglage, `PropertiesFormulaTab` en tant qu'onglet
  et le constructeur « À la carte » sont retirés.

## Conséquences

- Deux écrans coexistent jusqu'à la 3.0. L'E2E doit couvrir les deux.
- Une épreuve modifiée dans la nouvelle interface s'ouvre normalement dans l'ancienne : les deux
  écrivent les mêmes réglages. Le cas « formule non représentable dans l'ancien écran » ne
  survient qu'à partir de l'étape D, qui portera son message de lecture seule.
- Les modèles de formule (sélecteur, modèles fournis, modèles personnels par le contrat, D6, D7,
  D12) ne sont pas couverts ici. Ils relèvent de l'étape B2 et d'une ADR propre (Q22).
- Le verrou des phases commencées (P8) n'est pas ajouté par B1. Organisation ▸ Formule autorise
  les mêmes modifications que l'onglet Formule des Propriétés aujourd'hui.

## Alternatives écartées

- **Branche longue `feature/formule`** : pas de CI ni de pré-version sur `feature/**`, dérive par
  rapport à `dev`, risque de collision sur le numéro de migration, fusion finale trop grosse.
- **Réglage par épreuve** : une épreuve deviendrait illisible dans l'écran qu'un autre poste
  utilise. Le réglage décrit le poste, pas l'épreuve.
- **Réglage lu par le moteur** : deux chemins pour un même fait, tests doublés, et la migration de
  l'étape C ne se masque pas.
- **Étendre `FormulaBuilder` tel quel à toutes les armes** : il afficherait des options que le
  moteur n'exécute pas (P2).
