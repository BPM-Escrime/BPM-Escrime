# ADR-0026 — Une chorégraphie est un document versionné de la bibliothèque du poste, compatible `.chore`

- **Statut** : Proposée
- **Date** : 2026-11-23
- **Tickets** : #2164 (éditeur de chorégraphies, escrime artistique et sabre laser)

## Contexte

Les épreuves chorégraphiées n'ont aucun outil qui relie l'écriture, le règlement et le jury :

- **Escrime artistique** ([règlement national M17 CFEA26][cfea]) : phrases d'armes faites de
  passes (action / réaction), difficulté par phrase (×1 / ×1,1 / ×1,2), temps de combat
  minimum, structure de la chorégraphie remise au jury **en fichier Excel libre**.
- **Sabre laser, épreuve technique** : partition papier de 6 cellules (une forme imposée
  chacune) reliées par des connexions libres ; notation par passe.
- **Éditeur Chorégraphique ASL-FFE** ([viickel][viickel], PyQt6, GPL-3.0) : utilisé par les
  clubs ASL. Modèle à trois niveaux : phrase d'armes → action (un instant T) → mouvement de
  chaque combattant (main droite, main gauche, zone, cible, déplacement, commentaire). Fichier
  `.chore` en XML, rétrocompatible avec sa V1 VB.NET. Vocabulaire dans `OptionsMouvements.csv`.
  Ni action imposée, ni difficulté, ni temps, ni lien avec la compétition.

Une chorégraphie s'écrit en club, des semaines avant l'épreuve, se modifie en entier (on
déplace des phrases, on réordonne des actions) et s'échange par fichier. Aucune requête n'a
besoin de chercher une action précise dans la base.

[cfea]: https://www.ffescrime.fr/wp-content/uploads/2026/02/REGLEMENT-NATIONAL-M17_-CFEA26.pdf
[viickel]: https://github.com/viickel/Editeur-Chor-graphique-ASL-FFE

## Décision

1. **Modèle pur** dans `src/shared/domain/choreography/` ([ADR-0002](0002-couches-et-dependances.md)).
   Il reprend les trois niveaux du `.chore` et ajoute ce qui manque :
   - séquence typée : `phrase` | `cell` (forme imposée) | `connection` | `stage` (jeu) | `salute` ;
   - sur chaque mouvement : rôle dans la passe (`action` / `reaction`), niveau de la technique
     (`simple` / `compound` / `advanced`), référence d'imposé (forme, brique, passe) ;
   - temps facultatifs par séquence (début, fin, pause) ;
   - discipline (`artistic`, `laserTechnical`, `laserChoreography`), format (solo, duel,
     ensemble, bataille ; catégorie déduite du nombre de combattants, règle du `.chore`).
2. **Document versionné** : le modèle est validé par un schéma zod du contrat
   (`ChoreographySchema`, `schemaVersion: 1`). Ajouter un champ optionnel ne change pas de
   version ; une version ancienne se lit telle quelle ([ADR-0025](0025-plan-de-salle-epreuve.md),
   même principe).
3. **Stockage** : table `choreographies` (migration 49) — `id`, `club_id` (nullable, lien
   Mode Club), `title`, `discipline`, `document` (JSON texte), `revision`, `created_at`,
   `updated_at`. Une ligne par chorégraphie ; pas de tables par phrase, action ou mouvement.
4. **Opérations du contrat** ([ADR-0008](0008-nommage-contrat.md)), droits `club:read` /
   `club:write`, fonctions du poste sans journal ([ADR-0022](0022-fonctions-du-poste-contrat.md)) :
   `listChoreographies`, `getChoreography`, `createChoreography`, `updateChoreography`
   (document entier, `expectedRevision`, [ADR-0006](0006-expected-revision.md)),
   `deleteChoreography`, `importChoreography`, `exportChoreography`.
   Le moteur valide le document à chaque écriture (même règle que la formule,
   [ADR-0012](0012-formule-domaine.md)).
5. **Échanges, en contenu et jamais en chemin** ([ADR-0021](0021-services-plateforme.md)) :
   - `.chore` (XML V1/V2) en lecture et en écriture. Lecteur et écrivain purs dans le domaine
     (texte ↔ document, sans DOM ni Node), échappement par fonction, jamais par expression
     régulière de nettoyage. Les champs propres à BPM sont écrits dans des balises que
     l'éditeur viickel ignore ; un aller-retour par lui les perd, sans casser le fichier ;
   - `.bpchoreo` : le document JSON tel quel ;
   - `OptionsMouvements.csv` : importé comme vocabulaire du club.
6. **Vocabulaire** : le mouvement garde son texte libre. La bibliothèque (vocabulaire ASL par
   défaut, repris du CSV viickel avec attribution, plus le vocabulaire du club) ne fait que
   proposer et porter le niveau par défaut de chaque technique.
7. **Contrôles réglementaires** : fonctions pures par discipline et par saison
   (`choreography/rules/`), qui rendent des **avertissements** (difficulté, passes, temps,
   répartition des armes, cellules). Ils n'empêchent jamais d'enregistrer.

## Conséquences

- Une migration (49). L'archive `.bpclub` (sauvegarde du club) doit inclure ses chorégraphies.
- Une chorégraphie n'est **pas** une donnée d'épreuve : pas de journal, pas de serveur distant,
  pas d'outil MCP d'écriture tant que les droits du poste ne sont pas servis.
- **Hors périmètre, ADR à venir** : l'épreuve « performance » (engagement d'une chorégraphie,
  copie figée à la clôture, feuille de juge sur tablette, chrono du temps de combat, notes et
  classement). Elle touchera le journal (événements) et le transport réseau.
- Le règlement change chaque saison : les contrôles sont datés, pas codés dans l'écran.
- Reprise du vocabulaire viickel : GPL-3.0 des deux côtés, attribution dans le fichier source.

## Alternatives écartées

- **Tables normalisées** (phrases, actions, mouvements) — l'édition réécrit tout le document,
  aucune requête ne porte sur une action, et le format d'échange redevient un document ;
  quatre tables et leurs jointures sans gain.
- **Colonne JSON sur l'épreuve** (comme `arena_plan`) — la chorégraphie existe avant
  l'épreuve et sert à plusieurs ; elle appartient au club, pas à une épreuve.
- **Format `.chore` seul, sans document BPM** — il ne porte ni imposé, ni difficulté, ni temps ;
  l'étendre sans accord de son auteur casserait la compatibilité dans l'autre sens.
- **Intégrer l'éditeur viickel tel quel** (Python, Qt) — autre pile, pas de contrat, pas de
  tablettes ; on reprend son modèle et son format, pas son code.
- **Contrôles bloquants** — une chorégraphie en cours d'écriture est toujours hors règlement.
