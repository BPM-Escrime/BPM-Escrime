# Appareils de piste — protocole Cyrano (EFP1 / EFP1.1)

> État (#1720, #1829) : codec, serveur UDP, supervision, simulateur, panneau de configuration,
> raccordement aux arènes, **modes par piste** (appareil maître, afficheur, manuel), bascule en
> manuel si l'appareil tombe, notification BAD MATCH, reprise des arènes au redémarrage (chrono
> compris), saisie de la tablette verrouillée (points et cartons) quand l'appareil maître fait foi,
> cartons sur les feuilles imprimées.
> PREV (touche PREVIOUS de l'appareil ou secours du poste, fenêtre de 3 min), bandeau appareil
> dans la vue arbitre. **Appareils déclarés sur la salle** (#2117, ADR-0023) : une épreuve reprend
> ceux de sa salle et peut seulement passer une piste en manuel.
> Validation de fin unifiée : règles uniques dans `src/shared/domain/match/matchEndValidation.ts`,
> partagées par l'appareil, la tablette et la fin de match d'arène.
> Cartons P (EFP1.1) lus sur l'appareil et repris dans le `DISP` (jaune P compris, #2214) ; test de bout en bout
> (`e2e.test.ts`, UDP réel, lancé avec les tests unitaires en CI).
> **Couche multi-protocole** (§ 2 septies) : modèle commun `src/main/piste/`, pilote Cyrano,
> barrière d'entrée des arènes (`ArenaInputGate`). **Équipes** (`Type=T`, § 2 octies) : relais FIE
> de l'arène `/equipe{N}` sur l'appareil (relais, cumuls, cartons de la rencontre, remplaçant,
> NEXT / PREV, verrou de la tablette équipe). Cartons jaunes et rouges de l'appareil en équipes
> enregistrés par la commande `giveRelayCard` (ADR-0028, lot C3) : relais fini au palier + 1 avec
> un rouge acquitté (t.41.1).
> **Bouton « Match précédent » de la tablette** (liste des matchs, verdict du serveur affiché),
> **pause sabre à 8 touches** (minute de repos sur la tablette), **rejeu d'un journal** et **cartons P**
> dans le simulateur (#2001) ; recette sur appareil réel : § 3 bis.
> Restent : pilotes RS422-FPA / Favero / OPP2-MQTT, équipes au format « arène laser », vainqueur
> imposé en fin de rencontre par équipes. Cartons P en équipes : lot C4 de l'ADR-0028 (noir P avec
> la fin du relais → ACK et rencontre décidée).

Spécification : [Cyrano 1.1](https://superfencingsystem.com/CyranoProtocol-1-1.pdf)
(11 octobre 2019, rétrocompatible EFP1).

## 1. Protocole en bref

| Élément                 | Valeur                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| Transport               | UDP, port **50100** (paramétrable ; certains appareils utilisent 50101)                             |
| Adressage               | IP fixes, table « IP ↔ piste » côté logiciel                                                        |
| Trame                   | `\|EFP1.1\|COM\|piste\|compé\|…\|%\|<tireur droit>\|%\|<tireur gauche>\|%\|` (~210 caractères max.) |
| Logiciel → appareil     | `HELLO` (toutes les 15 s), `DISP` (match à afficher), `ACK` / `NAK` (fin acceptée / refusée)        |
| Appareil → logiciel     | `INFO` (partiel, complet, incomplet ; chrono au plus 1×/s), `NEXT`, `PREV`                          |
| États appareil          | `F` assaut, `H` halte, `P` pause, `E` fin en attente d'ACK, `W` attente                             |
| Inversion droite/gauche | faite par l'appareil, qui échange les zones : le logiciel suit l'**Id** du tireur, jamais le nom    |
| Fin de match valide     | scores différents, ou égalité avec priorité, ou abandon / exclusion d'un tireur                     |

EFP1.1 ajoute le carton P (champ 12 de chaque zone tireur, 0 à 5) et le chrono au centième.

## 2. Code (`src/main/cyrano/`)

| Fichier          | Rôle                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codec.ts`       | `parseCyrano(raw)` / `buildCyrano(msg)` : 3 zones, champs de fin omis, `\|` et `%` retirés des valeurs (pas d'échappement dans le protocole), troncature aux longueurs maximales de la spécification, carton P omis en EFP1.                                                                                                                                                                                                        |
| `names.ts`       | `transliterate` (alphabet latin seul), `formatCyranoName(nom, prénom, 10 \| 12 \| 15 \| 20)` → `MARTIN P`, `formatCyranoNat` (3 caractères), `pickCyranoNat(tireur, 'country' \| 'club' \| 'region' \| 'auto')`.                                                                                                                                                                                                                    |
| `disp.ts`        | `buildDisp(match)` : descripteur neutre (phase, poule/tableau, n° de match, tireurs droit/gauche) → champs d'un `DISP`. Laser et CUSTOM : arme non transmise. `EMPTY_DISP` = « aucun match disponible ».                                                                                                                                                                                                                            |
| `deviceState.ts` | Champs propres au protocole, utilisés par le pilote : Id tireur tronqué à **8 caractères** (`cyranoFencerId` ; les UUID BPM - Escrime en font 36, la correspondance par préfixe est faite par `piste/pisteState.ts`), chrono `m:ss` / `m:ss.cc` → secondes (`parseCyranoStopwatch`), carton P du champ 12 ↔ compteurs jaune / rouge / noir P (`cyranoPCardCounts`, `cyranoPCardField` : 0 / 1 / 2 / 4, niveau le plus haut, #2214). |
| `driver.ts`      | `CyranoPisteDriver` : pilote du modèle commun (§ 2 septies). INFO / NEXT / PREV → `PisteInput` (`cyranoToPisteState` : états, statuts, carton P 0-5 → jaune / rouge / noir P, chrono en secondes, priorité, type, relais ; n° de séquence attribué à la réception) ; `PisteCommand` → DISP / DISP vide / ACK / NAK (`pisteDisplayToDisp`, chrono `m:ss`).                                                                           |
| `server.ts`      | `CyranoServer` : socket `dgram`, table des pistes (`setPistes`), liste blanche d'IP, HELLO toutes les 15 s, version du protocole par piste (`auto` = celle de la dernière trame reçue), supervision, journal borné des trames, événements `info` / `next` / `prev` / `status` / `unknown`, envois `sendDisp` / `sendAck` / `sendNak`.                                                                                               |

Hors protocole (`src/main/piste/`) :

| Fichier             | Rôle                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`          | Modèle commun : `PisteState`, `PisteInput`, `PisteCommand`, `PisteDisplay`, `PisteLink`, interface `PisteDriver` (§ 2 septies).                                                                                                                                                                                                                                                                                                                                       |
| `pisteState.ts`     | État d'appareil rapporté au match : côtés A / B par **Id** (`mapPisteSides`, troncature fournie par le pilote), cartons au format des arènes (`sideCards`, `cardCounts` ; cartons P : l'appareil montre un niveau, `sideCards` le déplie en suite t.124 — rouge P = `p-yellow`, `p-red` ; noir P = `p-yellow`, `p-red`, `p-black` —, #2214), validation de fin (`validatePisteEnd`, `pisteEndOutcome`) sur les règles de `shared/domain/match/matchEndValidation.ts`. |
| `arenaInputGate.ts` | `ArenaInputGate` : barrière d'entrée des arènes (séquence par source).                                                                                                                                                                                                                                                                                                                                                                                                |
| `pisteHub.ts`       | `PisteHub` : raccordement aux arènes (voir § 2 bis).                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `teamRelayPiste.ts` | Relais par équipes sur l'appareil (§ 2 octies).                                                                                                                                                                                                                                                                                                                                                                                                                       |

### 2 bis. Raccordement aux arènes — mode appareil maître

Les entrées de l'appareil passent par le chemin de la tablette (`arena_control`, pseudo-socket
`cyrano:<piste>`, sans anti-rebond) ; les mises à jour qui en résultent portent `source: 'device'`
et la vue arbitre ouverte sur le même match les recopie (score, cartons, chrono).

| Événement                                             | Effet                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `INFO` en `F` / `H` / `P`                             | match démarré sur l'arène ; score et cartons (jaune, rouges) appliqués s'ils changent ; chrono diffusé (`F` en marche, `H` / `P` arrêté)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `INFO` en `W` sans le match de l'arène                | `DISP` du match courant (appareil redémarré ou reconnecté)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `INFO` d'autres tireurs que ceux du match (BAD MATCH) | ignoré ; alerte « BAD MATCH » sur la piste dans le panneau Cyrano, levée dès que l'appareil affiche le bon match                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `INFO` en `E`                                         | état final appliqué, puis `ACK` et clôture du match ; égalité avec priorité (ou statuts `V` / `D`) → vainqueur prioritaire ; abandon (`A`) / exclusion (`E`) → l'adversaire gagne, abandon ou exclusion marqué ; `NAK` si fin invalide, BAD MATCH ou refus de `recordScore` (match absent de la session compris : rien d'écrit, #2151) ; END répété après clôture → nouvel `ACK` sans réenregistrement                                                                                                                                                                                                                                                                                                                                           |
| `NEXT`                                                | match suivant seulement si le match de l'arène est terminé (ou absent) ; sinon `DISP` du match courant (pas d'abandon silencieux)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `PREV`                                                | rappel du dernier match terminé de l'arène pour correction (`recallPrevMatch`, 3 min après sa fin) : `DISP` avec ses scores et cartons, puis nouvelle validation (`END` → `ACK`) qui le réenregistre ; un match de tableau non commencé repasse en tête de file. Refus (combat en cours, rien à rappeler, délai dépassé) : `DISP` du match courant (ou affichage vide). Sans effet en afficheur. Même rappel depuis la tablette (bouton « Match précédent » de la liste des matchs, `arena_control` `prev`) : le serveur répond sur `arena:{id}:prev_result` (`{ ok: true }` ou `{ ok: false, reason: none \| expired \| in_progress \| error }`) et la tablette affiche le succès ou le motif du refus ; le match rappelé revient dans la liste |
| Changement de match (file, vue arbitre, DT)           | `DISP` ; jamais de `DISP` d'un match terminé                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Correction de score sur la tablette                   | `DISP` avec les scores corrigés (pas d'écho pour les scores venus de l'appareil)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

**L'appareil fait foi** (appareil maître et en ligne, décision de l'auteur du ticket) : sur la
tablette, l'ajout de points **et** de cartons (jaune, rouge, noir, P) est bloqué, avec une
notification ; le retrait reste permis pour corriger. Côté serveur, une action de la tablette qui
**ajoute** un carton ou un point est refusée : `update_score` dont les cartons s'allongent
(comptage par type, `cyranoLock.ts`) → ajouts ignorés, retraits gardés (`keepRemovals` : remplacer
un jaune par un rouge garde le retrait du jaune), la tablette reçoit en retour les cartons de
l'arène (`source: 'device'`) ; scores bornés aux scores actuels (`lockedScore`) ; `add_card`
refusé ; carton noir pris en compte envoyé avec la fin de match (`POST /api/matches/:id/finish`,
`blackCardFencer`) → `409 cyrano_master_lock`, la tablette retire alors le carton et le combat
continue. Les entrées
de l'appareil (`cyrano:<piste>`) passent toujours. Appareil hors ligne, piste en afficheur ou en
manuel : saisie libre sur la tablette.

Un `DISP` du match courant porte aussi les cartons déjà donnés (champs jaune / rouge des zones
tireurs, omis à zéro) : sans eux, le premier `INFO` d'un appareil qui reprend un match (PREV,
redémarrage) les effacerait. Pour un match rappelé (PREV) pas encore relancé, il porte aussi le
chrono de fin de match (dernier chrono reçu de l'appareil), également diffusé à la tablette et à
l'écran d'arène ; jamais de chrono dans un `DISP` envoyé en plein combat. À confirmer sur un
appareil réel.

Le `DISP` porte la phase, la poule (numéro de la poule) ou le tableau (`A16`, `A8`…) et le numéro
du match (`matchCoords.ts`). Phase (spéc. § 3) : tour de poules en cours (1, 2…), tableau = nombre
de tours de poules + 1 (`settings.poolRounds`, `uiState.currentPoolRound`). Un match rappelé qui
s'était terminé par un abandon ou une exclusion repart avec le statut du tireur sorti (`A` / `E`,
champs R5 / L5), tant qu'il n'est pas relancé. Sabre laser et armes personnalisées : affichage seul (noms et score),
INFO ignorés, END → `NAK`, NEXT sans effet. Journal des scores : auteur `device` pour les saisies
et fins de match venues de l'appareil (libellé « Appareil de piste »).

