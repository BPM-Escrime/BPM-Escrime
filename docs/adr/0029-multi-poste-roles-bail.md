# ADR-0029 — Multi-poste : comptes par fonction, droits fins, bail par épreuve en mémoire

- **Statut** : Proposée
- **Date** : 2026-11-24
- **Tickets** : #1982, épique #1978. Remplace la section « Lecture seule tant que #1982 n'est pas
  livré » de l'[ADR-0020](0020-transport-websocket-contrat.md)

## Contexte

#1982 demande de piloter chaque épreuve d'une journée depuis un poste différent, avec des rôles
(DT général, DT d'épreuve, assistant, pointage, arbitre, public) et un bail par épreuve.

Faits :

- Le contrat déclare un droit (`Permission`, `contractDef.ts`) sur chaque opération. Aucun
  transport ne le contrôle. Les droits sont trop gros pour les rôles de #1982 :
  - `score:write` couvre à la fois `recordScore` (saisie) et `generatePools`, `closePoolRound`,
    `generateTableau`, `clearTableau`, `adjustRanking` (structure de l'épreuve) ;
  - `checkIn` est en `fencers:write`, comme `registerFencers` et `withdrawFencer`.
- `/api` (Socket.IO, [ADR-0020](0020-transport-websocket-contrat.md)) est en lecture seule et ne
  sert que l'épreuve du serveur distant. Son seul accès est le mot de passe « Vue DT ».
- Le journal a déjà les colonnes `author` et `source` ([ADR-0007](0007-format-evenement.md)).
- Les tablettes d'arbitre ont un mot de passe par arène et un jeton `bp_token_arena{N}`.
- `--headless` existe (`cliArgs.ts`) : moteur, serveur distant et MCP sans fenêtre.
- Les réglages du poste vivent dans des fichiers de `<userData>` (`privacy-settings.json`), pas
  dans la base de l'épreuve.

## Décision

### Droits : on découpe `score:write` et `fencers:write`

- On ajoute deux droits au contrat :
  - `checkin:write` : `checkIn` ;
  - `structure:write` : `generatePools`, `addPoolFencer`, `closePoolRound`, `skipPools`,
    `generateTableau`, `clearTableau`, `adjustRanking`, `rebuildCompetitionState`, et les
    commandes des vagues de rapières.
- `score:write` ne garde que la saisie : `recordScore`, `clearScore`, et les cartons.
- Le type `Permission` du contrat devient le type `AccessRight` de
  `src/shared/domain/stations/roles.ts`. Une seule liste, pas de copie.
- `contractNaming.test.ts` vérifie que chaque opération qui porte `competitionId` a un droit
  d'épreuve, et qu'aucune opération d'épreuve n'a un droit du poste.

### Rôles : une matrice pure, dans le domaine

- La matrice rôle → droits est une règle pure : `src/shared/domain/stations/roles.ts`.

| Rôle                  | Droits                                                                                                             | Portée                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `admin`               | tous                                                                                                               | tout                                           |
| `dayDirector`         | tous sauf `station:admin`, `remote:admin` ; gère les baux                                                          | la journée                                     |
| `competitionDirector` | lecture, `competition:write`, `fencers:write`, `referees:write`, `structure:write`, `score:write`, `checkin:write` | écriture : épreuves du bail ; lecture : toutes |
| `assistant`           | lecture, `score:write`, `checkin:write`                                                                            | épreuves désignées                             |
| `checkIn`             | lecture, `checkin:write`                                                                                           | épreuves désignées                             |
| `referee`             | lecture, `score:write`                                                                                             | son arène                                      |
| `public`              | `competition:read`, `cards:read`                                                                                   | tout, filtré par `publicDto`                   |

- « Épreuves désignées » : liste d'épreuves du compte. Liste vide = toutes les épreuves de la
  journée.
- Le moteur vérifie le droit dans l'adaptateur, avant la validation de l'entrée, comme
  `wsRefusal` aujourd'hui. Un refus rend `permission_denied`. L'écran ne vérifie rien.
- Le rôle `referee` reste le mot de passe par arène existant (question 3 de #1982) : un jeton
  `bp_token_arena{N}` vaut un compte `referee` limité à l'arène `N`. Pas de migration des
  tablettes.

### Comptes : par fonction, PIN ou QR, hors de la base

- On crée des comptes **par fonction** (« Pointage-1 », « DT M15 H »), avec un nom libre
  facultatif (question 1 de #1982). Pas de compte nominatif obligatoire le jour J.
- Connexion par code PIN de 6 chiffres, haché (scrypt, comme `auth.ts`), avec les limites de
  tentatives du serveur distant. Ou par QR code à usage unique, valide 5 minutes, affiché par le
  DT général.
- La connexion rend un jeton de session (cookie `bp_station_token`, 8 h), révoqué quand le compte
  est supprimé ou son PIN changé.
- Les comptes sont une fonction du poste qui héberge le moteur
  ([ADR-0022](0022-fonctions-du-poste-contrat.md)) : fichier `<userData>/station-accounts.json`,
  commandes du contrat en `station:admin`, jamais servies sur le réseau. **Aucune migration SQL.**
- **Sans compte, rien ne change** : pas de fichier ou fichier vide → le poste local est `admin`,
  `/api` reste en lecture seule (ADR-0020). Le mode multi-poste s'active à la création du premier
  compte.

### Bail par épreuve : en mémoire, dans le moteur

- Règle pure : `src/shared/domain/stations/lease.ts`. Heure injectée.
- États : `free`, `held`, `orphaned`. Battement attendu toutes les 20 s
  (`LEASE_HEARTBEAT_MS`) ; `orphaned` après 60 s sans battement (`LEASE_ORPHAN_MS`).
- Prendre : permis si l'épreuve est libre, ou si le bail (même orphelin) est déjà au même poste.
  Une épreuve `held` ou `orphaned` chez un autre poste est refusée (`lease_held`).
- Transférer : `dayDirector` ou `admin` seulement, quel que soit l'état. L'ancien poste passe en
  lecture seule à son prochain appel.
- Rendre : le poste qui tient le bail seulement.
- Les commandes d'orchestration exigent le bail du poste appelant : droits `structure:write`,
  `competition:write`, `fencers:write`, `referees:write` sur une épreuve. Sinon `lease_required`.
- Les saisies (`score:write`, `checkin:write`) ne demandent pas de bail.
- `admin` et `dayDirector` ne passent pas outre le bail : ils le transfèrent d'abord. Un seul
  poste orchestre une épreuve à un instant donné.
- Le bail vit en mémoire du moteur, jamais en base : un redémarrage du moteur rend toutes les
  épreuves libres. Le journal et `expectedRevision` ([ADR-0006](0006-expected-revision.md))
  protègent déjà les données contre deux écritures croisées.
- En mode poste seul, le poste local tient implicitement le bail de toutes les épreuves.

### Opérations du contrat (nommage [ADR-0008](0008-nommage-contrat.md))

- `takeCompetitionLease`, `renewCompetitionLease`, `releaseCompetitionLease`,
  `transferCompetitionLease` (`competitionId`, `stationId`) ;
- `listStations` (appareil, compte, rôle, baux, dernier contact) et `onStations` ;
- `createStationAccount`, `updateStationAccount`, `deleteStationAccount`, `listStationAccounts`,
  `createStationInvite` (QR à usage unique) — en `station:admin`.
- Codes d'erreur ajoutés au catalogue ([ADR-0009](0009-codes-erreur.md)) : `lease_held`,
  `lease_required` (catégorie `conflict`), `invalid_credentials` (catégorie `permission`).

### Journal

- `author` = identifiant du compte, `source` = `station` pour un poste distant (Electron client ou
  navigateur), `tablet` inchangé pour les arènes. Identifiants seulement, pas de nom
  ([ADR-0007](0007-format-evenement.md)). L'appareil est l'identifiant de session du poste,
  ajouté à `author` (`<compte>@<poste>`). **Pas de nouvelle colonne.**

### Serveur headless

- `--headless` reste le seul mode serveur. Le même binaire sert de poste et de serveur.
- Image Docker `bellepoule-modern-server` : Electron sous `xvfb-run`, base dans un volume monté
  sur `<userData>`. Paquet `deb` arm64 avec un service systemd pour le Raspberry Pi.
- Annonce mDNS `_bpm-escrime._tcp` du port du serveur distant, plus un QR « Rejoindre la salle ».
- Pas de bascule automatique vers un second moteur (question 2 de #1982) : reprise manuelle depuis
  une sauvegarde.

## Conséquences

Ordre de livraison (PR séparées, en draft, revue du mainteneur) :

1. Cette ADR, et le domaine pur `stations/` (`roles.ts`, `lease.ts`) avec ses tests.
2. Découpage des droits dans le contrat, `Permission = AccessRight`, test de nommage.
3. Comptes, PIN, QR, jeton ; contrôle des droits dans `wsAdapter.ts` à partir du rôle.
   Mise à jour de `docs/SECURITE_SAISIE_DISTANTE.md`.
4. Bail dans le moteur, battement, transfert, écran « Postes connectés ».
5. Electron en mode client (`WsClient` vers un moteur distant).
6. Docker, systemd, mDNS ; `docs/JOURNEE_MULTI_EPREUVES.md`.

Points de vigilance :

- Ouvrir l'écriture sur `/api` multiplie la surface d'attaque : chaque commande refusée sans
  rôle doit l'être avant la validation de l'entrée, et testée.
- Les tablettes et appareils de piste gardent leurs chemins actuels (`recordScore` par
  `scoreCommand.ts`) : pas de bail, droit `score:write`.
- Interdit : contrôler un droit dans l'écran ; stocker un PIN en clair ; écrire le bail en base.

## Alternatives écartées

- **Garder les droits actuels et vérifier le nom de l'opération par rôle** : la règle quitterait
  le contrat ; chaque nouvelle commande demanderait une liste à part.
- **Comptes nominatifs obligatoires** : trop lent à créer le jour J ; le nom reste facultatif.
- **Comptes et baux en base SQL** : migration de schéma pour des données du poste et de la
  journée, pas de l'épreuve ; le bail est éphémère par nature.
- **Bail persistant** : après une panne du moteur, des baux fantômes bloqueraient les épreuves.
- **Passe-droit du DT général sans transfert** : deux postes orchestreraient la même épreuve.
- **Bascule automatique vers un moteur de secours** : réplication du journal, élection ; coût
  sans rapport avec un jour de compétition de club.
