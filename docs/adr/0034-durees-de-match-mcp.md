# ADR-0034 — Les durées de match de référence sont lisibles par l'agent MCP

- **Statut** : Proposée
- **Date** : 2026-11-25
- **Tickets** : #1965 (lot 4), #1958 ; complète [ADR-0022](0022-fonctions-du-poste-contrat.md) et [ADR-0033](0033-modeles-de-formule.md)

## Contexte

- #1965 donne une seule source des durées de match : référence (réglage du DT > historique du
  poste ≥ 30 matchs > défaut), ajustée en direct (`shared/domain/durations`). Lots 1 à 3 livrés :
  simulation de formule, heure de fin de phase, indicateurs, écran de réglage, historique.
- Le lot 4 expose ces durées à l'agent MCP (« outil d'état de la salle ») et au planning #1958.
- `getMatchDurations` porte le droit `station:admin`. L'ADR-0022 interdit tout outil MCP aux
  opérations du poste ; seule exception à ce jour : `list_formula_templates` (ADR-0033).
- L'heure de fin de phase est calculée par le serveur distant (`computePhaseEta`, dashboard).

## Décision

- **Un outil MCP en lecture** : `get_match_durations` (`getMatchDurations`). Seconde exception à la
  règle « station:admin, pas d'outil MCP » : les durées sont des agrégats (médiane, 80ᵉ centile,
  nombre de matchs par clé), sans donnée personnelle, ni secret, ni effet externe.
- `updateMatchDurationSettings`, `recordMatchDurationHistory` et `resetMatchDurationHistory`
  restent réservées à l'écran : l'agent ne règle ni n'efface rien.
- **`server_status`** (outil d'état de la salle, déjà en lecture) ajoute `phaseEta` par serveur
  actif : la fin estimée de la phase en cours, **même calcul que le dashboard**
  (`computePhaseEta`), `null` sans séance ouverte.
- Toujours refusé sur le WebSocket (ADR-0022) : rien ne change pour le réseau.
- Garde-fou : `wsLocalRefusal.test.ts` liste `getMatchDurations` parmi les exceptions d'ADR.

## Conséquences

- L'agent peut répondre « quand finit la phase ? » et « combien dure une poule d'épée ici ? »
  avec les chiffres de l'écran.
- Toute autre opération du poste exposée au MCP demande encore sa propre ADR.