### Appareils déclarés sur la salle (#2117, [ADR-0023](adr/0023-appareils-de-piste-salle.md))

Un appareil se déclare **une fois, sur la piste de la salle** : Paramètres → Salles et pistes,
colonne `venue_strips.device_config` (`protocol` `cyrano` ou `opp2`, adresse IP, port, version
EFP1 / EFP1.1 / auto, identifiant OPP2, mode, arène — par défaut le numéro de la piste). Contrat :
`setStripDevice`, `listStripDevices` (droit `remote:admin`, jamais sur le réseau).

- **Salle d'une épreuve** : sa salle (`setCompetitionVenue`, `competitions.venue_id`), sinon celle
  de sa journée multi-épreuves, sinon la salle par défaut (`getCompetitionStripDevices`).
- **Piste en manuel pour une épreuve** : réglage `manualStrips` de l'épreuve
  (`updateCompetitionSettings`). Pour cette épreuve, le pilote n'envoie plus de match et ignore les
  scores de l'appareil (END → NAK) ; une autre épreuve de la même salle affectée à la piste garde
  l'appareil. La tablette saisit à la place.
- **Pilotes** : les tables ne viennent plus de l'écran. Au démarrage (`startCyranoServer`,
  `startOpp2Broker`), à chaque séance de saisie distante démarrée et à chaque changement de salle
  ou d'appareil, le poste relit les appareils des salles des épreuves suivies (épreuve du panneau,
  épreuves en saisie distante ; aucune : salle par défaut).
- **Reprise** (migration 47) : les anciennes tables `cyrano_pistes` (par épreuve, ou `day:<id>`
  par journée) sont recopiées sur la salle de la journée, sinon sur la salle par défaut (créée
  s'il n'y en a aucune), sans écraser une piste déjà déclarée. Les lignes non reprises (piste non
  numérique, configuration invalide, conflit avec une piste déclarée) sont listées au journal de
  diagnostic au démarrage. `cyrano_pistes` reste en lecture seule jusqu'à la 3.0.

### Panneau des appareils (saisie distante)

| Réglage / action                 | Effet                                                                                                                                                                                                                                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Salle de l'épreuve               | salle propre de l'épreuve, ou « salle de la journée ou par défaut » (`setCompetitionVenue`)                                                                                                                                                                                                                   |
| Tableau des appareils            | appareils effectifs de la salle (lecture seule : aucune adresse éditée ici), liaison, protocole détecté, BAD MATCH, épreuve suivie par la piste                                                                                                                                                               |
| Manuel (par piste)               | passe la piste en manuel **pour cette épreuve** (`manualStrips`)                                                                                                                                                                                                                                              |
| Interface d'écoute               | adresse IP locale (ou toutes les interfaces) ; prise en compte au démarrage. Une interface IPv4 choisie écoute en réalité sur toutes les interfaces (sinon les diffusions `x.x.x.255` ne sont pas reçues sous Linux / macOS) : les trames d'IP non déclarées hors de son sous-réseau sont ignorées sans trace |
| OPP2 (MQTT)                      | port et démarrage du broker intégré ([OPP2.md](OPP2.md))                                                                                                                                                                                                                                                      |
| Démarrer avec la saisie distante | pilotes démarrés à chaque lancement de séance, si la salle de l'épreuve déclare un appareil du protocole                                                                                                                                                                                                      |
| Secours `ACK`                    | ACK forcé : débloque un appareil resté en attente d'acquittement                                                                                                                                                                                                                                              |
| Secours `NEXT`                   | même effet que la touche NEXT de l'appareil (mêmes garde-fous)                                                                                                                                                                                                                                                |
| Secours `PREV`                   | même effet que la touche PREVIOUS de l'appareil : rappel du dernier match terminé (§ 2 bis)                                                                                                                                                                                                                   |
| Secours « Resynchroniser »       | oublie l'état connu de la piste et renvoie le match de l'arène (ou un affichage vide)                                                                                                                                                                                                                         |
| Journal des trames               | 200 dernières trames ; export texte, une trame par ligne : `horodatage ⇥ IN/OUT ⇥ ip:port ⇥ piste ⇥ trame [⇥ rejet]`                                                                                                                                                                                          |

