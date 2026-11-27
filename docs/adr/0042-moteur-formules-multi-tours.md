# ADR-0042 — Le moteur pilote les formules à plusieurs tours : tirage des tours suivants et tableau, ouverts au MCP

- **Statut** : Acceptée (validée par le mainteneur le 2026-11-26) ; amendée le 2026-11-26 (un seul tableau : refus après la clôture d'un tableau arrêté ; outil MCP `close_tableau_stage` ; validé par le mainteneur) ; amendée le 2026-11-27 (F4e : `assertSupported` ne refuse plus que les épreuves par équipes, rapières pilotées au MCP ; validé par le mainteneur)
- **Date** : 2026-11-26
- **Tickets** : #2013 (étape F, lot F3), #1880, #1948 ; amende [ADR-0037](0037-deroule-genere-par-la-formule.md) (Conséquences, MCP), s'appuie sur [ADR-0017](0017-projections-etat-epreuve.md) et [ADR-0036](0036-formule-v2-arbre-par-phase.md) (Q4 : répartition du tour)

## Contexte

- `assertSupported` (`src/main/engine/commands/sport.ts`) refuse `unsupported_format` dès
  qu'une épreuve a plus d'un tour de poules : `generatePools`, `generateTableau`,
  `assignPoolReferees` et `assignPoolReferee` n'acceptent alors qu'un placement composé par
  l'écran. L'agent MCP ne peut pas conduire une formule à plusieurs tours.
- L'écran tire les tours suivants avec des fonctions partagées : `seedRankingForNextRound`
  (classement qui répartit, Q4 : tour précédent ou cumul ; tableau arrêté, ADR-0037), puis
  `seedFencersFromRanking` et le tirage serpentin. Le tableau après plusieurs
  tours se tire sur le classement de l'état de session (`overallRanking`, tous tours).
- ADR-0037 (Conséquences, amendée le 2026-11-26) : seule `split_competition` est ouverte au
  MCP après plusieurs tours ; le reste « relève de l'étape F ».
- Arbitrage du 2026-11-26 : ouvrir au moteur.

## Décision

- Le moteur tire lui-même un tour suivant (`generatePools` sans composition, tour ≥ 2) :
  tireurs pointés, répartis sur `seedRankingForNextRound` puis `seedFencersFromRanking`, tirage
  du tour 1 (`buildPools`, hasard injecté), tailles et réglages du tour lus dans la
  formule (`phaseSettings`). Mêmes fonctions que l'écran : écran et moteur tirent pareil à
  hasard égal.
- Le moteur construit le tableau après plusieurs tours, y compris un tableau arrêté
  (`generateTableau` sans composition), sur le classement retenu (`tableauRanking`, coupe
  d'ADR-0040). La formule n'a qu'un tableau : après la clôture d'un tableau arrêté
  (`closeTableauStage`, outil MCP `close_tableau_stage`), plus de tableau (ADR-0037) et
  `generateTableau` refuse (`no_direct_elimination`). _(Amendé le 2026-11-26 : remplace « Le
  moteur construit le tableau après plusieurs tours ou après un tableau arrêté
  (`generateTableau` sans composition) sur le classement retenu (`tableauRanking`, coupe
  d'ADR-0040). »)_
- L'affectation des arbitres (`assignPoolReferees`, `assignPoolReferee`) suit le tour courant.
- `assertSupported` ne refuse plus que les épreuves par équipes. _(Amendé le 2026-11-27, lot
  F4e : remplace « `assertSupported` ne refuse plus que les épreuves par équipes et le mode
  spécial (rapières). » ; le Tournoi des rapières est une formule en briques, ADR-0043 ; le MCP
  pilote le tirage et les vagues.)_
  ADR-0037, Conséquences, est amendée en conséquence (phrase réécrite à sa place).
- Aucun nouvel événement : `PoolsGenerated`, `TableauGenerated` et `PoolRoundClosed` portent
  déjà le tour et le placement complet (ADR-0017).

## Conséquences

- Lot F3 : moteur (tirage des tours suivants, tableau), levée du refus, tests de bout en bout
  par le contrat (formule à deux tours, tableau arrêté puis tour, scission), description des
  outils MCP et `docs/MCP.md` régénérés.
- Le placement composé par l'écran reste admis (`composition`), tel quel.
- Les épreuves par équipes (relais) restent refusées au MCP jusqu'à leurs propres lots ; les
  rapières sont pilotées depuis F4e. _(Amendé le 2026-11-27 : remplace « Rapières et équipes
  restent refusées au MCP jusqu'à F4 (rapières) et leurs propres lots. »)_
- Chaque PR en draft, sans auto-merge (ticket `refactor`).

## Alternatives écartées

- **Garder le refus** : l'agent ne peut pas conduire une formule à plusieurs tours, alors que
  les fonctions de tirage sont déjà partagées et pures.
- **Tirage propre au moteur** : deux tirages différents pour un même fait, contraire à
  ADR-0002 et à « même commande » (ADR-0008).
