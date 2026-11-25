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
