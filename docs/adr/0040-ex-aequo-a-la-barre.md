# ADR-0040 — Ex aequo à la barre de qualification : réglage du tour, proposé à l'exécution

- **Statut** : Acceptée (validée par le mainteneur le 2026-11-26) ; amendée le 2026-11-26 (nom du champ de `TableauGenerated` : `matches` ; tableau composé par l'écran, choix appliqué par `tableauCut` ; validé par le mainteneur) ; amendée le 2026-11-26 (tirage au sort `'draw'` d'après FIE o.73.2.f ; barrage F1b reporté, FIE o.73.3 ; validé par le mainteneur)
- **Date** : 2026-11-26
- **Tickets** : #2013 (étape F, lot F1 ; question Q8), #1948 ; précise [ADR-0036](0036-formule-v2-arbre-par-phase.md) (`AdvancementRule`), [ADR-0039](0039-scission-competitions-filles.md) (scission par rang)

## Contexte

- Trois coupes appliquent une règle de qualification (`AdvancementRule` : pourcentage, nombre,
  tableau) : passage au tour de poules suivant (`selectNextRoundFencers`), qualifiés du tableau
  (`applyTableauAdvancement`), scission par rang (`planSplit`, ADR-0039).
- Les trois gardent tous les ex aequo à la barre : 16 qualifiés demandés, 3 ex aequo à la 16ᵉ
  place → 18 qualifiés. Le code est écrit trois fois.
- BellePoule V6 et Fencing Time proposent un barrage au moment où les ex aequo dépassent le
  quota. Le règlement FFE prévoit le barrage ; beaucoup de compétitions locales départagent au
  classement d'entrée ou prennent tout le monde.
- Arbitrage du 2026-11-26 (Q8) : réglage sur la règle de qualification, proposition à
  l'exécution ; départage au classement initial livré d'abord.

## Décision

**Réglage `ties` de la règle de qualification**

- `AdvancementRule.ties?: 'all' | 'initial_ranking' | 'draw' | 'barrage'`, dans la formule
  (`settings.formula`, JSON, sans migration). Absent = `'all'`, comportement actuel : une
  formule existante ne change pas. _(Amendé le 2026-11-26 : remplace « `AdvancementRule.ties?:
'all' | 'initial_ranking' | 'barrage'` ».)_
- Réglage du tour de poules, du tableau et de la scission par rang, à côté du nombre de
  qualifiés, dans l'éditeur de formule.
- `'all'` : tous les ex aequo à la barre passent (quota dépassé).
- `'initial_ranking'` : les ex aequo à la barre sont départagés par le rang d'entrée du tour
  (classement initial au premier tour, place au tour précédent ensuite) ; le quota est tenu.
  Rang d'entrée égal ou absent : ordre du classement, puis nom.
- `'draw'` : les ex aequo à la barre sont départagés par tirage au sort (FIE o.73.2.f) ; le
  quota est tenu. Le hasard est injecté dans la coupe (ADR-0002 : `random` en paramètre de
  `cutAtBar`), tiré au moment de la coupe ; le résultat est figé par les événements de la coupe
  (ci-dessous) et n'est jamais retiré au rejeu. _(Ajout du 2026-11-26.)_
- `'barrage'` : les ex aequo à la barre sont départagés par un barrage (lot F1b, voir
  Conséquences).

**Une seule coupe, dans le domaine**

- `cutAtBar(ranking, count, ties, entryRank, random)` dans `shared/domain/ranking/advancement.ts`
  (domaine pur, ADR-0002) rend `{ qualified, eliminated, tiedAtBar }` ; `tiedAtBar` liste les
  ex aequo à la barre quand ils dépassent le quota (vide sinon). _(Amendé le 2026-11-26 :
  remplace « `cutAtBar(ranking, count, ties, entryRank)` » ; hasard injecté pour `'draw'`.)_
- `selectNextRoundFencers`, `applyTableauAdvancement` et la scission par rang l'appellent ;
  plus de boucle « ex aequo gardés » recopiée.

