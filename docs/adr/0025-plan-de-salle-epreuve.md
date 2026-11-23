# ADR-0025 — Le plan de salle du planificateur est enregistré sur l'épreuve

- **Statut** : Acceptée (2026-11-23, choix du mainteneur : stockage sur l'épreuve)
- **Date** : 2026-11-23
- **Tickets** : #2075 (planificateur de placement d'arène Sabre Laser)
- **Remplace** : [ADR-0019](0019-plan-arene-salle.md)

## Contexte

Le planificateur de placement d'arène (#2075, `ArenaPlannerModal`) dessine un plan de site :
plusieurs salles (dimensions, marge, arènes, espacement, alignement, positions d'arènes glissées,
matériel placé, position sur la vue d'ensemble). Ce plan vit dans l'état de la fenêtre et
disparaît à la fermeture.

ADR-0019 proposait une disposition par salle (`venues.arena_layout`). Or le planificateur gère
plusieurs salles à la fois, sans lien avec les salles déclarées du poste, et l'organisateur veut
retrouver le plan **de son épreuve**.

Deux blocs existants sont écartés : `session_state` et `competitions.settings` sont réécrits en
entier par l'écran (sauvegarde de session, réglages lus en mémoire). Une clé ajoutée par une
commande y serait écrasée par la sauvegarde suivante.

## Décision

1. On enregistre le plan sur l'épreuve : colonne `competitions.arena_plan` (JSON texte,
   nullable), migration 48. Le moteur ne lit pas son contenu ; seul le planificateur
   l'interprète (géométrie dans `src/shared/domain/arena`).
2. On écrit par la commande `saveArenaPlan` (épreuve, plan ; `null` efface) et on lit par la
   requête `getArenaPlan` ([ADR-0008](0008-nommage-contrat.md)). Le plan est validé à l'entrée
   par un schéma zod du contrat (`ArenaPlanSchema`, version 1).
3. Pas de journal ni d'outil MCP : donnée de mise en page, sans règle ni effet sur le
   classement, comme `updateCompetitionDetails` ([ADR-0018](0018-commandes-inscription.md)).
4. Le planificateur ouvert avec une épreuve courante charge son plan et l'enregistre à chaque
   modification (temporisé). Ouvert sans épreuve, il reste en mémoire.

## Conséquences

- Le plan suit l'épreuve : archive `.bpm` (copie de la ligne), suppression de l'épreuve.
- Un plan n'est pas partagé entre épreuves : une journée à plusieurs épreuves redessine le plan
  sur chacune (copie possible plus tard).
- `competitions.venue_id` (migration 47, ADR-0023) reste indépendant du plan.
- Ajout compatible sans changer de version : un champ optionnel du plan (ex. `arenaNames`, noms
  des arènes par salle) reste en version 1 ; un plan ancien sans ce champ se lit tel quel.

## Alternatives écartées

- **Disposition sur la salle** (ADR-0019) : une salle par plan, alors que le planificateur en
  gère plusieurs ; plan à rattacher aux salles déclarées.
- **Clé dans `session_state` ou `settings`** : écrasée par les sauvegardes de l'écran.
