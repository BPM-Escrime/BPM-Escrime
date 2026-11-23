# Compétitions par équipes

## Principe général (règlement FIE)

Une compétition par équipes oppose des équipes de **N tireurs titulaires** (+ un nombre
configurable de réservistes). Un match d'équipe se dispute en **relais** : chaque
titulaire d'une équipe affronte chaque titulaire de l'équipe adverse exactement une
fois, soit **N² relais** au total (9 relais pour des équipes de 3, conformément au
règlement FIE).

**Ordre des relais** (`relayOrderFor`, `teamCalculations.ts`) :

| Arme                                                                                          | Ordre                                                                                                                                    |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Épée, fleuret, sabre (3 titulaires)                                                           | Ordre officiel FIE (Règlement d'organisation, o.99.3) : 3-6, 1-5, 2-4, 1-6, 3-4, 2-5, 1-4, 2-6, 3-5 (équipe A = 1-2-3, équipe B = 4-5-6) |
| Sabre Laser (règlement ASL-FFE, relais et arène), arme à la carte, autre nombre de titulaires | Rotation diagonale : 1-4, 2-5, 3-6, 1-5, 2-6, 3-4, 1-6, 2-4, 3-5                                                                         |

Le choix est fait à la création des rencontres : les rencontres déjà générées gardent leur ordre.

Les relais sont **progressifs** : le score de la rencontre est le cumul des touches
(ou points) marqués par chaque équipe sur l'ensemble des relais déjà joués. Chaque
relais s'arrête dès que le cumul d'une équipe atteint le palier de ce relais
(5-10-15-…-45 pour des équipes de 3, par paliers de 5), ou à la fin du temps imparti.
L'équipe qui atteint la cible totale la première (45 pour des équipes de 3), ou qui a
le plus de touches à la fin du temps réglementaire, gagne la rencontre.

## Ce qui change selon l'arme

Le système ne traite pas toutes les armes de la même façon :

- **Épée** : pas de priorité — une touche double simultanée est possible et compte
  pour les deux équipes. Un bouton dédié « ⚔ double » permet de l'enregistrer.
- **Fleuret / Sabre** : priorité classique, une seule équipe marque par touche.
  Les cartons (pénalités) peuvent être enregistrés par tireur pendant un relais,
  avec l'escalade habituelle (blanc → jaune → rouge → noir selon le motif).
- **Sabre Laser** : arme spécifique à ce projet (zones A/B/C = 1/3/5 points), sans
  équivalent dans le règlement FIE. Deux modes sont possibles au choix de
  l'organisateur (voir plus bas) :
  - **Touches** (par défaut) : chaque touche compte pour 1, comme les autres armes.
  - **Points** : chaque touche compte pour la valeur de sa zone (1/3/5), avec un
    sélecteur de zone dédié lors de la saisie.

## Format arène Sabre Laser équipe (ASL-FFE)

Un second format, spécifique au Sabre Laser, est disponible en plus du relais
FIE ci-dessus : `competition.settings.teamFormat = 'laser-arena'` (défaut :
`'fie-relay'`, aucun changement de comportement). Il suit le règlement
épreuve par équipe transmis par l'ASL-FFE, structurellement différent du
relais FIE :

- **Assaut plafonné** : 5 touches valides cumulées (les deux côtés) ou 3
  minutes, quel que soit le numéro de l'assaut — pas de cible progressive
  5→10→…→45.
- **Score de rencontre** = total des points marqués sur les 9 (ou N²)
  assauts, pas le nombre d'assauts gagnés.
- **Classement de poule** trié par points marqués cumulés en premier critère
  (pas par nombre de victoires), puis ratio marqués/reçus, puis égalité
  signalée pour tirage au sort manuel (`tied`, jamais résolu par le
  logiciel).
- **Cartons d'équipe « E »** (blanc/jaune/rouge/noir) pour retard de
  désignation d'un combattant : persistés en base (table
  `team_match_cards`), cumulables sur les 9 assauts d'une rencontre —
  traçabilité uniquement, sans impact automatique sur le score (le club n'a
  pas encore tranché la valeur en points).
