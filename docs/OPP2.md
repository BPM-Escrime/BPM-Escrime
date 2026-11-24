# Appareils de piste OPP2 (JSON sur MQTT) — #1960

OPP2 (OpenPiste Protocol, niveau 2) : protocole ouvert, JSON sur MQTT 3.1.1.
Spécification : <https://github.com/OpenPiste/protocols> (`docs/level2.md`, version `1.0`).
Le pilote OPP2 s'ajoute au pilote Cyrano ([CYRANO.md](CYRANO.md)) : mêmes arènes, même
`PisteHub`, même validation de fin de match. Les deux protocoles fonctionnent en même temps.

```
Appareil Cyrano ──UDP 50100──▶ CyranoPisteDriver ─┐
Appareil OPP2 ──MQTT──▶ broker intégré ──▶ Opp2PisteDriver ─┴▶ MultiPisteDriver ──▶ PisteHub ──▶ arènes
```

## Code (`src/main/opp2/`)

| Fichier                   | Rôle                                                                                                                                                                                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mqttPacket.ts`           | Codec MQTT 3.1.1 (CONNECT … DISCONNECT), découpage du flux TCP, jokers `+` / `#`.                                                                                                                                                                        |
| `mqttBroker.ts`           | Broker intégré, dans le processus main : messages retenus, dernière volonté, QoS 0 / 1 (QoS 2 accepté en entrée), keepalive. Sessions toujours propres. Crochets `authenticate` / `authorizePublish`. BPM - Escrime s'y branche sans socket (`Opp2Bus`). |
| `mqttClient.ts`           | Client MQTT minimal : appareil simulé des tests, futur raccordement à un broker externe.                                                                                                                                                                 |
| `../piste/pisteRecord.ts` | Créneau de la piste (`PisteRecord`) construit depuis `getArenaSlot` (`../remote/arenaSlot.ts`) : poule de la piste ou matchs de tableau, n° de match identiques à l'affichage.                                                                           |
| `codec.ts`                | Sujets `openpiste/{piste}/{rôle}/{message}`, construction des messages `software/*`.                                                                                                                                                                     |
| `driver.ts`               | `Opp2PisteDriver` : implémente `PisteDriver`.                                                                                                                                                                                                            |
| `../piste/multiDriver.ts` | `MultiPisteDriver` : plusieurs pilotes derrière un seul `PisteHub`. Une piste appartient au premier pilote qui la déclare : un même n° de piste ne peut pas être Cyrano et OPP2.                                                                         |

Pas de dépendance npm ajoutée.

## Correspondance avec le modèle commun

