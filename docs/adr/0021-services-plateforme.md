# ADR-0021 — Les fonctions propres à Electron passent par `PlatformServices`

- **Statut** : Proposée
- **Date** : 2026-11-22
- **Tickets** : #1981 (lot 4), épique #1978

## Contexte

Le contrat (ADR-0008, ADR-0020) couvre les données de l'épreuve. Une partie des appels
`window.electronAPI` de l'écran ne touche pas aux données : ils servent les fonctions du poste.
Relevé sur `dev` (build #2024) :

| Fonction               |                                                     Appels | Forme actuelle                                                            |
| ---------------------- | ---------------------------------------------------------: | ------------------------------------------------------------------------- |
| Enregistrer un fichier |               16 `dialog.saveFile` + 8 `file.writeContent` | Le dialogue rend un **chemin**, puis l'écran écrit le contenu à ce chemin |
| Ouvrir un fichier      |                                        9 `dialog.openFile` | Chemin et contenu texte                                                   |
| Imprimer, PDF          | 4 `file.printHtml`, 4 `file.printHtmlToPDF`, `printDialog` | HTML rendu par une fenêtre cachée du main                                 |
| Lien externe           |                                           2 `openExternal` | Navigateur du système                                                     |
| Mise à jour            |                                              6 `updater.*` | Propre à l'application installée                                          |

Ces 27 fichiers ne peuvent pas tourner dans un navigateur, et la forme « chemin puis écriture »
n'y a pas d'équivalent : une page ne connaît jamais le chemin d'un fichier.

## Décision

- On définit une interface `PlatformServices` (`src/renderer/platform/PlatformServices.ts`),
  fournie par un contexte React (`usePlatform()`), sur le modèle de `BpmClient`. Hors React, un
  `defaultPlatform` comme `defaultBpmClient`.
- Elle raisonne en **contenu**, jamais en chemin :

```ts
interface PlatformServices {
  readonly capabilities: { printToPdf: boolean; updater: boolean; nativeDialogs: boolean };
  /** Propose d'enregistrer ; false si l'utilisateur annule */
  saveFile(file: {
    suggestedName: string;
    filters: FileFilter[];
    content: string | Uint8Array;
  }): Promise<boolean>;
  /** Choix d'un fichier ; null si annulé */
  openFile(opts: {
    filters: FileFilter[];
    binary?: boolean;
  }): Promise<{ name: string; content: string | Uint8Array } | null>;
  print(html: string): Promise<void>;
  /** PDF enregistré via saveFile ; absent si capabilities.printToPdf est faux */
  exportPdf?(html: string, suggestedName: string): Promise<boolean>;
  openExternal(url: string): void;
}
```

- **Deux implémentations** :
  - `ElectronPlatform` : s'appuie sur le préload existant (`dialog.*`, `file.*`, `openExternal`).
    Le comportement de l'application installée ne change pas.
  - `BrowserPlatform` : téléchargement par un lien `Blob`, `<input type="file">`, impression par
    une `iframe` et `window.print()`, `window.open` pour les liens. Pas de PDF ni de mise à jour :
    l'écran masque le bouton quand la capacité manque.
- `saveFile` remplace le couple `dialog.saveFile` + `file.writeContent`. Le préload garde ses
  canaux : seul l'appelant change, il n'y a pas de nouveau canal `ipcMain.handle`.
- Les opérations qui touchent les données (export `.bpm`, photos, archives de tireurs) ne vont
  pas dans `PlatformServices` : elles deviendront des requêtes du contrat qui rendent un contenu,
  enregistré ensuite par `saveFile`.
- Le menu natif, `safeStorage` et la mise à jour restent propres à Electron. Ils ne sont pas
  appelés hors de `ElectronPlatform` et des écrans qui les testent par `capabilities`.

## Conséquences

- Le cliquet `electronApiCalls` baisse d'environ 27 fichiers, au fil des PR par fonction :
  enregistrer, ouvrir, imprimer, liens.
- Tests : chaque implémentation a ses tests (préload simulé, DOM de jsdom). Les écrans se testent
  avec un faux `PlatformServices`, comme avec `fakeApiBridge`.
- La vue DT (ADR-0020) peut proposer « Imprimer » et « Exporter » sans code propre.
- Reste à faire : les exports de données par le contrat (requêtes qui rendent un contenu), dans
  la suite du lot 2.

## Alternatives écartées

- **Garder chemin puis écriture, simulé dans le navigateur** : il faudrait inventer des chemins,
  et l'écriture partielle d'un fichier n'existe pas dans une page.
- **File System Access API (`showSaveFilePicker`)** : absente de Firefox et Safari ; le lien
  `Blob` marche partout et suffit pour des exports ponctuels.
- **Passer l'impression par le serveur (PDF généré côté main)** : il faudrait un service en plus
  sur le serveur distant ; l'impression du navigateur suffit pour une page de consultation.
