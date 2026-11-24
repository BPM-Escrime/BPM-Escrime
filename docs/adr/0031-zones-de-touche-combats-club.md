# ADR-0031 — Les zones de touche des combats du Mode Club sont enregistrées sur le combat

- **Statut** : Proposée
- **Date** : 2026-11-24
- **Tickets** : Mode Club #1872 (statistiques Sabre Laser) ; complète [ADR-0022](0022-fonctions-du-poste-contrat.md), soumise à [ADR-0011](0011-migrations-schema-3-0.md)

## Contexte

En compétition, la fiche d'un tireur de Sabre Laser montre deux mannequins : touches portées et
touches reçues, par zone (A = 1 pt, B = 3 pts, C = 5 pts). Les zones viennent de
`match_touches`, écrites par `recordMatchEvents` à la fin du match.

Le Mode Club fait tirer ses combats sur les tablettes du serveur d'entraînement. La tablette
remonte la même liste de zones (`arenaTouches`, `touchesA` / `touchesB`), mais en mode
entraînement rien n'est écrit en base : `onClubRemoteFinish` (`clubPort.ts`) ne garde que le
score et la durée. `club_bouts` n'a aucune colonne pour les zones, et `match_touches` dépend de
`matches` (clé étrangère). Les statistiques du club n'ont donc ni répartition par zone ni
mannequin.

## Décision

- **Migration 51** : deux colonnes nullables sur `club_bouts`, `zones_a TEXT` et `zones_b TEXT`.
  Chacune contient les zones des touches portées par le membre A (resp. B), dans l'ordre, une
  lettre par touche (`"ABAC"`). `NULL` : zones inconnues (saisie manuelle, arme sans zones,
  combats antérieurs). Seules les lettres `A`, `B`, `C` sont gardées, au plus 200 par côté.
- Le score reste la référence ; les zones sont une donnée de traçabilité, sans effet sur le
  vainqueur ni sur l'indice.
- `onClubRemoteFinish` passe les zones de la tablette à `finishBout` (`ClubBoutResult.zonesA` /
  `zonesB`, optionnels). Une saisie sans zones conserve les zones déjà enregistrées.
- Pas de nouvelle opération du contrat : `finishClubBout` (écran, MCP) n'accepte pas de zones ;
  `ClubBout` expose `zonesA` / `zonesB`, et `ClubMemberStats` les comptes par zone portés et
  reçus (`zonesScored`, `zonesReceived`), calculés par `computeMemberStats` (fonction pure).
- Sauvegardes `.bpclub` et synchronisation : copie générique des colonnes, rien à changer ;
  une sauvegarde plus ancienne se restaure avec des zones nulles. Purge RGPD : la ligne entière
  part avec le membre, comme aujourd'hui.

## Conséquences

- La fiche d'un membre montre les deux mannequins (portées / reçues) dès qu'au moins une zone
  est connue sur la période ; le classement n'est pas changé.
- Les combats déjà tirés restent sans zones.
- Une table d'événements par touche (horodatage, annulation) reste possible plus tard ; elle
  reprendrait ces deux colonnes.

## Alternatives écartées

- **Réutiliser `match_touches`** : clé étrangère vers `matches`, et données d'épreuve purgées
  avec elle ; le club n'a pas d'épreuve.
- **Six colonnes de comptes** (A, B, C par côté) : perd l'ordre des touches, sans gain notable
  pour l'agrégation, faite en TypeScript.
- **Table `club_bout_touches`** : plus lourde (purges, sauvegardes, synchro) pour un besoin de
  comptage seul.