| Modèle commun                                                                 | Sens       | Message OPP2                                                                             |
| ----------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------- |
| `display` : tireurs, arbitre                                                  | → appareil | `software/fencers`                                                                       |
| `display` : arme, type, épreuve, phase, poule / tableau, n° de match, période | → appareil | `software/match`                                                                         |
| `display` : score et cartons repris                                           | → appareil | `software/score`                                                                         |
| `display` : chrono d'un match rappelé                                         | → appareil | `software/clock` (toujours `running: false`)                                             |
| `clear`                                                                       | → appareil | `software/fencers` vide                                                                  |
| `display` : cartons P déjà donnés                                             | → appareil | `software/uw2f` (ordinal 0 à 5 ; seulement s'il y en a, minuteur à 0)                    |
| `record` : créneau de la piste                                                | → tous     | `software/record` (retenu) — voir ci-dessous                                             |
| `ack` / `nak`                                                                 | → appareil | `software/control` `ACK` / `NAK`                                                         |
| Présence de BPM - Escrime                                                     | → tous     | `software/connection` (retenu) au démarrage, `online: false` à l'arrêt                   |
| `state` : état F / H / P / W / E                                              | ← appareil | `apparatus/state`                                                                        |
| `state` : scores, statuts, cartons, priorité                                  | ← appareil | `apparatus/score` (`black_card` → exclusion, `DNS` → abandon)                            |
| `state` : chrono                                                              | ← appareil | `apparatus/clock`                                                                        |
| `state` : lampes                                                              | ← appareil | `apparatus/lights`                                                                       |
| `state` : cartons P                                                           | ← appareil | `apparatus/uw2f` (ordinal 0 à 5, même lecture que Cyrano)                                |
| `state` : interventions médicales                                             | ← appareil | `apparatus/medical` (chaque début compte une intervention)                               |
| `state` : Id des tireurs, inversion gaucher                                   | ← appareil | `apparatus/fencers`                                                                      |
| `state` : remplaçant                                                          | ← appareil | `apparatus/control` `RESERVE`                                                            |
| `next` / `prev`                                                               | ← appareil | `apparatus/control` `NEXT` / `PREV`                                                      |
| Fin proposée                                                                  | ← appareil | `apparatus/control` `END` et `apparatus/state` `E` : une seule fin transmise au PisteHub |
| Liaison en ligne / hors ligne                                                 | ← broker   | `apparatus/connection` (dernière volonté)                                                |

- L'appareil publie son état par morceaux : le pilote tient l'état complet de chaque piste et le
  transmet entier au `PisteHub` à chaque changement.
- `apparatus/score` ne porte pas les Id : le pilote reprend ceux du dernier affichage envoyé,
  puis ceux d'`apparatus/fencers`. Le PisteHub rapproche les côtés par Id : une inversion faite
  par l'arbitre est suivie ; un Id inconnu donne BAD MATCH et la fin reçoit `NAK`.
- Id OPP2 complets (aucune troncature, contrairement aux 8 caractères de Cyrano).
- Nation : code CIO à 3 lettres seulement ; un club ou une ligue part dans `club_abbr`.
- Doublons QoS 1 : `seq` déjà vu pour un émetteur (piste + rôle) → message écarté. `seq` plus
  petit avec `ts` plus récent → redémarrage de l'appareil, compteur repris (spéc. § 27).
- Reprise après coupure : au démarrage du pilote, les messages retenus de l'appareil (`state`,
  `score`, `clock`…) sont relus ; au retour en ligne, le PisteHub renvoie le match courant.
- Télécommande : `remote/control` `BEGIN` / `HALT` / `RESET` / `VALIDATE` sont destinés à
  l'appareil et ignorés par BPM - Escrime.
- Messages sans équivalent dans le modèle commun, ignorés : `blade_contact`, `video_review`,
  `scoresheet/*`.
- Créneau `software/record` (spéc. § 17), publié par le `PisteHub` pour chaque piste OPP2 (ni
  relais par équipes, ni piste manuelle), seulement s'il a changé :
  - poule de la piste : `participants` (ordre de la poule) et tous ses matchs (vague active),
    dans l'ordre de passage ; tableau : match courant et file de l'arène ;
  - `bouts[].id` = n° de match de `software/match` ; `result` rempli dès la fin enregistrée
    (ACK de l'appareil ou fin saisie sur la tablette) : `V` / `D`, `A` (abandon), `E` (exclusion) ;
  - `active_bout` seulement après `NEXT` / `PREV` de l'appareil, retiré à l'ACK ;
  - `slot_id` : empreinte stable de l'épreuve et de la poule (ou de l'arène en tableau), à la
    forme d'un UUID ; `referee` = arbitre du match courant.
- Droits (spéc. § 30.3) : un client réseau du broker intégré ne publie jamais sous
  `openpiste/+/software/#` (dernière volonté comprise) ; BPM - Escrime publie par le bus interne.
- Relais par équipes : mêmes règles que Cyrano ([CYRANO.md](CYRANO.md) § 2 octies) ; jaune et
  rouges d'`apparatus/score` pas encore enregistrés pour le tireur dans la rencontre →
  `giveRelayCard` (type seul, source `opp2`), avant le contrôle de la fin du relais
  ([ADR-0028](adr/0028-cartons-equipe-moteur.md), lot C3) ; cartons P d'`apparatus/uw2f`
  (`p_card`) → `givePassivityCard`, noir P avec la fin du relais → ACK et rencontre décidée
  (lot C4).

## Contrat d'API (ex-canaux `opp2:*`, [ADR-0023](adr/0023-appareils-de-piste-salle.md))

