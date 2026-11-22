# ADR-0020 — Le contrat passe aussi par Socket.IO : `WsClient`, en lecture seule d'abord

- **Statut** : Proposée
- **Date** : 2026-11-22
- **Tickets** : #1981 (lot 3), #1982, épique #1978

## Contexte

Le contrat (`src/shared/api/contract.ts`) n'a aujourd'hui que deux transports :

- l'IPC Electron, par `ipcAdapter.ts` et `IpcClient` ;
- le MCP, par `mcpAdapter.ts`.

Le lot 3 de #1981 demande un troisième transport : la vue du DT d'une épreuve doit s'ouvrir dans
un navigateur sur le réseau de la salle, branchée sur le moteur d'un autre poste.

Faits :

- Le serveur distant (`remoteScoreServer.ts`, Express 5 et Socket.IO 4.8, port 8066, HTTPS
  proposé par défaut) existe déjà. Il plafonne les connexions par IP et le débit par socket
  (`socketHandlers.ts`).
- Ses espaces protégés (appel, formateurs, arènes) suivent tous le même modèle :
  - un mot de passe par espace, stocké haché ;
  - un jeton de session en cookie (`auth.ts`, `accessGuards.ts`, validité 8 h).
- Les droits du contrat (`Permission`) sont déclarés sur chaque opération, mais aucun transport
  ne les contrôle. Les comptes et les rôles relèvent de #1982.
- Tout ce qui sort sur le réseau passe par `publicDto.ts`, selon le réglage RGPD des noms sur le
  réseau (`docs/RGPD.md`) : la licence, la date de naissance et l'IP sont toujours retirées.
- 112 fichiers de l'écran appellent encore `window.electronAPI`. L'application React entière
  ne peut donc pas encore tourner dans un navigateur, et l'interface `PlatformServices` (lot 4)
  n'existe pas.
- Le bundle de l'écran est compilé pour la cible `electron-renderer`.

## Décision

### Transport

- On garde Socket.IO, ce qui répond à la question de #1981. Il est déjà servi, protégé et
  relancé par le serveur distant, et il gère la reconnexion.
- On ajoute un espace de noms dédié, `/api`, sur le serveur existant, sans nouveau port.
- Trois messages, qui reprennent les trois canaux de l'IPC :
  - `api:invoke` avec `(name, input)` → `ApiEnvelope` ;
  - `api:subscribe` avec `(id, name, input)`, puis des émissions `api:event` avec `(id, event)` ;
  - `api:unsubscribe` avec `(id)`.
- L'enveloppe et les codes d'erreur sont ceux de l'IPC (`invokeEnvelope`,
  [ADR-0009](0009-codes-erreur.md)). Une entrée invalide est refusée avec la même erreur, quel
  que soit le transport.
- Les abonnements d'un socket sont libérés à sa déconnexion. Le plafond par IP et le seau à
  jetons des sockets existants s'appliquent aussi à `/api`.

### Lecture seule tant que #1982 n'est pas livré

- L'adaptateur WebSocket n'accepte que les requêtes et les abonnements dont le droit est
  `competition:read` ou `cards:read`.
- Toute commande, et toute opération d'un autre droit, est refusée avec `permission_denied`,
  avant même la validation de l'entrée.
- La liste des droits admis est une constante de l'adaptateur, testée. #1982 la remplacera par
  le rôle du compte connecté.

### Accès

- On crée un espace protégé « Vue DT », sur le même modèle que l'appel :
  - désactivé par défaut ;
  - un mot de passe haché, avec la même exigence de robustesse (`assertPasswordStrength`) ;
  - un jeton en cookie `bp_dt_token`, valide 8 h, invalidé quand le mot de passe change ;
  - les mêmes limites de tentatives de connexion.
- Le handshake de `/api` refuse un socket sans jeton valide.
- L'espace s'active et se règle par des commandes du contrat, depuis l'écran du poste serveur.
  Il n'y a pas de nouveau canal `ipcMain.handle`.