- **Calendriers de poule figés** pour 8 ou 12 équipes (3 poules A/B/C de 4
  ou 2 poules de 4), avec désignation d'équipe(s) assesseur(s) par round,
  transcrits du règlement.
- **Évitement de revanche** au 1er tour du tableau : si les équipes classées
  5/6 ou 7/8 tombent contre une équipe déjà rencontrée en poule, échange de
  leurs places.
- **Saisie temps réel** sur tablette : `http://IP:8066/equipe{N}` (affichage
  arène) et `http://IP:8066/equipe{N}/arbitre` (tablette arbitre — compteur
  de touches déclenchant automatiquement le passage au relais suivant,
  boutons cartons E, minuteur 3 min).

Fichiers clés : `src/features/teams/utils/laserArenaCalculations.ts`
(score/plafond/classement), `laserArenaPoolSchedules.ts` (calendriers
figés), `laserArenaBracketRules.ts` (évitement de revanche),
`teamCardEscalation.ts` (échelle blanc→jaune), `src/remote/teamArena.html` /
`teamReferee.html` (interfaces distantes).

## Activer une compétition par équipes

Une compétition devient une compétition par équipes en positionnant
`competition.isTeamEvent = true` (case à cocher lors de la création). Les options
suivantes, dans `competition.settings`, ajustent le format :

| Champ               | Défaut        | Effet                                                                                                                      |
| ------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `minTeamSize`       | `3`           | Nombre de titulaires par équipe (généralise le format FIE 3v3)                                                             |
| `teamReserveCount`  | `1`           | Nombre de réservistes autorisés par équipe                                                                                 |
| `laserTeamMode`     | `'touches'`   | Sabre Laser uniquement : `'touches'` ou `'points'` (zones)                                                                 |
| `teamRelayStepSize` | `5`           | Palier de progression par relais (avancé — laisser à 5 sauf besoin spécifique)                                             |
| `teamFormat`        | `'fie-relay'` | Sabre Laser + équipe uniquement : `'fie-relay'` (défaut, ci-dessus) ou `'laser-arena'` (règlement ASL-FFE, voir plus haut) |

La cible totale de la rencontre se déduit automatiquement (relais FIE uniquement) :
`teamRelayStepSize × minTeamSize²` (45 pour le format FIE par défaut : 5×3²).

## Utilisation

Quand `isTeamEvent` est actif, la navigation des phases devient
**Appel → Équipes → Poule équipes → Tableau équipes → Classement équipes** (les
phases individuelles poules/tableau disparaissent). Après l'appel, « Composer les
équipes » ouvre la phase Équipes. Chaque phase propose « Exporter PDF ».

1. **Équipes** : créer les équipes, affecter les tireurs (position 1..`minTeamSize`
   pour les titulaires, jusqu'à `teamReserveCount` réservistes).
2. **Poule** : « Générer la poule » tire les rencontres (commande `generateTeamPools`),
   toutes les équipes devant être complètes, avec leurs relais. La saisie se fait relais
   par relais (bouton « Scorer ») : seul le relais en cours se saisit ; « + » / « − »
   comptent les touches à l'écran (non enregistrées), avec les affordances de l'arme
   décrites ci-dessus. Le relais se termine au palier, ou par « Terminer le relais » :
   son score part au moteur (`recordRelayScore`). Le dernier relais terminé se rouvre
   pour correction (`reopenRelay`, score repris). « Faire entrer le remplaçant » remplace
   un tireur dans les relais à tirer (`substituteTeamFencer`). Égalité au dernier relais du
   tableau : l'écran demande le vainqueur (minute avec priorité).
3. **Tableau** : rien n'est créé à l'ouverture. Les poules terminées, « Générer le
   tableau » le tire (`generateTeamTableau`, têtes de série = classement de poule). Les
   tours suivants se créent dans le moteur au fur et à mesure des résultats ; « Tirer de
   nouveau le tableau » le refait tant qu'aucun relais n'y est joué.
4. **Classement** : classement des équipes (victoires, relais individuels
   gagnés/perdus, touches cumulées), exportable en CSV et PDF.

## Limites connues

**Relais FIE (`teamFormat: 'fie-relay'`, défaut) :**

- **Saisie tablette** : « 📡 Arène » envoie la rencontre sur `/equipe{N}/arbitre`
  (affichage `/equipe{N}`). La tablette affiche le score d'équipe cumulé, le palier
  du relais en cours (5-10-15…, plafonné à la cible) et le chrono 3 min ; « Relais
  suivant » persiste le relais (vainqueur = équipe en tête au cumul). L'application
  se met à jour au rechargement de la phase.
- **Cartons individuels persistés** (table `team_bout_cards`) : saisis dans
  l'application ou depuis la tablette (motif + escalade identique à l'individuel).
  Pas d'impact automatique sur le score.

