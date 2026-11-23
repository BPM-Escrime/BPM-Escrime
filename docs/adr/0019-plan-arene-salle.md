# ADR-0019 — Disposition d'arène rattachée à la salle, salle liée à la compétition

- **Statut** : Remplacée par ADR-0025
- **Date** : 2026-11-22
- **Tickets** : #2075 (planificateur de placement d'arène Sabre Laser)

## Contexte

Le planificateur de placement d'arène (#2075) calcule et dessine le plan d'une salle : dimensions,
arènes (maximum possible selon la marge et les zones bloquées), tables, prises, accessoires,
issues de secours et zones bloquées, avec rotation et redimensionnement. Aujourd'hui ce plan vit
dans l'état de la fenêtre et disparaît à la fermeture.

Il faut le **sauvegarder** et **associer une salle à une compétition**. La table `venues` (salle :
nom, pistes, Cyrano) existe déjà (migration ADR-0011, #1880) et sert à la journée multi-épreuves
et aux séances club. Une compétition n'y est pas rattachée.

## Décision proposée

1. **La disposition se stocke sur la salle.** Nouvelle colonne `venues.arena_layout` (JSON
   texte, nullable) : dimensions de la salle, marge, nombre d'arènes demandé, éléments placés
   (`RoomItem`, avec `rotationDeg`). Le JSON est validé à l'écriture par un schéma zod ; le
   moteur ne lit pas son contenu, seul le planificateur l'interprète (règle métier dans
   `src/shared/domain/arena`).
2. **La compétition référence sa salle.** Nouvelle colonne `competitions.venue_id` (nullable,
   `REFERENCES venues(id) ON DELETE SET NULL`). Une compétition sans salle reste valide.
3. **Écriture par commandes du contrat** ([ADR-0005](0005-journal-un-fait-un-chemin.md),
   [ADR-0008](0008-nommage-contrat.md)) : `save_venue_arena_layout` (salle, layout) et
   `set_competition_venue` (compétition, salle). Pas d'appel direct à la base depuis l'interface.
4. **Migration** : une nouvelle version de migration, citant cet ADR dans sa `description`
   ([ADR-0011](0011-migrations-schema-3-0.md)). Une migration mergée ne se modifie plus.

## Conséquences

- Une salle peut être réutilisée d'une compétition à l'autre, et d'une journée à l'autre.
- Les colonnes sont ajoutées sans changer les lignes existantes (valeurs `NULL`).
- Le JSON de disposition n'est pas indexé : pas de requête par élément.
- Export et sauvegarde `.bpm` : `venues` est déjà sauvegardée ; la colonne suit la même route.

## Alternatives écartées

- **Réglages de compétition en JSON, sans migration** : plus rapide, mais la disposition n'est
  pas réutilisable d'une compétition à l'autre, et l'association reste dans un JSON opaque.
- **Table `arena_layouts` séparée** : plus normalisée, mais inutile tant que la disposition n'est
  lue que par salle.

## À valider avant code

- Accepter cet ADR (statut « Acceptée ») : il est requis avant toute migration (ADR-0011).
- Confirmer le nom des commandes (ADR-0008) et le schéma zod du layout.
