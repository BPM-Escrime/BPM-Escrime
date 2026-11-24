# ADR-0030 — Les fonctions de l'application de bureau passent par `PlatformServices.desktop`

- **Statut** : Acceptée (2026-11-24, lots 3a–3c et 4 de #1981 livrés : #2257, #2258, #2259, #2261 ; amendement #2262)
- **Date** : 2026-11-24 ; questions tranchées par le mainteneur le 2026-11-24 (PR #2251)
- **Tickets** : #1981 (lot 4, suite), épique #1978 ; complète [ADR-0021](0021-services-plateforme.md)

## Contexte

L'[ADR-0021](0021-services-plateforme.md) range fichiers, impression et liens derrière
`PlatformServices`. Elle ajoute : « le menu natif, `safeStorage` et la mise à jour […] ne sont pas
appelés hors de `ElectronPlatform` ». Mais `PlatformServices` (`src/shared/platform/PlatformServices.ts`)
n'offre aucune méthode pour eux, seulement `capabilities.updater`. Les écrans appellent donc encore
`window.electronAPI`. L'ADR-0021 plaçait aussi l'interface dans `src/renderer/platform` ; le code
l'a mise dans `src/shared/platform`, à côté des implémentations, pour les exports PDF de
`src/shared/utils`.

Après les lots 1 et 2 de #1981, il restera dans l'interface ces appels propres à Electron,
légitimement hors du contrat (relevé sur `dev`, build #2094) :

| Fonction                        | Appels du préload                                                                                       | Appelants                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Mise à jour                     | `updater.*` (`check`, `get*`, `setAutoCheck`, `setChannel`, `chooseDownloadDir`…), `onUpdate*`          | `UpdateMenuButton`, `UpdateNotification`, `services/slashCommands`, `useSettingsHandlers`, `useSettingsPreferences` |
| Version, écran de démarrage     | `getVersionInfo`, `splash.getEnabled` / `setEnabled`                                                    | `AboutModal`, `ReportIssueModal`, réglages                                                                          |
| Menu natif, fichiers du système | `onMenu*`, `onShowAbout`, `onFileOpened`, `onFileSaved`, `privacy.onEncryptedBpmRequest`, `onAutosave*` | `useAppMenuHandlers`, `useMenuEvents`                                                                               |
| « Enregistrer sous »            | `setCurrentCompetition`                                                                                 | `App.tsx`                                                                                                           |
| Fenêtre, démarrage              | `setWindowSize`, `onDbReady`                                                                            | `usePoolsWindowSize`, `useAppGlobalEffects`                                                                         |
| Langue                          | `notifyLanguageChanged`, `initialLanguage`                                                              | `TranslationContext` (embarqué aussi dans la vue DT, [ADR-0020](0020-transport-websocket-contrat.md))               |
| Impression native               | `printDialog.*` (imprimantes, aperçu, impression, PDF, `setHandler`)                                    | `PrintDialog`, `PrintDialogHost`                                                                                    |
| Choix d'un dossier              | `backup.chooseDir`, `backup.pickCompetitionDir`, `settings.addAgentFolder`                              | `BackupDirSettingsSection`, `CompetitionPropertiesModal`, `McpSettingsSection`                                      |

Trois défauts en découlent :

- Ces fichiers ne se testent qu'en simulant l'objet global `window.electronAPI`.
- Chaque écran teste `window.electronAPI?.` à sa façon. Dans la vue DT ou le navigateur, un oubli
  fait planter la page.
- Deux choix de dossier **écrivent dans le main**, hors du contrat : `backup:chooseDir` enregistre
  le dossier de sauvegarde, `settings:addAgentFolder` ajoute un dossier à l'agent MCP. C'est un
  second chemin d'écriture pour un réglage que le contrat lit déjà (`getBackupDir`,
  `listAgentFolders`) et en partie écrit (`resetBackupDir`, `removeAgentFolder`)
  ([ADR-0005](0005-journal-un-fait-un-chemin.md), [ADR-0022](0022-fonctions-du-poste-contrat.md)).

Le cliquet `electronApiCalls` compte les fichiers de `src/renderer` (hors `src/renderer/api`) et de
`src/features` qui lisent `window.electronAPI` ; `electronApiUses` compte chaque occurrence. Le code
de `src/shared/platform` n'est pas compté.

## Décision

### Un groupe `desktop`, absent hors de l'application de bureau

- On ajoute à `PlatformServices` un membre **optionnel** `desktop?: DesktopServices`.
  - `ElectronPlatform` le fournit (`ElectronDesktop`).
  - `BrowserPlatform` le laisse `undefined` : navigateur de développement, vue DT.
- La présence de `desktop` est la capacité. Un écran écrit `platform.desktop?.…` ou masque son
  bouton quand `desktop` manque. TypeScript impose ce test : aucun écran ne peut l'oublier.
- `capabilities.updater` reste (ADR-0021). Il vaut `desktop !== undefined`.

### Où vit le code

- L'interface `DesktopServices` : `src/shared/platform/DesktopServices.ts`. L'implémentation
  `ElectronDesktop` : `src/shared/platform/platforms.ts` (ou un fichier voisin), à côté de
  `ElectronPlatform`. Elle lit le préload par une fonction d'accès, comme `ElectronPlatform` : rien
  n'est lu au chargement du module.
- Le contexte React reste `usePlatform()` (`src/renderer/platform/PlatformContext.tsx`). Pas de
  second contexte.
- Couches ([ADR-0002](0002-couches-et-dependances.md), [ADR-0004](0004-features-couche-interface.md)) :
  `src/shared/platform` sert l'interface. Il dépend de `shared/types` seulement. `src/main` et
  `src/shared/domain` ne l'importent jamais. Aucune règle métier n'y entre : uniquement la
  traduction entre le préload et l'interface.
- À terme, `window.electronAPI` n'apparaît plus qu'en deux endroits : `src/shared/platform`
  (fonctions du poste et de bureau) et `src/renderer/api` (transport du contrat, `IpcClient`).

### Forme de `DesktopServices`

```ts
type Unsubscribe = () => void;

/** Actions du menu natif et leur charge utile */
interface MenuEvents {
  newCompetition: void;
  save: void;
  competitionProperties: void;
  addFencer: void;
  addReferee: void;
  nextPhase: void;
  openSettings: void;
  reportIssue: void;
  about: void;
  export: { format: string };
  import: { format: string; name: string; content: string };
}

interface DesktopServices {
  // Version et démarrage
  getVersionInfo(): Promise<VersionInfo>;
  getSplashEnabled(): Promise<boolean>;
  setSplashEnabled(enabled: boolean): Promise<boolean>;
  /** Résolue quand la base est ouverte ; tout de suite si c'est déjà fait */
  whenReady(): Promise<void>;

  // Mise à jour (tout le groupe updater.* du préload, mêmes noms)
  updater: DesktopUpdater; // check, getAutoCheck, setAutoCheck, setChannel, …, chooseDownloadDir
  onUpdateAvailable(cb: (info: UpdateInfo) => void): Unsubscribe;
  onUpdateProgress(cb: (p: UpdateProgressEvent) => void): Unsubscribe;

  // Menu natif et fichiers ouverts par le système
  onMenu<K extends keyof MenuEvents>(kind: K, cb: (payload: MenuEvents[K]) => void): Unsubscribe;
  onCompetitionFileOpened(cb: (opened: { competitionIds: string[] }) => void): Unsubscribe;
  onEncryptedFileOpened(cb: (file: { name: string; content: string }) => void): Unsubscribe;
  onAutosave(cb: (result: { ok: boolean }) => void): Unsubscribe;
  /** Épreuve affichée : « Enregistrer sous » l'exporte seule */
  setCurrentCompetition(competitionId: string | null): void;

  // Fenêtre et langue
  setWindowSize(width: number, height: number, options?: { force?: boolean }): Promise<void>;
  readonly initialLanguage: string | null;
  notifyLanguageChanged(lang: string): void;

  // Impression native (boîte de dialogue de l'application)
  printDialog: DesktopPrintDialog; // getPrinters, render, execute, savePdf, systemDialog, setHandler

  /** Choix d'un dossier du poste ; chemin absolu, ou null si annulé */
  pickDirectory(request?: { title?: string }): Promise<string | null>;
}
```

- **Noms** : mêmes règles que le contrat ([ADR-0008](0008-nommage-contrat.md)) : abonnement `on…`,
  lecture `get…`, action verbe + objet. `DesktopServices` n'est **pas** une opération du contrat :
  pas de zod, pas d'outil MCP, pas de transport réseau.
- **Typage** : `MenuEvents` lie chaque action à sa charge utile. Un `onMenu('import', cb)` reçoit
  `{ format, name, content }` sans transtypage. Les types `VersionInfo`, `UpdateInfo`,
  `PrintDialogSettings` restent dans `src/shared/types/preload.ts`.
- **Contenu, pas chemin** (ADR-0021) : le menu Importer donne le nom du fichier et son contenu ;
  « fichier ouvert » donne les épreuves fusionnées. Le chemin ne sert aujourd'hui qu'aux traces de
  `logger.debug` ; il disparaît. `onFileSaved`, qui ne fait que tracer, disparaît aussi.
  `printDialog.savePdf` ne rend plus le chemin du PDF.
- **Abonnements** : chaque `on…` rend sa fonction de désabonnement. Elle retire **son** écouteur
  seulement (#1894) ; jamais `removeAllListeners`. Un `useEffect` la rend telle quelle.
- **Mise à jour** : ses préférences (vérification automatique, canal, dossier de téléchargement)
  restent **hors du contrat**, dans `desktop.updater`. Elles ne concernent que l'application
  installée sur ce poste : ni réseau, ni vue DT, ni outil MCP.
- **Démarrage** : `whenReady()` remplace `onDbReady` et son délai de secours d'une seconde. Le
  préload retient que `db:ready` est passé, pour qu'un appel tardif soit résolu tout de suite.
  Aucun nouveau canal.

### Choix d'un dossier : un chemin, écrit par une commande

- `pickDirectory` est la **seule** méthode qui rend un chemin. C'est une exception assumée à
  « contenu, jamais chemin » : un dossier n'est pas un contenu, c'est un lieu où le poste écrira
  plus tard (sauvegardes automatiques) ou que l'agent lira. Un navigateur n'a pas d'équivalent ; la
  fonction n'existe que sur le bureau.
- Le choix n'écrit rien. L'écran envoie ensuite le chemin à une commande du contrat :

| Réglage                             | Commande                                                   | Droit           |
| ----------------------------------- | ---------------------------------------------------------- | --------------- |
| Dossier de sauvegarde du poste      | `setBackupDir { path }` (pendant de `resetBackupDir`)      | `station:admin` |
| Dossier de l'agent                  | `addAgentFolder { path }` (pendant de `removeAgentFolder`) | `station:admin` |
| Dossier de sauvegarde d'une épreuve | `setCompetitionBackupDir { competitionId, path }`          | `station:admin` |

- Le handler vérifie le chemin : absolu, dossier existant. Sinon `dir_not_found` (code existant du
  catalogue, [ADR-0009](0009-codes-erreur.md)). Pour la sauvegarde, il vérifie aussi qu'on peut y
  écrire.
- `setBackupDir`, `setCompetitionBackupDir` et `addAgentFolder` sont des fonctions du poste
  (ADR-0022) : jamais servies sur le réseau ni à la vue DT, sans journal, **sans outil MCP**. Un
  agent ne peut pas élargir lui-même la liste des dossiers qu'il a le droit de lire.
- Côté main, un seul canal générique `dialog:pickDirectory` remplace `backup:chooseDir`,
  `backup:pickCompetitionDir` et `settings:addAgentFolder` : trois canaux en moins, un en plus.
- Exception : `updater.chooseDownloadDir` garde choix et écriture dans le main. La mise à jour
  reste entièrement hors du contrat ; aucun autre chemin n'écrit ce réglage.

### Dossier de sauvegarde d'une épreuve : un réglage du poste

- Un chemin n'a de sens que sur le poste qui l'a choisi. Avec le multi-poste (#1982,
  [ADR-0029](https://github.com/BPM-Escrime/BPM-Escrime/pull/2246)), un champ de l'épreuve serait
  lu ou écrit par un autre poste, où ce dossier n'existe pas. Le dossier dédié d'une épreuve devient
  donc un **réglage du poste, par épreuve**, et non plus un champ de l'épreuve.
- Il est rangé avec le dossier de sauvegarde du poste (`<userData>/backup-settings.json`, lu par
  `backupSettings.ts`), dans une table `épreuve → dossier`.
- Opérations du contrat ([ADR-0008](0008-nommage-contrat.md)), dans `contractStation.ts`, droit
  `station:admin`, jamais sur le réseau, sans outil MCP :
  - `setCompetitionBackupDir { competitionId, path }` : refus `competition_not_found` ou
    `dir_not_found` ;
  - `resetCompetitionBackupDir { competitionId }` : retour au dossier du poste ;
  - la lecture reste `getBackupDir`, enrichie du dossier propre à chaque épreuve (ou une requête
    `getCompetitionBackupDir { competitionId }`, au choix de la PR 3c).
- La sauvegarde automatique (`autosaveBackup.ts`) et « Enregistrer sous » (`menuActions.ts`,
  dossier proposé) lisent ce réglage du poste, et non plus `competition.settings.backupDir`.
- **Champ actuel `settings.backupDir`** (`competitionSchema.ts`, `Competition.settings`) :
  - **reprise** au premier démarrage de la version qui livre 3c : pour chaque épreuve qui en a un,
    le poste copie le chemin dans son réglage, s'il désigne un dossier existant ; sinon il l'ignore
    et le trace ;
  - le champ sort ensuite de `updateCompetitionSettings` : l'écran ne l'écrit plus, une valeur reçue
    est rejetée par le schéma ;
  - une archive `.bpm` venue d'un autre poste peut encore le porter : il est ignoré, jamais repris
    (chemin d'une autre machine) ;
  - le nettoyage de la clé dans le JSON `settings` des épreuves existantes est une écriture de
    données en masse : **à signaler** dans la PR 3c. Si elle passe par une migration, celle-ci cite
    cette ADR ([ADR-0011](0011-migrations-schema-3-0.md)). Rien n'est codé ici.

### Vue DT et navigateur

- `BrowserPlatform.desktop` est `undefined`. Les boutons de mise à jour, l'écran de démarrage, les
  choix de dossier et la boîte d'impression native sont masqués. `PrintDialogHost` ne rend rien ;
  « Imprimer » passe par `PlatformServices.print` (ADR-0021).
- `TranslationContext` lit la langue par `usePlatform().desktop`. Sans bureau : `localStorage`,
  puis la langue du navigateur, comme aujourd'hui. Les points d'entrée (application et vue DT)
  placent `PlatformProvider` **au-dessus** de `TranslationProvider`.
- La vue DT ne touche jamais `window.electronAPI` : c'est déjà sa règle (`src/renderer/dt/index.tsx`).

### Tests

- Une fausse plateforme de test, `fakePlatform({ desktop })` (`src/shared/platform/testing.ts`),
  sur le modèle de `fakeApiBridge`. Son `desktop` simulé enregistre les appels et sait émettre un
  événement (`emitMenu('save')`, `emitUpdateAvailable(info)`). Les écrans se testent sans objet
  global.
- `ElectronDesktop` a ses tests avec un préload simulé : chaque méthode appelle la bonne fonction ;
  le désabonnement retire le bon écouteur ; `whenReady` se résout avant comme après `db:ready`.
- Chaque écran migré a un test « sans bureau » : rendu avec `desktop` absent, bouton masqué, pas
  d'erreur.
- Les commandes de dossier ont leurs tests d'engine : chemin valide, dossier absent (`dir_not_found`),
  refus hors poste local (test de l'ADR-0022), absence d'outil MCP, nommage
  (`contractNaming.test.ts`). La reprise de `settings.backupDir` a son test (dossier existant
  repris, dossier absent ignoré).

### Découpage

| PR  | Contenu                                                                                                                                                                                                                                                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3a  | `DesktopServices`, `ElectronDesktop`, `fakePlatform`. Migration : version, écran de démarrage, mise à jour (`AboutModal`, `ReportIssueModal`, `UpdateMenuButton`, `UpdateNotification`, `slashCommands`, `useSettingsHandlers`, `useSettingsPreferences`).                                                                   |
| 3b  | Menu, fichiers ouverts, sauvegarde automatique, `whenReady`, `setCurrentCompetition`, `setWindowSize`, langue (`useAppMenuHandlers`, `useMenuEvents`, `App.tsx`, `useAppGlobalEffects`, `usePoolsWindowSize`, `TranslationContext`), impression native.                                                                      |
| 3c  | `pickDirectory`, canal `dialog:pickDirectory`, commandes `setBackupDir`, `setCompetitionBackupDir`, `resetCompetitionBackupDir` et `addAgentFolder`, reprise de `settings.backupDir`, retrait des trois anciens canaux (`BackupDirSettingsSection`, `CompetitionPropertiesModal`, `McpSettingsSection`), `npm run docs:mcp`. |

Chaque PR fait baisser `electronApiCalls` et `electronApiUses` d'autant ; 3c fait aussi baisser
`ipcChannels` de 2. Elles relèvent de l'épique #1978 : brouillon, sans auto-merge, revue du
mainteneur (ADR-0001).

### Critères d'acceptation

- Plus aucun `window.electronAPI` dans les fichiers du tableau « Contexte ».
- `PlatformServices.desktop` existe ; `BrowserPlatform.desktop` est `undefined` ;
  `capabilities.updater === (desktop !== undefined)`.
- Aucun chemin ne traverse `DesktopServices`, sauf le retour de `pickDirectory`.
- Aucun nouveau canal `ipcMain` hors `dialog:pickDirectory` ; plus d'écriture de réglage par
  `backup:chooseDir` ni `settings:addAgentFolder`.
- Plus aucune lecture de `competition.settings.backupDir` dans `src/main` ; le dossier d'une
  épreuve vient du réglage du poste.
- Application installée : même comportement (menus, mise à jour, version, écran de démarrage,
  taille des poules, impression, choix de dossier). Les E2E Electron passent.
- Navigateur de développement et vue DT : boutons de bureau absents, aucune erreur dans la
  console, langue reprise du navigateur.

## Conséquences

- Les écrans ne lisent plus d'objet global pour ces fonctions : ils se testent avec une fausse
  plateforme, et la vue DT ne peut plus planter sur un oubli de `?.`.
- Le réglage du dossier de sauvegarde et celui des dossiers de l'agent n'ont plus qu'un chemin
  d'écriture : le contrat.
- `src/shared/platform` grossit. C'est voulu : c'est le seul lieu qui connaît le préload, hors
  transport du contrat.
- **Cliquets, puis règle ESLint** : le cliquet `electronApiCalls` / `electronApiUses` reste le
  compteur tant qu'il n'est pas à 0. Le périmètre compté ne change pas d'ici là ; on n'élargit
  pas l'exemption. Quand il atteint 0, la même PR :
  - ajoute une règle ESLint **bloquante** (niveau `error`, donc vue par `lint:errors`) ;
  - retire les deux compteurs de `check-quality-ratchet.js` et de `quality-baseline.json` ;
  - met à jour la partie fixe de `scripts/generate-tests-doc.js`.
- **Forme de la règle** (`eslint.config.*`, bloc « Couches (#1979) ») :

```js
{
  files: ['src/renderer/**/*.{ts,tsx}', 'src/features/**/*.{ts,tsx}', 'src/shared/**/*.{ts,tsx}'],
  ignores: ['src/shared/platform/**', 'src/renderer/api/**', ...LAYER_TESTS],
  rules: {
    'no-restricted-syntax': ['error', {
      selector: "MemberExpression[property.name='electronAPI'], ObjectPattern > Property[key.name='electronAPI']",
      message: 'Pont Electron : usePlatform() (desktop) ou client du contrat (docs/adr/0030).',
    }],
  },
}
```

- Le sélecteur prend aussi `window?.electronAPI`, les transtypages (`(window as …).electronAPI`)
  et la déstructuration (`const { electronAPI } = window`), que `no-restricted-properties`
  (`object: 'window'`) laisserait passer. Ce bloc précède celui de `src/shared/domain` : en
  configuration à plat, le dernier bloc remplace les options d'une même règle, et le domaine
  interdit déjà `window` en entier.
- Avant d'activer la règle, `src/shared` doit être propre lui aussi : `bookPdf.ts` (impression),
  `cloudSyncService.ts` (`crypto.*`, voir ci-dessous). Les tests (`LAYER_TESTS`) gardent le droit
  de simuler le préload.
- Ce qui reste hors de cette ADR : logos et synthèse vocale (`getLogo`, `getLogos`, `saveLogos`,
  `getTtsConfig`), proxy, diagnostic, `greg`, `ftp`, et les lectures `db.*` restantes. Ils suivent
  les lots 1 et 2 (contrat, ADR-0022).
- **`safeStorage`** (`crypto.*`, utilisé par `cloudSyncService`) : décision à part,
  **#2252**. Il bloque la règle ESLint tant que `cloudSyncService` lit le préload.

## Alternatives écartées

- **Laisser `window.electronAPI?.` dans les écrans** — le cliquet ne descend jamais à 0, chaque
  test simule l'objet global, chaque écran gère l'absence à sa façon.
- **Faire passer ces fonctions par le contrat** — le contrat transporte des données par IPC,
  Socket.IO et MCP. Menu, fenêtre et mise à jour n'ont pas de sens sur le réseau ni pour un agent ;
  il faudrait les exclure une par une.
- **Un second contexte `useDesktop()`** — deux fournisseurs, deux fausses implémentations, deux
  ordres d'imbrication à respecter. Un membre de `PlatformServices` garde un seul point
  d'injection.
- **Des méthodes optionnelles à plat sur `PlatformServices`** — une vingtaine de `?.` à tester un
  par un. Le groupe `desktop` se teste une fois.
- **Implémentation dans `src/renderer/platform`, exemptée du cliquet** — il faudrait élargir une
  exemption du cliquet, et le code du préload serait coupé en deux dossiers.
- **`showDirectoryPicker` (File System Access API) dans le navigateur** — le dossier choisi reste
  dans la page ; le poste, qui écrit les sauvegardes, n'y a pas accès. Absent de Firefox et Safari.
- **Garder « choisir et enregistrer » dans le main** — c'est un second chemin d'écriture, hors du
  contrat, pour un réglage que le contrat écrit déjà en partie.
- **Un `onMenu(kind, cb)` à charge utile non typée** — chaque appelant transtyperait ; la table
  `MenuEvents` donne le bon type par action.

## Questions tranchées (2026-11-24)

Le mainteneur a tranché les quatre questions de la PR #2251 :

1. **Préférences de mise à jour** (vérification automatique, canal, dossier de téléchargement) :
   **hors du contrat**, dans `desktop.updater`. Poste local seulement, ni réseau ni MCP.
2. **Dossier de sauvegarde d'une épreuve** : **réglage du poste, par épreuve**, écrit par
   `setCompetitionBackupDir`, et non plus un champ de l'épreuve écrit par
   `updateCompetitionSettings` (§ « Dossier de sauvegarde d'une épreuve : un réglage du poste »).
3. **`safeStorage`** : **hors de cette ADR**, décision à part (#2252).
4. **Règle finale** : **règle ESLint bloquante** dans `lint:errors`, qui prend le relais du
   cliquet à 0 (§ « Conséquences »).

## Amendement (#2252)

Décision du mainteneur : au lieu d'une ADR dédiée à `safeStorage`, le code mort qui l'utilisait
depuis l'interface est retiré.

- **`safeStorage` n'est plus utilisé par l'interface.** Les canaux `crypto:isAvailable`,
  `crypto:protect`, `crypto:unprotect` et le groupe `crypto` du préload disparaissent (3 canaux :
  `ipcChannels` 44 → 41). `DesktopServices` n'a pas de service de chiffrement.
- **La synchronisation cloud est retirée.** `cloudSyncService` (Dropbox, Google Drive, OneDrive),
  jamais instancié, part avec `conflictResolution`, `ConflictResolutionModal` et les clés de
  locale `conflicts.*`. Si une synchronisation cloud revient, ses secrets restent dans le main
  (comme `clubSync.ts` du Mode Club) et passent par une ADR.
- **Inchangés** : la clé SQLCipher de la base (`dbKey.ts`, `safeStorage` côté main), les archives
  `.bpm` chiffrées (`bpmCrypto.ts`), le jeton MCP et le Mode Club.
- **Comptage de pages du dossier PDF** : `bookPdf.ts` lisait `window.electronAPI.file`. Il passe
  par `desktop.countHtmlPages(html)` (méthode optionnelle, `null` si indisponible ; le canal
  `file:countHtmlPages` reste). Sans bureau, le sommaire n'a pas de numéros de page.
- **Cliquet** : `electronApiCalls` / `electronApiUses` couvrent aussi `src/shared` (hors
  `src/shared/platform`, `src/shared/types` et les tests), casts et `globalThis` compris ;
  référence à 0. `src/shared` est propre : la règle ESLint bloquante (« Conséquences ») peut être
  activée.