Un appareil OPP2 se déclare sur la piste de la salle (Paramètres → Salles et pistes, ou
`setStripDevice` avec `{ protocol: 'opp2', opp2Id?, mode?, arena? }` ; `opp2Id` absent : numéro de
la piste). Le pilote charge les appareils OPP2 des salles des épreuves suivies ; une épreuve peut
passer une piste en manuel (`manualStrips`). Droit `remote:admin`, jamais sur le réseau.

| Opération                                                                | Rôle                                                                                             |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `startOpp2Broker({ port?, competitionId? })`                             | Démarre le broker (port 1883 par défaut) et le pilote ; appareils de la salle chargés.           |
| `stopOpp2Broker`                                                         | Annonce le départ de BPM - Escrime, arrête le broker.                                            |
| `getOpp2Status`                                                          | Broker, clients connectés, pistes (liaison, appareil, firmware), pistes vues mais non déclarées. |
| `listStripDeviceRoutes`, `setStripDeviceOptions`, `runStripDeviceAction` | Communs avec Cyrano : épreuve suivie par piste, options d'affichage, secours.                    |

Le `PisteHub` reste branché tant que Cyrano ou OPP2 est en service.

**Pilotage de la salle hors compétition** (#2117, [CYRANO.md](CYRANO.md#pilotage-de-la-salle-hors-compétition-2117)) :
`sendStripDisplay` publie un affichage libre sur `software/fencers` (noms en majuscules, code CIO
ou `club_abbr`, Id vide) et `software/match` (arme seule) ; remise à blanc = `software/fencers`
vide. Accusé : l'écho `apparatus/fencers` portant les noms envoyés (reçu) ; `apparatus/state`
actif (refusé) ; rien sous 8 s (sans réponse). OPP2 ne renvoie pas l'arme.

## Simulateur et télécommande web

Appareil OPP2 simulé : `scripts/lib/opp2Device.js` (même appareil que le simulateur Cyrano, transport
MQTT, client sans dépendance `scripts/lib/mqttLite.js`). Démarrer d'abord le broker (Appareils de
piste → OPP2), puis :

```bash
npm run cyrano:sim -- --opp2 --piste 3 [--broker 127.0.0.1] [--broker-port 1883]
```

```bash
npm run cyrano:remote -- --opp2 3,4 [--count 2]
```

Mêmes commandes que Cyrano (`next`, `begin`, `r+`, `end`…) ; `unplug` (console) ou « Débrancher »
(page) coupe la connexion : le broker publie la dernière volonté, la piste passe hors ligne.
« Rebrancher » : reprise depuis les messages retenus. Le créneau reçu (`software/record`) s'affiche
dans le journal de la piste.

## Tests

- `mqttPacket.test.ts`, `mqttBroker.test.ts` : codec, retenus, dernière volonté, authentification,
  droits de publication.
- `driver.test.ts` : conversions, doublons, fin unique, affichage, inversion gaucher, reprise,
  routage Cyrano + OPP2.
- `e2e.test.ts` : broker TCP réel, appareil simulé sur la piste 3, piste Cyrano déclarée à côté :
  affichage, créneau (`software/record` : sans résultat, résultat après ACK, match actif après
  NEXT), touches, `END` → `ACK`, `NEXT`, égalité → `NAK`, coupure, retour en ligne.
- `simulatorDevice.test.ts` : simulateur des scripts contre le broker et le pilote réels.
- `e2eTeam.test.ts` : relais par équipes par les commandes du moteur (source `opp2`), priorité à
  égalité, rouge de l'appareil puis `END` au palier + 1 → `ACK` (sans rouge → `NAK`), cartons
  relus après redémarrage, rejeu sans écart.

## Reste à faire (#1960)

1. Demande de vidéo, motifs de cartons saisis par la feuille de match (`scoresheet/event`) :
   où les garder (journal de l'épreuve ?) — décision à prendre par ADR.
2. Sécurité : TLS (8883), identifiants par appareil (droit limité à sa piste), broker externe
   (client `mqttClient.ts` à brancher sur `Opp2Bus`), appairage par certificat (spéc. § 30.5) —
   stockage des secrets sur la salle : ADR.