### Données

- Chaque sortie passe par le filtre de `publicDto.ts`, comme le reste du serveur distant :
  - les noms suivent le réglage RGPD ;
  - la licence, la date de naissance et l'IP sont retirées.
- Le filtre s'applique dans l'adaptateur, pas dans les handlers. L'IPC et le MCP local gardent
  les données complètes.

### Client et page

- `WsClient` (`src/renderer/api/WsClient.ts`) implémente `BpmClient` avec `socket.io-client`.
  - Ce paquet entre en devDependency, regroupé par Webpack, à la même version que le serveur.
  - Les pages distantes utilisent déjà ce client, servi en `/socket.io.min.js`.
  - Après une reconnexion, il rouvre ses abonnements.
  - Une coupure en cours d'appel rend `ApiError('unavailable')`.
- La vue DT est une entrée Webpack à part (`dt`, cible `web`), servie par le serveur distant
  sous `/dt/`. Elle n'embarque que des composants qui n'appellent plus `window.electronAPI` :
  - liste des épreuves ;
  - état de l'épreuve (`getCompetitionState`), avec poules, tableau et classement ;
  - historique (`getCompetitionTimeline`).
- La page se met à jour par `onCompetitionEvents`, puis par les abonnements de
  l'[ADR-0010](0010-bus-evenements.md) quand ils remplaceront celui-ci : signal reçu, puis
  relecture.
- L'application React entière dans un navigateur attend le cliquet `electronApiCalls` à 0 et
  `PlatformServices` (lot 4). Ce n'est pas l'objet de cette ADR.

## Conséquences

Ordre de livraison, en plusieurs PR :

1. Adaptateur `/api` côté serveur, avec ses tests : droits refusés, erreurs identiques à
   l'IPC, filtre RGPD, libération des abonnements.
2. `WsClient` et ses tests, sur un serveur Socket.IO de test.
3. Espace « Vue DT » : commandes de réglage, cookie, handshake. Mise à jour de
   `docs/SECURITE_SAISIE_DISTANTE.md` et de `docs/RGPD.md`.
4. Entrée `dt` et page en lecture seule. Mise à jour de `docs/SOCKET_EVENTS.md` et de
   `docs/API_CONTRACT.md`. Test E2E : la page s'ouvre dans le navigateur et suit un score saisi
   sur le poste.

Points de vigilance :

- Le bundle `dt` entre dans le budget de `check:bundle-size`, avec un plafond à part.
- La CSP du serveur distant (`csp.ts`) n'autorise aucun script en ligne : la page `dt` charge
  uniquement ses fichiers.
- Interdit : exposer une commande sur `/api` avant #1982, ou contourner le filtre `publicDto`
  pour la vue DT.
- Reste à faire : #2100 (tableaux séparés, équipes) et la suite du lot 2 pour que l'application
  entière passe par `WsClient`.

## Alternatives écartées

- **WebSocket natif (`ws`)** : il faudrait recoder la reconnexion, le plafond par IP et le
  limiteur de débit. Socket.IO est déjà servi et protégé.
- **Une API REST (OpenAPI)** : elle ne porte pas les abonnements. Elle reste possible plus tard
  pour des intégrations tierces, générée depuis le même contrat (question ouverte de #1981).
- **Exposer les commandes dès maintenant, derrière le mot de passe DT** : une seule
  fuite de mot de passe donnerait l'écriture sur toute l'épreuve, sans journal de qui a écrit.
  Cette ADR attend les comptes et le bail par épreuve de #1982.
- **Servir l'application React entière tout de suite** : 112 fichiers appellent encore
  `window.electronAPI`. Ces écrans tomberaient en erreur dans le navigateur.
- **Données complètes pour la vue DT, sans `publicDto`** : la licence et la date de naissance
  partiraient sur le réseau de la salle. Le réglage RGPD s'applique à tout le serveur distant.