Port, interface, port MQTT, options de noms et démarrage automatique restent mémorisés dans le
navigateur de l'application (`localStorage`). Contrat : `startCyranoServer`, `stopCyranoServer`,
`getCyranoStatus`, `listCyranoLog`, `startOpp2Broker`, `stopOpp2Broker`, `getOpp2Status`,
`listStripDeviceRoutes`, `setStripDeviceOptions`, `runStripDeviceAction` (ex-canaux `cyrano:*`,
`opp2:*`).

Disposition : le journal des trames
défile jusqu'aux dernières trames (sauf si on remonte pour lire) dans son propre cadre, sans élargir
la page ; l'export contient les 200 dernières trames et se rejoue dans le simulateur (§ 3).

### Pilotage de la salle (hors compétition, #2117)

Paramètres → Salles et pistes → bouton **Appareils** d'une salle : déclaration en masse et
pilotage direct des appareils de la salle, **sans compétition ouverte** (remplace l'application
externe qui envoyait les ordres aux appareils). Capture : [26-pilotage-salle](screenshots/26-pilotage-salle.png).

- **Grille** : n° et libellé, protocole, liaison (en ligne, incertain, hors ligne, jamais vu ;
  « pilote arrêté » si le pilote du protocole ne tourne pas), épreuve en cours qui occupe la
  piste, dernier envoi et son accusé. Pilote arrêté : bouton pour le démarrer
  (`startCyranoServer` / `startOpp2Broker`, port et interface mémorisés du panneau). Ouvrir la
  grille charge les appareils de la salle dans les pilotes, après ceux des épreuves suivies
  (une piste du pilote commune aux deux reste à l'épreuve).
- **Envoi en masse** : pistes cochées (ou toutes), puis un seul envoi de l'**arme** (épée,
  fleuret, sabre), des **noms** et **nations ou clubs** gauche / droite, ou une **remise à
  blanc**. Champ vide : inchangé ; l'envoi est fusionné avec le précédent de la piste (envoyer
  l'arme seule garde les noms).
- **Résultat par piste** : `sent` (envoyé), `busy` (refusé : une épreuve en saisie distante dans
  cette salle a l'arène de la piste dans sa séance ; une piste qu'elle a passée en manuel,
  `manualStrips`, reste pilotable), `offline`, `not_declared`, `unavailable` (pilote arrêté, ou
  piste du pilote prise par une autre salle).
- **Trames** : Cyrano → `DISP` (EFP1 / EFP1.1 selon la piste) : arme, `Type=I`, `Round=1`, noms
  par la convention et la troncature de `names.ts` (longueur des noms du panneau), nation sur 3
  caractères, **sans Id de tireur** ; remise à blanc → `DISP` vide. OPP2 → `software/fencers`
  (noms en majuscules, code CIO ou club, Id vide) et `software/match` (arme seule). Une piste
  libre garde son affichage au retour en ligne de l'appareil ; le premier match envoyé par une
  épreuve reprend la main.
- **Accusé de réception** : Cyrano n'acquitte pas un `DISP` (seule la fin de match a ACK /
  NAK). Le pilote envoie un `HELLO` juste derrière le `DISP` : l'appareil répond par un `INFO`
  complet (appareil sans `HELLO`, ADR-0038 : son prochain `INFO` spontané en tient lieu). **Reçu** quand un `INFO` renvoie les noms envoyés et l'arme ; **refusé** quand
  l'appareil est en plein combat (`F`, `H`, `P`, `E`) sans les afficher (un appareil conforme
  ignore un `DISP` en état actif, § 4) ; un `INFO` croisé au repos est ignoré. OPP2 : l'écho
  `apparatus/fencers` (noms) fait foi, `apparatus/state` actif vaut refus ; l'arme n'est pas
  renvoyée par OPP2. Rien dans les **8 s** : **sans réponse** (pas forcément un échec : un
  appareil OPP2 qui ne renvoie pas `apparatus/fencers` reste « sans réponse »).
- **Ni fait d'épreuve, ni journal** : ordres d'affichage seulement, état en mémoire (perdu au
  redémarrage) ; les noms ne sont jamais tracés (RGPD), l'avis `onStripControlChanged` ne porte
  que des identifiants.