**Proposition à l'exécution**

- La simulation (`dryRun`) des commandes de coupe (`closePoolRound`, `generateTableau`,
  `splitCompetition`) rend `tiedAtBar` (identifiants, place, nombre de places restantes).
- L'écran affiche les ex aequo avant de confirmer et propose de garder le réglage ou d'en
  choisir un autre pour cette coupe seulement : champ optionnel `ties` de la commande, qui
  prime sur la formule. Pour le tableau, que l'écran compose (ADR-0017), le choix fait au
  passage au tableau est appliqué par la coupe du domaine (`tableauCut`, même fonction que le
  moteur), puis figé par `TableauGenerated` ; le champ `ties` de `generateTableau` sert au MCP
  et au tableau construit par le moteur. Le MCP passe le même champ (ADR-0008 : même
  commande). _(Amendé le 2026-11-26 : remplace « L'écran affiche les ex aequo avant de
  confirmer et propose de garder le réglage ou d'en choisir un autre pour cette coupe
  seulement : champ optionnel `ties` de la commande, qui prime sur la formule. Le MCP passe le
  même champ (ADR-0008 : même commande). »)_
- La coupe retenue est figée par les événements existants : `PoolRoundClosed`
  (`qualifiedIds`), `TableauGenerated` (`matches`), `GroupSplitOff` / `SplitRankingImported`.
  Aucun nouvel événement en F1. _(Amendé le 2026-11-26 : remplace « `TableauGenerated`
  (`slots`) » ; nom du champ de l'événement.)_

## Conséquences

- F1 livre `'all'` et `'initial_ranking'`, la proposition à l'exécution, l'éditeur et le MCP ;
  `'draw'` suit dans un lot F1c. `'barrage'` est refusé par la grammaire de la formule et par
  les commandes (`invalid_settings`). _(Amendé le 2026-11-26 : remplace « F1 livre `'all'` et
  `'initial_ranking'`, la proposition à l'exécution, l'éditeur et le MCP. `'barrage'` est
  refusé par la grammaire de la formule et par les commandes (`invalid_settings`) jusqu'au lot
  F1b. »)_
- Barrage (F1b) reporté (arbitrage du 2026-11-26) : la règle FIE par défaut est « tous
  qualifiés » (o.73.3) ; le barrage en 5 touches de la FIE (o.86.2) vise la 16ᵉ place exemptée du
  tableau préliminaire, et le livret 2 du Sabre Laser ne fixe ni format ni score. Il reviendra
  avec un cas réel (pré-tournoi laser, exemptés du tableau), par un amendement validé avant le
  code : format, état de session, événements (ADR-0007), tablettes. _(Amendé le 2026-11-26 :
  remplace « F1b (barrage) demande un amendement validé avant le code : format des matchs de
  barrage (poule des ex aequo ou matchs à une touche), état de session, événements (ADR-0007),
  tablettes. »)_
- Les PDF et le classement final ne changent pas : ils lisent la coupe figée.
- Chaque PR en draft, sans auto-merge (ticket `refactor`).

## Alternatives écartées

- **Barrage, brique de la frise** (variante de Q8) : déclaré à l'avance alors qu'il n'a lieu
  que s'il y a des ex aequo ; la frise afficherait une phase souvent vide.
- **Garder trois coupes** et ajouter le réglage à chacune : trois chemins pour un même fait,
  contraire à ADR-0002.
- **Départage par l'indice** : l'indice est déjà le critère du classement (les ex aequo l'ont
  égal). _(Amendé le 2026-11-26 : remplace « **Départage par l'indice ou le tirage au sort** :
  l'indice est déjà le critère du classement (les ex aequo l'ont égal) ; le tirage au sort n'est
  pas reproductible au rejeu sans hasard injecté et figé. » ; le tirage au sort est retenu,
  hasard injecté et résultat figé par les événements de la coupe.)_
