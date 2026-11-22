# ADR-0022 — Les fonctions du poste entrent dans le contrat, sans journal et jamais sur le réseau

- **Statut** : Proposée
- **Date** : 2026-11-22
- **Tickets** : #1981 (lot 2, suite), épique #1978

## Contexte

Après #2110, 107 fichiers de l'écran appellent encore `window.electronAPI`. Le contrat couvre
les faits de l'épreuve (ADR-0005, 0017), l'inscription (ADR-0018), les relevés et la vue DT
(ADR-0020). Les fonctions du poste (ADR-0021) couvrent fichiers, impression et liens. Restent les
fonctions qui pilotent le poste lui-même. Relevé sur `dev` :

| Groupe                                                       | Appels | Fichiers | Nature                                                                                                           |
| ------------------------------------------------------------ | -----: | -------: | ---------------------------------------------------------------------------------------------------------------- |
| `remote.*`                                                   |     87 |       32 | Serveur distant de l'épreuve : démarrage, mots de passe, thèmes, kiosque, clients, note d'organisation, webhooks |
| `club.*`                                                     |     20 |       15 | Mode Club : membres, séances, pointage, combats libres (données en base)                                         |
| `cyrano.*`                                                   |     18 |        2 | Appareils de piste : pistes, démarrage UDP, statuts, journal                                                     |
| `training.*`                                                 |     15 |        4 | Serveur d'entraînement                                                                                           |
| `settings.*`, `themes.*`, `eventDay.*`, `privacy.*`, `mcp.*` |     22 |       15 | Réglages du poste, thèmes, journée multi-épreuves, RGPD, agent                                                   |
| `on…` (préload)                                              |     26 |      ~20 | Avis du main : match fini sur une tablette, appel du DT, arène mise à jour, clients connectés                    |

Ces appels passent par environ 345 canaux `ipcMain.handle` écrits à la main, avec leur propre
validation et leurs propres formes d'erreur. Le CLAUDE.md interdit déjà d'en ajouter.

## Décision

**Périmètre**

- Ces fonctions deviennent des opérations du contrat, déclarées par groupe dans un fichier à
  part, comme `contractDtView.ts` et `contractReports.ts` : `contractRemote.ts`,
  `contractClub.ts`, `contractDevices.ts` (Cyrano, OPP2), `contractStation.ts` (réglages, thèmes,
  journée, RGPD, agent, entraînement).
- Le nommage suit l'[ADR-0008](0008-nommage-contrat.md) : verbe et objet, `get…` / `list…`,
  `on…`. Pas de recopie des noms de canaux (`remote:setCheckinPassword` devient
  `configureCheckin`).

**Droits**

- On ajoute des droits au type `Permission` :
  - `remote:admin` : pilotage du serveur distant et des appareils de piste ;
  - `club:read` et `club:write` : Mode Club ;
  - `station:admin` : réglages du poste, thèmes, RGPD, agent, entraînement.
- Aucun de ces droits n'entre dans `WS_READ_PERMISSIONS` : ces opérations ne sont **jamais**
  servies sur le réseau, ni à la vue DT. Un test le vérifie pour chaque opération.
- Exposition MCP au cas par cas (`mcp:` sur l'opération), jamais pour un mot de passe ou un
  secret. Les outils MCP d'administration existants passent par la même opération.

**Pas de journal**

- Ce ne sont pas des faits de l'épreuve : aucune de ces commandes n'écrit au journal
  ([ADR-0005](0005-journal-un-fait-un-chemin.md)). Une opération qui touche aussi l'épreuve
  appelle la commande de l'épreuve, qui journalise.

**Accès aux services du main**

- Les handlers ne touchent pas Electron. Ils reçoivent des **ports** par le `CommandContext`, comme
  `remote.dtView` aujourd'hui :
  - `ctx.remote` : serveurs distants par épreuve ;
  - `ctx.devices` : Cyrano, OPP2 ;
  - `ctx.training` ;
  - `ctx.station` : réglages, thèmes, agent.
- `main.ts` branche ces ports. La logique des fichiers `ipc/*Handlers.ts` migre dans
  `src/main/engine/commands/station/`, et chaque canal `ipcMain.handle` disparaît quand plus
  rien ne l'appelle. Le cliquet `ipcChannels` le suit.

**Avis du main**

- Les avis `on…` du préload deviennent des abonnements du contrat, selon l'[ADR-0010](0010-bus-evenements.md) :
  - `onRemoteActivity({ competitionId })` : match fini, tireur exclu ou réintégré, arbitre
    changé, pointage, signatures, appel du DT ;
  - `onRemoteClients({ competitionId })` : clients connectés ;
  - `onTrainingActivity()`.
- Chaque avis est une union typée par `kind`. Il porte des identifiants et l'état strictement
  nécessaire à l'affichage, comme les messages Socket.IO actuels.
- Quand l'avis signale un changement de données, l'écran relit par une requête : le contenu ne
  fait pas foi.

**Ordre**

1. `club.*` : données en base, commandes et requêtes simples.
2. Réglages, thèmes, journée, RGPD.
3. `remote.*`, puis ses avis.
4. Appareils de piste et entraînement.

Une PR par groupe, chacune avec la baisse des cliquets `electronApiCalls` et `ipcChannels`.

## Conséquences

- À la fin, l'écran n'appelle plus `window.electronAPI` qu'à travers `IpcClient` et
  `ElectronPlatform`. Le critère « compteur à 0 » de #1981 devient atteignable, en plus de
  #2100 pour les épreuves par équipes.
- Le serveur headless (#1982) peut piloter un poste par le même contrat.
- Les validations de `ipc/validation.ts` passent dans les schémas zod.
- `docs/API_CONTRACT.md` liste les opérations du poste dans une section à part.
- Coût : plusieurs PR moyennes. La mise à jour automatique et la boîte d'impression intégrée
  restent propres à Electron (ADR-0021).

## Alternatives écartées

- **Laisser ces canaux hors contrat** : le compteur ne descendrait jamais à 0, et les deux mondes
  (contrat et canaux faits main) coexisteraient avec deux validations.
- **Les servir sur le réseau derrière le mot de passe DT** : piloter le poste à distance
  (arrêter le serveur, changer un mot de passe) sans compte ni journal est trop risqué. Cela
  attend #1982.
- **Un seul fichier de contrat** : `contract.ts` est déjà au plafond de 1 500 lignes.
- **Journaliser les réglages** : le journal de l'épreuve resterait mélangé à l'administration du
  poste, et le rejeu devrait les ignorer.