**Les deux formats :**

- Remplacement en cours de match : c'est toujours le premier remplaçant de l'équipe qui
  entre, un seul par équipe et par rencontre (o.99.5, o.99.6).
- Passage au moteur en cours ([ADR-0024](adr/0024-tableaux-separes-equipes-moteur.md)) :
  inscription des équipes, composition et tirage des poules existent comme commandes du
  contrat (`registerTeam`, `assignTeamFencer`, `generateTeamPools`, outil MCP
  `generate_team_pools` ; lot E1), et `getCompetitionState` rend le bloc `teams`. Lot E2 :
  tableau d'équipes, score de chaque relais, réouverture du dernier relais et remplaçant
  par commandes (`generateTeamTableau`, `recordRelayScore`, `reopenRelay`,
  `substituteTeamFencer` ; outils MCP `generate_team_tableau`, `record_relay_score`,
  `reopen_relay`, `substitute_team_fencer`), journalisées et rejouées. Lot E3 : l'écran
  n'écrit plus que par ces commandes et lit le bloc `teams` (le moteur fait foi : totaux,
  classement, avancement du tableau) ; la composition est figée dès le tirage (refus
  `draw_done`). La tablette `/equipe{N}` et les appareils de piste écrivent par la base
  jusqu'au lot E4 ; l'écran se met à jour sur leurs signaux. Les cartons (individuels des
  relais, « E » d'équipe) restent hors du moteur.
- Épreuve créée avant le lot E1 : équipes, rencontres et relais en base sont repris tels
  quels ; un relais en cours garde son score, qui devient le compteur de l'écran. Un
  tableau dont les poules sont finies mais pas encore créé se tire par le bouton. Le relais
  en cours est le premier non terminé : un relais terminé hors ordre par l'ancien écran se
  rouvre d'abord.
- Sabre Laser en mode points : le compteur de l'écran s'arrête au palier du relais (une
  zone qui le dépasserait est ramenée au palier), le moteur refusant un cumul au-delà.
- Moteur : une égalité au dernier relais est admise en poule (pas de vainqueur) ; au tableau,
  le vainqueur est donné (`winner`, minute avec priorité). Un relais de poule peut être
  rouvert après le tirage du tableau, qui garde son placement.

**Format arène Sabre Laser (`teamFormat: 'laser-arena'`) uniquement :**

- Les cartons d'équipe « E » n'ont **pas encore d'impact automatique sur le score** —
  traçabilité seule, en attendant que le club tranche la valeur en points.
- La génération automatique de la poule (calendrier figé + assesseurs) n'est
  disponible que pour **8 ou 12 équipes** ; pour tout autre effectif, aucune
  génération automatique n'est proposée (saisie manuelle des équipes).
- L'affectation aux poules A/B/C se fait dans l'ordre de création des équipes (pas
  de champ de poule explicite dans l'UI).
