# ADR-0038 — Appareil Cyrano sans HELLO (Saint-George SG31 / SG32)

- **Statut** : Acceptée
- **Date** : 2026-11-25
- **Tickets** : #1720, #1829 ; complète [ADR-0023](0023-appareils-de-piste-salle.md)

## Contexte

- La spécification Cyrano (§ 3) prévoit un `HELLO` du logiciel toutes les 15 s ; BPM - Escrime en
  envoie aussi un derrière chaque affichage libre, pour obtenir un `INFO` en accusé.
- Essai sur les 12 Saint-George SG32 de la salle NEC (2026-11-25), trames émises depuis le port
  50100 comme le pilote : un **seul `HELLO`** bloque le chrono de l'appareil. BEGIN / STOP / GO
  de la télécommande ne lancent plus rien jusqu'au redémarrage de l'appareil. Un `DISP`, vide ou
  avec un match, ne bloque rien.
- Le SG32 émet seul un `INFO` toutes les 4 s environ : le `HELLO` ne lui sert à rien pour être
  supervisé.

## Décision

- La déclaration d'un appareil Cyrano (`venue_strips.device_config`, ADR-0023) gagne un champ
  facultatif **`hello`**. `false` : le pilote n'envoie **aucun** `HELLO` à cet appareil (ni au
  démarrage, ni au battement, ni derrière un affichage libre). Absent : comportement inchangé.
- Le profil constructeur **Saint-George** de l'ajout en lot pose `hello: false`.
- Supervision inchangée : statut calculé sur la dernière trame reçue.
- Pas de migration : colonne JSON existante, champ facultatif. Contrat : `StripDeviceSchema`
  (`setStripDevices`, `importStripDevices`, fichier d'export) accepte le champ.

### Complément (2026-11-25) : envoi des HELLO choisi au démarrage du pilote

- Lecture de la spécification (§ 3, § 4) : le `HELLO` signale que le logiciel est en ligne. Le
  SG32 passe alors en mode Cyrano : machine à états, chrono seulement en état actif, donc
  **BEGIN** (éventuellement avec ALT, § 4) avant GO. Sans `HELLO`, il reste autonome. Les deux
  conduites se défendent tant que la recette en salle ne les a pas départagées.
- `startCyranoServer` gagne un champ facultatif **`hello`** : `device` (défaut : selon la
  déclaration de chaque appareil), `always` (à tous, spécification), `never` (à aucun).
  `getCyranoStatus` renvoie le mode en vigueur. Choisi dans le cadre « Pilotes des appareils »
  (Paramètres → Salles et pistes), mémorisé sur le poste, repris par le démarrage automatique.
- Le mode vaut jusqu'à l'arrêt du pilote ; un démarrage alors que le pilote tourne ne le change pas.

## Conséquences

- Une salle Saint-George déjà déclarée doit être redéclarée avec le profil (ajout en lot) ou par
  import d'un fichier portant `"hello": false`.
- Un appareil sans `HELLO` qui ne parle pas spontanément resterait « jamais vu » : le champ n'est
  posé que par le profil Saint-George.
- La version `auto` d'un tel appareil se déduit de ses `INFO` spontanés, sans alternance de
  `HELLO`.

## Alternatives écartées

- Ne plus envoyer de `HELLO` aux pistes déjà entendues — le premier `HELLO`, au démarrage,
  bloque déjà le SG32, et les autres appareils comptent sur le battement de la spécification.
- Réglage global du poste — une salle peut mêler des modèles ; le fait est propre à l'appareil.