- **Déclaration en masse** : ajout en lot (première piste, nombre, protocole, IP de la première
  piste incrémentée, port, version, profil constructeur Standard / EFP1.1 / Saint-George, dont
  l'IP `192.168.1.(100 + piste)` et `hello: false`), export et import JSON des appareils de la salle (format
  `bellepoule-strip-devices` version 1 ; l'ancien export du panneau Cyrano est relu). Le fichier
  circule par contenu (`usePlatform`), jamais par chemin. Import contrôlé d'abord : une ligne
  invalide et rien n'est écrit, erreurs rendues ligne par ligne. Capture :
  [25-salle-appareils](screenshots/25-salle-appareils.png).

| Opération (droit `remote:admin`, jamais sur le réseau, pas de MCP)      | Rôle                                                          |
| ----------------------------------------------------------------------- | ------------------------------------------------------------- |
| `listVenueStripControl({ venueId })`                                    | grille du pilotage                                            |
| `sendStripDisplay({ venueId, strips, weapon?, left?, right?, clear? })` | affichage libre en masse, résultat par piste                  |
| `onStripControlChanged`                                                 | avis : accusé ou liaison changés (l'écran relit la grille)    |
| `setStripDevices({ venueId, devices })`                                 | ajout en lot : pistes citées seulement, une transaction       |
| `getStripDevicesFile({ venueId })`                                      | contenu JSON et nom de fichier (requête, n’écrit rien)        |
| `importStripDevices({ venueId, content, dryRun? })`                     | import validé ligne par ligne (`applied`, `strips`, `errors`) |

Code : règles pures `src/shared/domain/stripDevices/stripControl.ts` (sélection, occupation,
verdict, fusion, accusé) et `stripDevicesFile.ts` (lot, fichier) ; envoi et accusé
`src/main/piste/stripControl.ts` (commande `panel` du modèle commun, événement `echo` des
pilotes) ; handlers `src/main/engine/commands/devicesControl.ts` ; écran
`VenueStripControlPanel.tsx`, `VenueStripBulkTools.tsx`.

### 2 ter. Modes par piste (#1829)

| Mode                  | Sortie vers l'appareil | Entrées de l'appareil                      | Commandes du poste                |
| --------------------- | ---------------------- | ------------------------------------------ | --------------------------------- |
| `master` (défaut)     | DISP, ACK / NAK        | INFO, END, NEXT appliqués à l'arène        | ACK, NEXT, resynchronisation      |
| `display` (afficheur) | DISP                   | INFO ignorés ; END → NAK ; NEXT sans effet | ACK, resynchronisation (pas NEXT) |
| `manual`              | aucune trame           | tout ignoré ; END → NAK                    | ACK seulement                     |

- **Sabre laser et armes personnalisées** : toujours `display` (décision n°5), quel que soit le mode réglé.
- **Appareil hors ligne** (statut `offline`) : la piste bascule en `manual` pour la suite (plus de DISP
  envoyé à un appareil muet). **Au retour en ligne**, le DISP du match courant est renvoyé.
- **Changement de mode** (déclaration de la salle, case « Manuel » de l'épreuve) : un passage en `manual` coupe les trames, un retour en
  `master` ou `display` renvoie le DISP du match courant.
- **BAD MATCH** : première alerte sur une piste → notification native au DT (un clic ramène la
  fenêtre au premier plan), libellée dans la langue de l'interface. Les alertes suivantes sur la même
  piste ne notifient pas à nouveau ; l'alerte est levée au prochain DISP correct.

### 2 quater. Reprise de l'état des arènes (#1829)

`persistArenaState` sauvegarde chaque arène. Au démarrage de la séance de saisie distante, une
arène sauvegardée **en cours** reprend son match et son score, si ce match n'est pas terminé en base ;
la file DE sauvegardée est rétablie. Le chrono aussi : la dernière valeur envoyée par la tablette
(`update_timer`, `pause_timer`, `reset_timer`) est gardée dans `currentMatch.clockSeconds`,
persistée à chaque pause et au plus toutes les 15 s en marche, puis renvoyée en pause aux écrans
qui rejoignent l'arène. La tablette garde de son côté son propre chrono (#1717).

- **Minute de repos de l'appareil** (état `P`, `arena.resting`) : le décompte reçu est celui du
  repos, il ne remplace pas `clockSeconds` ; le chrono du combat est de nouveau suivi à la fin du
  repos.
- **Tablette sans chrono local** (autre tablette, stockage vidé) : en rouvrant le match, elle
  reprend le chrono renvoyé par le serveur (`serverTimer`, `refereeUpdate.js`), toujours à
  l'arrêt, jamais relancé automatiquement ; son chrono local (`localStorage`, #1717) reste
  prioritaire.
- **`reset_scores`** efface `clockSeconds` avec les scores (en mémoire et dans l'état sauvegardé).

### 2 quinquies. Pistes partagées entre épreuves (#1878)

Journée multi-épreuves : un serveur distant par épreuve, un seul serveur Cyrano. L'arène N de
chaque épreuve est la piste physique N. `PisteHub` reçoit **tous** les serveurs distants et route
chaque piste vers l'épreuve de son **affectation en cours** (`hasArenaAssignment` : match non
terminé sur l'arène, ou match suivant en file) :

| Situation                                        | Épreuve suivie                                                                                     |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Une seule épreuve a une affectation sur la piste | celle-ci                                                                                           |
| Plusieurs                                        | la dernière suivie (la piste reste prise jusqu'à la fin de son affectation), sinon celle en combat |
| Aucune                                           | la dernière suivie : rien n'est envoyé à l'appareil jusqu'à la prochaine affectation               |

- Les mises à jour d'arène d'une autre épreuve que celle suivie n'atteignent pas l'appareil ; les
  INFO / END / NEXT / PREV de l'appareil vont à l'épreuve suivie.
- Changement d'épreuve : état connu de l'appareil oublié, nouveau DISP avec l'arme et le champ
  Compe de la nouvelle épreuve (8 premiers caractères de l'identifiant de compétition).
- NEXT reste dans la file de la piste pour l'épreuve suivie ; jamais de saut d'une épreuve à l'autre.
- La liaison de l'appareil (`arena.cyrano` : mode, en ligne) suit la piste : retirée de l'arène
  de l'ancienne épreuve, publiée sur celle de la nouvelle, et republiée dès qu'elle manque
  (arènes recréées au démarrage d'une séance). Bandeau appareil et verrou de la tablette en
  dépendent.
- **Appareils de la salle** : les épreuves d'une journée partagent les appareils déclarés sur la
  salle (ADR-0023). Le panneau signale les pistes suivies par une autre épreuve
  (`listStripDeviceRoutes`). Une piste passée en manuel par une épreuve (`manualStrips`) est
  routée vers l'autre épreuve affectée à la même arène.

### 2 sexies. Cartons sur les feuilles imprimées (#1829)

Les cartons enregistrés (table `match_cards`, y compris `p-red` / `p-black` lus sur l'appareil)
figurent sur les feuilles imprimées ou exportées en PDF, par tireur. Même décompte sur les deux
feuilles (`cardsSummaryHTML`, `poolPdf.ts`) : libellés traduits (`pdf.card_*` : Blanc, Jaune,
Rouge, Noir, Jaune P, Rouge P, Noir P), nombre si plus d'un (« Rouge ×2 »), et **cartons P à
part** des cartons de faute, comme le veut le règlement FIE (t.124.3.e).

| Feuille                                                                | Lecture                                                                                                                                                            | Rendu                                                                                                                                                                                                        |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Feuille de poule (impression d'une poule, impression ou PDF de toutes) | `withMatchCards` (`renderer/services/poolCards.ts`) : cartons des matchs terminés joints aux matchs (`db.getCards`)                                                | `poolCardsSectionHTML` : section « Cartons » (élément `cards` des modèles, imprimée même avec un modèle antérieur), une ligne par tireur sanctionné, colonnes « Cartons » et « Cartons P (non-combativité) » |
| Feuille de match de tableau (feuilles d'arbitrage)                     | `loadDECards` (`tableauDialogState.ts`) : une requête (`db.getCardsByMatchIds`) ; un match saisi à distance est relu sous son id composite `<compétition>-<match>` | colonne « Cartons » entre score et signature, sur la ligne de chaque tireur : cartons de faute, puis cartons P dessous ; vide (à remplir à la main) sans carton enregistré                                   |

### 2 septies. Couche multi-protocole (#1829)

```
appareil ──trames──▶ pilote (CyranoPisteDriver, …) ──PisteInput──▶ ArenaInputGate ──▶ PisteHub ──▶ arènes
appareil ◀─trames─── pilote ◀──────────────PisteCommand─────────────────────────── PisteHub
```

- **`PisteState`** : état normalisé d'un appareil — état (`fencing` / `halt` / `pause` / `waiting` /
  `ending`), chrono en secondes, priorité (`none` / `right` / `left`), type (`individual` / `team`),
  n° de période ou de relais ; par côté (droite / gauche) : Id, nom, nation, score, cartons
  (jaune, rouges, jaune / rouge / noir P), statut (`normal` / `victory` / `defeat` / `abandon` /
  `exclusion`), lumières, médical, remplaçant.
- **`PisteInput`** : `state` | `next` | `prev`, avec la source (pilote + piste) et un **numéro de
  séquence** strictement croissant par piste. Cyrano ne numérote pas ses trames : le pilote
  numérote à la réception (aucun rejet possible en Cyrano, comportement inchangé).
- **`PisteCommand`** : `display` (match ou relais à afficher : type, relais, arme, scores et
  cartons repris, chrono d'un match rappelé, épreuve), `clear`, `ack`, `nak`.
- **`PisteDriver`** : statuts de liaison (`getStatuses`, `findPiste`, `findAllByArena`, événement
  `status`), émission des entrées (événement `input`), `send(piste, commande)`, `fencerId(id)`
  (Id tel que l'appareil le renverra, ex. 8 caractères en Cyrano), capacités déclarées (noms,
  télécommande, ACK, chrono, cartons P, équipes). Le PisteHub ne manipule plus de `CyranoMessage`.
- **`ArenaInputGate`** (manque n°1) : barrière par arène. Une entrée d'appareil dont le numéro
  n'est pas supérieur au dernier accepté pour la même source sur la même arène (double, désordre,
  numéro illisible) est rejetée avant l'arène, journalisée (`logger.warn`) et gardée dans un journal
  borné (`getRejections`). Les entrées de la tablette passent sans contrôle (chemin `arena_control`
  inchangé). Une piste passée hors ligne est oubliée (`forget`) : un appareil redémarré peut
  reprendre sa numérotation. **Avec Cyrano, elle ne rejette rien** : le protocole ne numérote
  pas ses trames, le pilote numérote à la réception (toujours croissant) ; un INFO dupliqué ou
  désordonné sur le réseau n'est pas détecté. C'est le socle des protocoles numérotés à venir.
- Nouveau pilote (RS422-FPA, Favero série) : implémenter `PisteDriver`, l'ajouter au
  `MultiPisteDriver` (`main.ts`). Plusieurs protocoles coexistent (#1960) : chaque piste appartient
  au premier pilote qui la déclare, `fencerId(id, piste)` suit le protocole de la piste. Le
  pseudo-socket des entrées d'appareil reste `cyrano:<piste>` (verrou appareil maître,
  `cyranoLock.ts`). Pilote OPP2 (JSON sur MQTT) : [docs/OPP2.md](OPP2.md).

### 2 octies. Équipes — relais FIE (`Type=T`, #1829)

Existant : l'arène équipe `/equipe{N}` (`teamArena.ts`, #1086 / #1240) tient en direct une
rencontre en **relais FIE** (9 relais de 3 contre 3, paliers de 5 jusqu'à 45, `teamRelayLive.ts`)
ou au format « arène laser ». L'ordre des relais vient de `relayOrderFor` : ordre officiel FIE à l'épée, au
fleuret et au sabre (3-6, 1-5, 2-4…, o.99.3), rotation diagonale `generateRelayOrder` au Sabre Laser et
pour l'arme à la carte (chaque titulaire rencontre chaque titulaire adverse une fois) ; les remplaçants sont déclarés dans
l'équipe (`isReserve`). La tablette saisit les touches du relais en cours, le chrono, les cartons ;
« relais suivant » enregistre le relais (`advanceTeamBout`).

Raccordement : une piste rattachée à l'arène N suit l'arène équipe `N` quand une rencontre en
relais FIE y a un **relais en cours** (même critère pour le routage et le traitement des
entrées) ; sinon l'arène individuelle `arena{N}`. Une rencontre terminée encore assignée ne
reçoit END répété et PREV que si l'arène individuelle N n'a aucune affectation. Toute
modification de l'arène équipe (tablette, DT, appareil) prévient le hub (`cyranoTeamHook`).

| Sens                             | Effet                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DISP                             | `Type=T`, `Round` = n° du relais (1 à 9), zones tireur = tireurs du relais en cours (Id, nom en base, nation = équipe ; pays si compétition internationale ou source « pays »), **scores cumulés** de l'équipe ; cartons déjà reçus par chacun des deux tireurs **dans la rencontre** (ils se cumulent d'un relais à l'autre : dernier relais tiré vu par l'appareil et cartons enregistrés — tablette, écran, appareil —, par type le plus grand compte) ; Phase, PoulTab et Match renseignés comme en individuel (obligatoires, spéc. § 3) : poule et rang de la rencontre dans la poule, ou `A<tour>` et position + 1 pour une rencontre de tableau. Rencontre terminée ou retirée : DISP vide (sans effacer un match individuel affiché entre-temps)                                                                                                                                                                                                                                                                                                                        |
| INFO actif                       | score cumulé → score du relais en cours (cumul − relais terminés). Mêmes bornes que la tablette : un cumul inférieur aux relais terminés ou au-delà du palier du relais (`relayCapFor` : n × 5, plafonné à 45, dépassé d'une touche par rouge adverse enregistré dans le relais, t.41.1) est ignoré, tracé, et le cumul de l'arène renvoyé. Cartons : **d'abord**, chaque jaune ou rouge montré et pas encore enregistré pour ce tireur dans la rencontre (`newDeviceCards`) est enregistré par `giveRelayCard` avec le type, sans motif (« groupe à compléter »), source `cyrano` ; un refus du moteur est tracé une fois et ne change ni le score ni la réponse à la fin du relais ; `deviceCards` (mémoire) ne sert plus qu'au DISP. Cartons P (P-card, rang le plus haut des deux zones : 1 jaune P, 2 ou 3 rouge P, 4 ou 5 noir P) : jaune P et rouge P pas encore enregistrés → `givePassivityCard` (aux deux équipes, escalade de la rencontre), le noir P attend l'END ; DISP : cartons P enregistrés repris aux deux tireurs. Chrono du relais (3 min − temps restant) |
| END d'un relais intermédiaire    | correct (égalité comprise) : ACK, relais enregistré, puis DISP du relais suivant avec les cumuls (l'appareil ne remet pas les scores à zéro au BEGIN). END répété (ACK perdu) : nouvel ACK. Tireur en abandon (`A`) ou exclusion (`E`) : la fin d'un relais intermédiaire reste correcte (spéc. § 4) → ACK, relais enregistré, et **notification au DT** (piste, relais, tireur : suite à décider, rien n'est perdu en silence) ; cumul au-delà du palier et des rouges adverses : NAK (un rouge montré avec l'END est enregistré avant ce contrôle : END au palier + 1 avec ce rouge → ACK). Relais enregistré par la commande `recordRelayScore` (docs/adr/0024), contrôlée avant l'ACK : tout refus du moteur (code du catalogue) → NAK, rien d'écrit                                                                                                                                                                                                                                                                                                                        |
| END avec noir P                  | quel que soit le relais (lot C4, t.124) : pas de règle de fin individuelle ; ACK, relais enregistré, puis `givePassivityCard` jusqu'au noir P qui décide la rencontre (score des relais, puis classement), même source ; pas de remplaçant. Dernier relais d'un tableau à égalité : NAK, à saisir par le DT (le relais ne s'enregistre pas sans vainqueur). Noir P refusé après l'ACK : tracé, à saisir par le DT                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| END du dernier relais            | règles de fin individuelles (`validatePisteEnd`) ; égalité du cumul avec la priorité (`Prio` `R` / `L`, tirée avant la minute supplémentaire, t.41.5) → `recordRelayScore` avec `winner` = côté prioritaire, ACK, rencontre décidée (#2191) ; égalité sans priorité → NAK ; autre vainqueur imposé (abandon, exclusion, victoire / défaite) → NAK tracé, à saisir par le DT                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| END après la fin de la rencontre | répétition du dernier relais acquitté : ACK ; sinon NAK (jamais sans réponse)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Remplaçant (`R11` / `L11` = `R`) | équipes seulement (en individuel : refusé, tracé) ; la demande peut être annulée pendant le relais où elle est posée (spéc. § 4) : elle est prise en compte **à la fin acquittée du relais**, si elle est toujours posée. Le remplaçant de l'équipe prend alors la place du tireur de la zone dans ses relais suivants non tirés (commande `substituteTeamFencer`, après l’enregistrement du relais). Refusé et tracé (code du catalogue) : pas de remplaçant (`no_reserve`), remplaçant déjà présent dans la rencontre (`reserve_used`), plus de relais pour ce tireur (`no_later_relay`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| NEXT                             | ne saute jamais un relais : relais en cours renvoyé ; rencontre terminée → DISP vide (rencontre suivante assignée par le DT)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| PREV                             | rappel du relais précédent (repasse en cours avec son score) si le relais en cours n'a pas commencé, ou après la fin de la rencontre ; le moteur rouvre le dernier relais terminé (`reopenRelay` : score conservé, rencontre en cours ; refus `next_match_played` si la rencontre suivante du tableau a commencé). Sinon relais en cours renvoyé. Nouvel END → réenregistré                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| BAD MATCH                        | tireurs d'un autre relais : alerte (`equipe{N}`), END → NAK                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Modes : afficheur → DISP seul, END → NAK ; arme laser → affichage seul ; format « arène laser »
non raccordé (assauts indépendants, pas de relais).

**Verrou de la tablette équipe** (même décision qu'en individuel) : le hub publie le mode et la
liaison de l'appareil sur l'arène équipe (`cyrano`). Appareil maître et en ligne → la tablette ne
peut ni ajouter de touche ou de carton (équipe ou tireur), ni passer au relais suivant, ni remettre
le relais à zéro : refus côté serveur (`team_touch` > 0, `team_card`, `team_fencer_card`,
`team_reset_bout`, `team_advance_bout` → état renvoyé, trace) et côté tablette (bandeau,
notification). Retrait d'une touche toujours permis (bouton −1, `team_touch` -1) ; il est renvoyé
à l'appareil par un DISP.

### Supervision

| Statut    | Condition                                                                 |
| --------- | ------------------------------------------------------------------------- |
| `never`   | aucune trame reçue depuis la déclaration                                  |
| `online`  | dernière trame < 20 s (l'appareil répond à chaque HELLO)                  |
| `stale`   | entre 20 s et 40 s                                                        |
| `offline` | > 40 s (délai au-delà duquel l'appareil se considère lui-même déconnecté) |

### Sécurité réseau

UDP sur le LAN, sans chiffrement ni jeton : seules les trames des **IP déclarées** sont traitées.
Les autres sont journalisées (`rejected: 'unknown_ip'`) et signalées par l'événement `unknown`
(aide à la découverte), sans effet. Trames illisibles ou > 512 octets : ignorées.
Un datagramme peut contenir plusieurs trames collées (`…%||EFP1.1|INFO|…`, Saint-George SG32) :
elles sont traitées dans l'ordre, la dernière fait foi (`splitCyranoFrames`).

### Saint-George SG31 / SG32

Constaté en salle (12 SG32) : IP fixe `192.168.1.(100 + piste)`, écoute sur **50101**, INFO émis
depuis 50101 en **diffusion** vers `192.168.1.255:50100` toutes les 2 à 4 s (aucune IP de serveur
à régler sur l'appareil). Côté poste : port UDP 50100, IP dans `192.168.1.0/24` hors 101 à 112,
profil `Saint-George`, numéro de piste BPM - Escrime = numéro de l'appareil. La télécommande n'agit que
si elle est appairée à l'appareil (socle de charge) ; BEGIN fait passer de `W` à `H` (spéc. § 4).
Le bip de la télécommande accuse seulement la réception de la touche.

**Aucun HELLO** : un seul `HELLO` reçu sur 50101 (venu du port 50100) bloque le chrono du SG32 —
BEGIN / STOP / GO bipent sans effet jusqu'au redémarrage de l'appareil. Un `DISP`, vide ou avec un
match, ne bloque rien. Le profil `Saint-George` déclare donc `hello: false` ([ADR-0038](adr/0038-cyrano-sans-hello-saint-george.md)) :
le pilote n'envoie jamais de `HELLO` à ces pistes, la supervision repose sur les `INFO` spontanés.
Une salle déclarée avant ce correctif : la redéclarer avec le profil (ajout en lot), puis
redémarrer les appareils.

### Pare-feu

Le port UDP 50100 doit être ouvert **en entrée** sur le poste BPM - Escrime :

- Windows : accepter l'invite du pare-feu au premier lancement, ou ajouter une règle entrante UDP 50100 pour BPM - Escrime.
- macOS : Réglages Système → Réseau → Coupe-feu → autoriser BPM - Escrime.
- Linux : par exemple `sudo ufw allow 50100/udp`.

### 2 nonies. Conformité à la spécification Cyrano 1.1

Revue du 17 novembre 2026 (spécification du 11 octobre 2019), contrôlée par les tests et par une
validation à l'écran avec quatre appareils simulés.

| Point de la spécification                                        | État                                                                                                                                                        |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| § 2 UDP, port 50100 modifiable, IP fixes, table IP ↔ piste       | conforme                                                                                                                                                    |
| § 3 HELLO toutes les 15 s, champs obligatoires seuls             | conforme ; sauf appareil déclaré `hello: false` (Saint-George SG31 / SG32 : un `HELLO` bloque son chrono jusqu'au redémarrage, ADR-0038)                    |
| § 3 Champ Compe (obligatoire)                                    | conforme : épreuve suivie par la piste (8 premiers caractères de son identifiant), reprise par les HELLO / ACK / NAK qui suivent le DISP                    |
| § 3 Champ Phase                                                  | conforme : tour de poules en cours ; tableau = dernier tour de poules + 1                                                                                   |
| § 3 Chrono (champ 10)                                            | conforme : centièmes obligatoires sous 10 s en EFP1.1, absents en EFP1                                                                                      |
| § 3 Longueurs maximales, syntaxe à deux niveaux, zones omises    | conforme (`codec.ts`)                                                                                                                                       |
| § 3 Identification des tireurs par Id, inversion droite / gauche | conforme (Id tronqué à 8 caractères, correspondance par préfixe)                                                                                            |
| § 3 Statut R5 / L5 lu seulement en fin de match                  | conforme ; renvoyé avec un match rappelé                                                                                                                    |
| § 3 Carton P (R12 / L12, EFP1.1)                                 | conforme, lu et repris dans le DISP                                                                                                                         |
| § 1 Compatibilité EFP1 / EFP1.1                                  | conforme : version imposée par piste, ou `auto` (version de la dernière trame reçue ; tant que l'appareil n'a rien répondu, le HELLO alterne EFP1.1 / EFP1) |
| § 4 END : fin correcte → ACK, incorrecte → NAK                   | conforme (individuel)                                                                                                                                       |
| § 4 Équipes : fin d'un relais intermédiaire toujours correcte    | conforme, y compris avec abandon ou exclusion (DT prévenu)                                                                                                  |
| § 4 Remplaçant : équipes seulement, annulable pendant le relais  | conforme (pris en compte à la fin du relais)                                                                                                                |
| § 5 Messages perdus (END ou ACK répété)                          | conforme : nouvel ACK, rien de réenregistré                                                                                                                 |

Écarts assumés :

| Écart                                                                                     | Raison                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NEXT sur un match chargé mais non terminé : le match courant est renvoyé, pas le suivant  | jamais d'abandon silencieux d'un assaut (question ouverte n°3 de #1829)                                                                                                                                                                                                                                        |
| PREV refusé au-delà de 3 minutes après la fin du match, ou si le match suivant a commencé | fenêtre de correction bornée (#1829, manque n°4)                                                                                                                                                                                                                                                               |
| Équipes, dernier relais : fin à vainqueur imposé (abandon, exclusion, V / D) → NAK        | le modèle d'équipe déduit le vainqueur du cumul ; la spécification la tient pour correcte. La priorité à égalité est acceptée (#2191)                                                                                                                                                                          |
| Correction depuis la tablette pendant le combat : envoyée par DISP                        | un appareil conforme **ignore** un DISP reçu en état actif (§ 4). La correction n'atteint donc un tel appareil qu'en attente (match rappelé, avant BEGIN) ; en plein combat, l'état suivant de l'appareil rétablit son score. Le simulateur applique ce DISP (hors spécification). À vérifier sur un SG32 réel |
| Compteur d'interventions médicales (R10 / L10)                                            | lu, non exploité                                                                                                                                                                                                                                                                                               |

## 3. Simulateur d'appareil

```bash
npm run cyrano:sim -- --server 127.0.0.1 --server-port 50100 --port 50101 --piste 1 --protocol EFP1.1
```

Le simulateur répond aux HELLO par un INFO complet, installe les DISP en état W (match en
cours : un DISP des mêmes tireurs corrige les scores), passe en W à la réception d'un ACK.
Ses commandes reprennent la télécommande WSG des Saint-Georges SG31 / SG32 :

| Groupe             | Commandes (console)                                                                                    | Touche de la télécommande                                                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chrono             | `stopgo` (`go`, `halt`), `pause`, `reset`, `round+` / `round-`, `clock+` / `clock-`, `init+` / `init-` | STOP/GO, PAUSE (minute de repos, état `P`), RESET (temps de la période), ROUND ∧∨, jaune CLOCK ∧∨ (±1 s), rouge RESET ∧∨ (durée ±1 min)                                                                                                 |
| Arme               | `weapon`, `epee` / `foil` / `sabre`                                                                    | touche arme, jaune + PAUSE / RESET / STOP/GO                                                                                                                                                                                            |
| Priorité           | `prio`, `pn` ; `pr` / `pl` (essais)                                                                    | ⚄ (tirage au sort), jaune P RESET                                                                                                                                                                                                       |
| Score              | `r+` `r-` `l+` `l-`, `yr` `yl` / `yr-` `yl-`, `rr` `rl` / `rr-` `rl-`, `swap`, `zero`, `cards0`        | ∧ ∨, jaune ∧∨ (carton jaune), rouge ∧∨ (carton rouge), ⟷, 0:0, jaune CARDS RESET                                                                                                                                                        |
| Cartons P (EFP1.1) | `pcr+` `pcr-` `pcl+` `pcl-`                                                                            | champ 12 de la zone du tireur, 0 à 5 : 1 jaune P, 2 rouge P, 3 deux rouges P, 4 noir P, 5 deux noirs P ; ∧ monte d'un cran, ∨ descend ; `cards0` les efface ; repris d'un DISP (match rappelé, correction) ; absents des trames en EFP1 |
| Bloc PC            | `next`, `prev`, `begin`, `end` (`validate`), `ar` / `al`, `er` / `el`, `resr` / `resl`, `mr` / `ml`    | vert NEXT, PREVIOUS, BEGIN, VALIDATE ; jaune ABANDON, RESERVE ; rouge EXPULSION, assistance médicale                                                                                                                                    |
| Appareil           | `raz`, `show`, `quit`                                                                                  | extinction / rallumage                                                                                                                                                                                                                  |

- Chrono à 0:00 : GO refusé (comme l'appareil). `pause` lance la minute de repos ; à sa fin,
  le temps de la période revient et la période passe à la suivante ; `reset` l'écourte.
- `reset` ne remet que le chrono ; `raz` efface tout (tireurs, scores, cartons, chrono).
- NAK (fin refusée) : l'appareil revient en halte, l'arbitre corrige puis valide à nouveau
  (spéc. § 4). Un DISP des mêmes tireurs reçu en plein combat corrige les scores : c'est une
  facilité du simulateur, un appareil conforme l'ignore.
- Équipes (DISP `Type=T`) : `Round` = n° du relais fixé par le logiciel (`round+` / `round-`
  refusés), scores cumulés repris de chaque DISP de relais, `resr` / `resl` = demande d'entrée du
  remplaçant (champ 11 = `R`, effacé au DISP du relais suivant) ; `snapshot()` expose `team` et
  `relay`.
- Une commande impossible dans l'état courant est refusée avec sa raison (même règle pour la
  télécommande web, qui grise le bouton).

Déclarer la piste côté serveur avec l'IP `127.0.0.1` et le port du simulateur (`--port`).

### Rejeu d'un journal de trames (#2001)

Le journal exporté du panneau (« Exporter le journal », une trame par ligne :
`horodatage ⇥ IN/OUT ⇥ ip:port ⇥ piste ⇥ trame [⇥ rejet]`) se rejoue vers le logiciel : seules les
trames `IN` (appareil → logiciel) sont renvoyées, **au rythme d'origine** (`--speed N` = N fois plus
vite, par exemple 10) ; les trames `malformed` sont écartées. Pour reproduire un incident constaté
en salle sans l'appareil :

```bash
npm run cyrano:sim -- --replay cyrano-2026-11-19-10-00-00.log --piste 3 --bind 127.0.0.3 --port 50103 --speed 5
```

- `--piste` : obligatoire si le journal contient plusieurs pistes (une adresse source par rejeu).
- `--bind` : le logiciel identifie la piste par l'**IP source** ; il faut donc l'IP déclarée pour
  cette piste dans la table (en local : `127.0.0.N`, § « Plusieurs simulateurs »). Une autre IP est
  journalisée `unknown_ip` et ignorée.
- Les trames reçues en retour (DISP, ACK, NAK) sont affichées (`←`), les trames envoyées aussi (`→`).
  Le rejeu n'embarque pas l'état de l'appareil : il ne répond pas aux HELLO ni aux DISP.
- Analyse du format : `scripts/lib/cyranoReplay.js` (fonctions pures, testées).

### Télécommande web (plusieurs pistes)

```bash
npm run cyrano:remote          # 3 pistes par défaut, page http://127.0.0.1:5099
npm run cyrano:remote -- --count 16   # pistes 1 à 16 : 127.0.0.N, port 50100 + N
npm run cyrano:remote -- --pistes 1@127.0.0.1:50101,2@127.0.0.2:50102 --server-port 50100
```

Une carte par piste : état de l'appareil, chrono, période et durée, tireurs gauche (rouge) /
droite (vert), boutons groupés comme sur la télécommande (bloc PC, chrono, arme, score, cartons,
priorité, cartons P par côté), libellés colorés selon la touche de mode, et journal des trames (HELLO masqués).
Au-delà de 4 pistes, les cartes s'ouvrent repliées sur une ligne (état, chrono, tireurs et score) ;
un clic sur l'en-tête déplie la télécommande, boutons « Tout déplier / Tout replier » en haut.
Les appareils correspondants se déclarent sur la salle (Paramètres → Salles et pistes : protocole
Cyrano, IP `127.0.0.N`, port `50100 + N`), ou par le contrat (`setStripDevice`) ; le serveur les
charge au démarrage. Mêmes appareils simulés que la console
(`scripts/lib/cyranoDevice.js`). Ne pas lancer en même temps un simulateur console sur les mêmes ports.

Plusieurs simulateurs sur un même poste : le logiciel identifie une piste par son **IP**, donc
une adresse de bouclage par simulateur (`--bind`). Sous Linux, toute la plage `127.0.0.0/8`
répond sans configuration ; sous macOS : `sudo ifconfig lo0 alias 127.0.0.2`.

```bash
npm run cyrano:sim -- --piste 1 --bind 127.0.0.1 --port 50101
npm run cyrano:sim -- --piste 2 --bind 127.0.0.2 --port 50102
npm run cyrano:sim -- --piste 3 --bind 127.0.0.3 --port 50103
```

## 3 bis. Recette sur appareil réel (SG32) (Réf. #2002)

Cases à cocher lors d'une validation en salle avec un ou plusieurs Saint-George SG32 (version
d'appareil, IP et firmware notés dans le compte rendu). Préparation : poste et appareils sur le
même sous-réseau (`192.168.1.0/24`), pare-feu ouvert en entrée UDP 50100, piste déclarée en mode
`maître` avec l'IP `192.168.1.(100 + piste)` (profil `Saint-George`), journal des trames affiché.
Chaque anomalie : exporter le journal (il se rejoue dans le simulateur, § 3) et le joindre au ticket.

**Liaison**

- [ ] **Appairage de la télécommande** : socle de charge, la télécommande n'agit sur l'appareil
      qu'après appairage ; vérifier qu'elle pilote bien l'appareil voulu (une seule piste à la fois).
- [ ] **Ports** : l'appareil écoute sur **50101** et émet depuis 50101 en diffusion vers
      `192.168.1.255:50100` ; le poste reçoit (piste « en ligne », pastille verte), le DISP arrive
      bien sur 50101. Piste « jamais vue » : pare-feu, interface d'écoute, IP de la table.
- [ ] **Version EFP1.1** : la version détectée affichée à côté de la piste est `EFP1.1` (champ 12 des
      zones tireur présent), déduite des INFO spontanés (aucun HELLO, ADR-0038).
- [ ] **Aucun HELLO** : journal sans `OUT … HELLO` vers les SG32 ; GO de la télécommande lance
      le chrono, pilote démarré.
- [ ] **Rythme des INFO** : un INFO toutes les 2 à 4 s à l'arrêt, au plus 1 par seconde chrono en
      marche ; aucune trame collée perdue (datagramme de plusieurs trames : la dernière fait foi).

**Match**

- [ ] **DISP** : au chargement, noms (10 à 20 caractères, translittérés), nations, arme et champ
      Compe affichés ; l'inversion droite / gauche à l'appareil ne perturbe pas les scores
      (suivi par Id).
- [ ] **DISP ignoré en plein combat** : modifier le score depuis la tablette arbitre pendant un
      assaut (appareil en `F` ou `H`). Un appareil conforme ignore ce DISP (§ 2 nonies) : noter si
      le score de l'appareil revient ou non à l'INFO suivant, et que la tablette suit l'appareil
      (correction tablette en mode maître : à confirmer).
- [ ] **Repos + ouverture du match sur la tablette** (#1999) : lancer la minute de repos sur
      l'appareil (`P`, PAUSE), ouvrir le match sur la tablette pendant ce temps : le score affiché
      n'est pas remis à zéro, le repos n'est pas interrompu, le chrono du combat reprend après le
      repos.
- [ ] **PAUSE / fin de pause** : PAUSE lance le décompte de 1:00 (état `P`) sans modifier le
      chrono du combat côté logiciel ; à la fin, période suivante, score et cartons conservés.
- [ ] **Sabre, 8 touches** (t.39.1) : tableau à 15, sabre, un tireur atteint 8 : la tablette annonce
      la pause (sans seconde minute de repos lancée par la tablette, l'appareil maître tient son
      chrono) ; avec une tablette seule (mode manuel), elle arrête le chrono et lance la minute.

**Télécommande vers le logiciel**

- [ ] **NEXT** : appareil libre (`W`) : le match suivant de l'arène est envoyé (DISP) ; sur un match
      non terminé : le match courant est renvoyé, jamais d'abandon silencieux.
- [ ] **PREV** : juste après un VALIDATE (moins de 3 min), PREVIOUS rappelle le match terminé :
      DISP avec scores et cartons, correction, nouveau VALIDATE → ACK. Au-delà de 3 min ou en plein
      combat : refus, DISP du match courant. Même contrôle avec le bouton « Match précédent » de la
      tablette (notification du verdict).
- [ ] **VALIDATE** : fin valide → ACK, l'appareil repasse en `W` ; fin invalide (scores égaux sans
      priorité) → NAK, retour en halte, correction puis nouvelle validation.
- [ ] **Abandon** (ABANDON droite / gauche, puis VALIDATE) : fin acceptée, vainqueur = l'autre
      tireur, statut `A` repris ; le match rappelé (PREV) conserve l'abandon.
- [ ] **Exclusion** (EXPULSION) : fin acceptée, tireur exclu, DT prévenu (rapport FFE si carton
      noir) ; statut `E` repris.
- [ ] **Cartons P** (EFP1.1, champ 12) : jaune P, rouge P (×1 puis ×2), noir P (×1 puis ×2) :
      valeurs 1 à 5 reprises dans le journal, cartons enregistrés (`p-yellow` / `p-red` /
      `p-black`) et visibles sur la feuille ; DISP suivant renvoie le niveau (t.124 : 0, 1, 2 ou 4).

**Affichage seul**

- [ ] **Sabre laser** et **arme personnalisée** : DISP noms + score, champ arme vide, aucune
      commande de la télécommande prise en compte par le logiciel (mode `display` forcé).

Compte rendu : date, appareils (n° de série, firmware), cases cochées, écarts avec §§ 2 nonies et 4,
journaux joints.

## 4. Décisions (#1720)

| Sujet                                     | Décision                                                                                                                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mode par défaut d'une piste avec appareil | **Appareil maître** : score, cartons et chrono viennent de l'appareil ; tablette en miroir ; END sur l'appareil → ACK / NAK. Modes « afficheur » et « manuel » disponibles par piste. |
| Champ « nation » (3 caractères)           | **Réglage par compétition** : pays, club ou ligue ; `auto` = pays si compétition internationale, club sinon (`pickCyranoNat`).                                                        |
| Correction de score en mode maître        | **Arbitre et DT** depuis la tablette ; la correction est renvoyée à l'appareil par un DISP avec scores.                                                                               |
| Sabre laser et armes personnalisées       | **Affichage seul** : DISP noms + score, champ arme vide, pas de télécommande.                                                                                                         |

## 5. Suite prévue (#1720)

1. Socle arènes : source d'entrée et numéro de séquence (`ArenaInputGate`, fait #1829), validation unifiée.
   - **Couche multi-protocole** (fait, #1829, § 2 septies) : modèle d'état de piste commun
     (`PisteState`, `PisteInput`, `PisteCommand`) et pilotes déclarant leurs capacités
     (noms, télécommande, ACK, chrono, cartons P, équipes). `CyranoPisteDriver` est le premier
     pilote ; RS422-FPA, Favero série (lecture seule) et OPP2/MQTT suivront sans toucher aux arènes.
   - **Une seule validation de fin** (fait, #1829) : `shared/domain/match/matchEndValidation.ts`
     (`validateMatchEnd`, `decideMatchWinner`, `resolveScoreLimit`, `passivityWinner`,
     `crossedSabreBreak`) utilisé par `piste/pisteState.ts` (fin d'appareil), `matchRoutes.ts`, `matchFinish.ts` et
     `arenaOps.ts` ; `scoreValidation.ts` (jamais appelé) supprimé.
   - **Pause sabre à 8 touches** (t.39.1, fait, #2001) : au sabre, en tableau à 15 touches,
     `arenaOps.ts` détecte le franchissement de 8 (`crossedSabreBreak`, une fois par franchissement)
     et émet `arena:{id}:sabre_break` ; la tablette arrête le chrono et lance la minute de repos
     (mécanisme de repos existant, chrono d'avant restauré à la fin). Avec un appareil maître, la
     tablette n'annonce que la pause : l'appareil tient son chrono.
   - **Chrono tenu côté serveur** en individuel, alimenté par la source maîtresse (appareil ou
     tablette) : référence pour la tablette en miroir.
2. Pilote Cyrano en lecture (mode afficheur), supervision dans l'interface.
3. Télécommande : NEXT / PREV via `arenaQueue`, END → ACK / NAK → `matchFinish`, alerte BAD MATCH.
   - PREV : rappel du match précédent (`recallPrevMatch`, #1852), fenêtre de correction de 3 min
     (cf. Engarde), relié à la touche PREVIOUS de l'appareil.
4. Interface : appareils déclarés sur la salle (ADR-0023), format des noms.
   - Actions de secours par piste : ACK forcé, passage en manuel, NEXT envoyé depuis le poste,
     remise à zéro de l'affichage.
   - Mur de pistes (mini-vues en grille).
   - Écoute limitée à l'interface réseau choisie ; journal des trames exportable et rejouable
     dans le simulateur (`--replay`, § 3).
5. Vue arbitre : bandeau appareil, choix de match → DISP.
6. Cartons P, équipes (`Type=T`, relais, remplaçant) — faits (#1829), sauf format « arène laser ».

Suivi de #1829 : modes, bascule hors ligne, notification BAD MATCH et reprise des arènes livrés ;
PREV (appareil, poste et bouton « Match précédent » de la tablette, #2001), bandeau arbitre, table
des pistes en base, profils constructeur, ajout en lot et import / export livrés ; les extensions
restent ouvertes.

Livré ensuite (#1829) : cartons de la feuille de poule et de la feuille de match de tableau
imprimées, **cartons P à part** (t.124.3.e, § 2 sexies) ; reprise du chrono au redémarrage
(§ 2 quater) ; **rapport d'exclusion pré-rempli**
pour la FFE (carton noir, annexe 14 : Résultats → Export → « Rapport FFE (carton noir) »).
Depuis #2190 : aussi proposé sur l'appel DT d'un carton noir (« Rapport carton noir (PDF) ») ;
heure, match et source (écran, tablette, appareil, agent) lus au journal (`FencerWithdrawn`) ;
motifs du 4e groupe de l'arme à cocher, plus « Cumul de cartons » et « Autre ».

Questions encore ouvertes : rattachement des sous-arènes (`arena3s2`) à un appareil ;
second poste BPM - Escrime en secours (maître / esclave, cf. Fencing Fox).
