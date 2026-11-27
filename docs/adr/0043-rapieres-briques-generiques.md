# ADR-0043 — Tournoi des rapières en briques génériques de la formule, fin du mode spécial

- **Statut** : Acceptée (validée par le mainteneur le 2026-11-26) ; amendée le 2026-11-27 (poules de 2 à 15 en vagues classiques ; ordre d'entrée des têtes de poule ; niveaux de la liste des rapières, du plus faible au plus fort ; exports des membres ; validé par le mainteneur)
- **Date** : 2026-11-26
- **Tickets** : #2013 (étape F, lot F4, décision D8), #1948, #1441, #1118 ; précise [ADR-0036](0036-formule-v2-arbre-par-phase.md) (phases), [ADR-0040](0040-ex-aequo-a-la-barre.md) (qualification), [ADR-0039](0039-scission-competitions-filles.md) (catégorie du tireur), s'appuie sur [ADR-0007](0007-format-evenement.md), [ADR-0008](0008-nommage-contrat.md), [ADR-0011](0011-migrations-schema-3-0.md), [ADR-0017](0017-projections-etat-epreuve.md)

## Contexte

- Le Tournoi des rapières est un **mode spécial** (`settings.specialMode = 'rapieres'`, arme
  « Autre ») : `getActiveFormula` ignore la formule, `resolveCompetitionSettings` force un tour
  et un tableau, et une vingtaine de fichiers testent `isRapieres` (moteur, domaine, écran).
- Ses briques sont stockées à part : clé de session `rapieres` (`RapieresSession` v2,
  `RapieresLegacyState` v1) avec les binômes (`teams[fencerId]` : niveau, deux membres,
  catégorie, club), la vague lancée et l'arrêt des vagues, le mode de tableau ; commandes
  `launchRapieresWave`, `endRapieresWaves`, `setRapieresTeams` ; événements
  `RapieresWaveLaunched`, `RapieresWavesEnded`, `RapieresTeamsUpdated`,
  `TableauGenerated.rapieresTableauMode`.
- Une partie est déjà générique : l'entrée est un `Fencer` (nom d'équipe), le tirage accepte
  `levelRankOf` (critère « par niveau »), les tablettes filtrent la vague active
  (`setActiveWave`, `isInActiveWave`).
- D8 (#2013) : briques génériques à l'étape F, puis suppression du mode spécial. Arbitrage du
  2026-11-26 : cinq lots, retrait en dernier ; membres sur le tireur ; lecture de
  compatibilité ; mode de tableau dans la formule ; niveau = rang et libellés ; catégorie
  d'équipe = moyenne des années de naissance ; aide intégrée (F5).

## Décision

**F4a — Tour en vagues**

- `PoolRoundPhase.boutOrder` : `'fie' | 'free' | 'waves' | 'waves_classic'`. `'waves'` :
  tournoi toutes rondes par vagues (`scheduleWaves`) ; `'waves_classic'` : tables fixes des
  poules de 10 à 15 (`rapieresClassicOrder`), sinon `'waves'`. Fonctions déplacées dans
  `shared/domain/pools/waves.ts`, sans « rapières » dans leurs noms.
- Un tour en vagues admet des poules de 2 à 10 tireurs, de 2 à 15 en vagues classiques (tables
  fixes jusqu'à 15) ; la borne basse 2 ne vaut que pour ces ordres. _(Amendé le 2026-11-27 :
  remplace « Un tour en vagues admet des poules de 2 à 10 tireurs (borne basse 2 pour ce seul
  ordre). » ; les tables de 11 à 15 étaient inatteignables.)_
- État de session générique `waves: { launched: number; ended: boolean }` du tour courant.
- Commandes (ADR-0008) : `launchPoolWave`, `endPoolWaves` (outils `launch_pool_wave`,
  `end_pool_waves`) ; événements (ADR-0007) : `PoolWaveLaunched { wave, matchIds }`,
  `PoolWavesEnded { ended }`. Les anciens noms restent lus au rejeu (projection, comparaison,
  reconstruction) ; les anciennes commandes et outils restent comme alias jusqu'à F4e, puis
  sont retirés.
- Les tablettes suivent la vague active du tour en vagues (canal `setActiveWave` inchangé) ; le
  tour est terminé quand toutes les vagues sont jouées ou arrêtées, comme aujourd'hui.

**F4b — Qualification « têtes de poule, puis suivants »**

- `AdvancementRule.mode` gagne `'pool_heads'` (avec `count`) : les premiers de chaque poule,
  puis les deuxièmes, etc., jusqu'à `count`. Ordre d'entrée au tableau : quand au moins deux
  rangs de poule sont pris en entier, rang par rang, chacun dans l'ordre des poules (croisement
  garanti) ; sinon, tous les qualifiés dans l'ordre du classement général. Avec `count` = 4 :
  une poule → les 4 premiers ; deux poules → A1, B1, A2, B2 (croisement au tableau A1-B2,
  B1-A2) ; trois poules → les trois premiers et le meilleur deuxième ; quatre poules → les
  premiers. Plus de poules que `count` : remarque bloquante (S4, ADR-0041). La coupe à la barre
  (ADR-0040) s'applique au dernier rang de poule pris. _(Amendé le 2026-11-27 : remplace « les
  premiers de chaque poule, puis les deuxièmes, etc., chaque rang de poule pris dans l'ordre du
  classement général, jusqu'à `count`. » ; ordre d'entrée des demi-finales des rapières
  conservé.)_
- Mode de tableau des rapières = réglages de la formule, modifiables tant que le tableau
  n'est pas tiré : « normal » = tous qualifiés ; « 3ᵉ place » = `thirdPlace` ; « toutes les
  places » = `allPlaces` ; « demi-finales » = `pool_heads` 4 + `thirdPlace`. Plus de fenêtre
  au passage au tableau.

**F4c — Entrée en équipes (binômes)**

- Réglage général de la formule `entry: { kind: 'individual' } | { kind: 'team'; size: 2;
levels: string[] }` (défaut individuel). `levels` est rangé du plus faible au plus fort ; par
  défaut, la liste du mode rapières : `beginner`, `intermediate`, `expert` (Débutant,
  Intermédiaire, Expert, libellés traduits) ; un libellé saisi par l'organisateur s'affiche tel
  quel. _(Amendé le 2026-11-27 : remplace « (défaut individuel ; libellés par défaut Débutant,
  Intermédiaire, Expert). »)_
- **Migration 54**, additive, sans valeur par défaut, avec son test depuis une base en version
  53 (ADR-0011) : `fencers.members` (`TEXT NULL`, JSON `[{ lastName, firstName, gender?,
birthDate? }]`), `fencers.level` (`INTEGER NULL`, indice dans `levels` à partir de 1 : le plus
  grand est le plus fort _(amendé le 2026-11-27 : remplace « 1 = le plus fort, indice dans
  `levels` »)_),
  `fencers.handicap` (`INTEGER NULL`, 0 ou 1 : marqueur « HANDI » distinct de la catégorie).
  Les membres suivent le tireur : export de la personne et archives (`.bpf`, `.bpm`), RGPD
  (export et effacement de la personne), suppression ; les exports de liste aux formats
  fédéraux (XML FIE, FFE) et CSV n'ont pas de membres. _(Amendé le 2026-11-27 : remplace « Les
  membres suivent le tireur : export, RGPD (export et effacement de la personne),
  suppression. »)_
- Commandes d'inscription et de modification du tireur : champs `members`, `level`,
  `handicap` optionnels (ADR-0018). `setRapieresTeams` devient un alias jusqu'à F4e.
- Catégorie d'une équipe = moyenne des années de naissance des membres, arrondie au-dessus,
  saison au 1ᵉʳ septembre (règle actuelle, domaine pur, date injectée), écrite dans
  `fencers.category` (ADR-0039) et modifiable à la main. Sexe de l'équipe : celui des membres
  s'il est commun, sinon mixte.
- Tour de poules ▸ réglage `distribution: 'serpentine' | 'byLevel'` (défaut serpentin) :
  `'byLevel'` passe `levelRankOf` au tirage (`drawPools`, existant). `distributeByLevel` (sans
  appelant) est supprimé.
- Import : le format actuel (CSV / XLSX à colonnes fixes) écrit `members` et `level`.

**F4d — Classements dérivés filtrés**

- Réglage général `rankingFilters: Array<'category' | 'gender' | 'level' | 'handicap'>` :
  l'écran, les PDF et l'export du classement final proposent ces filtres ; un classement
  filtré renumérote depuis 1, égalités gardées (`filterRanking`, déplacé dans le domaine
  générique). C'est un affichage : pas de compétition fille (contrairement à ADR-0039), pas
  de publication GREG / FTP distincte.
- Le classement final « tableau, puis non-qualifiés dans l'ordre des poules, exclus en
  dernier » (`mergeFinalRanking`) est celui des formules à un tour suivies d'un tableau qualifié
  par `pool_heads` ; il est vérifié identique au classement générique avant le retrait.

**F4e — Fin du mode spécial**

- Le modèle fourni « Tournoi des rapières » devient une formule v2 en briques : arme
  « Autre », règles modernes, un tour en vagues (poules de 2 à 10, `distribution: 'byLevel'`),
  entrée en binômes, tableau, filtres du classement (catégorie, sexe, niveau, HANDI), départage
  par la victoire (réglage général existant `tieBreakByVictory`). `specialMode` n'est plus
  écrit.
- **Lecture de compatibilité, sans réécriture en base** : `formulaOf` lit une épreuve
  `specialMode: 'rapieres'` comme la formule ci-dessus (mode de tableau lu dans
  `rapieres.tableauMode`) ; la clé de session `rapieres` est lue comme alias (`waves`, membres,
  niveau, catégorie) tant qu'elle existe ; les événements `Rapieres*` restent lisibles au
  rejeu. Une épreuve rapières existante se rejoue et s'affiche à l'identique.
- Les tests `isRapieres` / `specialMode` du moteur, du domaine et de l'écran sont remplacés par
  la lecture des briques ; `assertSupported` ne refuse plus que les épreuves par équipes
  (ADR-0042 amendée en conséquence au lot F4e) ; le MCP pilote les vagues.

## Conséquences

- Cinq lots, chacun en PR empilée en draft, sans auto-merge (ticket `refactor`) : F4a, F4b,
  F4c (migration 54), F4d, F4e. Le mode spécial fonctionne jusqu'à F4e, en s'appuyant sur les
  briques au fur et à mesure.
- Tests : chaque brique (domaine, moteur, écran) ; F4e ajoute un test de non-régression qui
  rejoue une épreuve rapières enregistrée (v1 et v2) et compare l'affichage et le classement.
- Événements et commandes renommés : référence MCP régénérée (`npm run docs:mcp`), documentation
  des sockets si les tablettes changent (`npm run docs:socket`).
- Les épreuves par équipes (ADR-0024, relais) ne sont pas concernées : l'entrée en binômes est
  une entrée individuelle portée par deux personnes.

## Alternatives écartées

- **Membres dans une clé de session générique** : pas de migration, mais les membres restent
  hors du tireur (export, RGPD, suppression à traiter à part).
- **Migration de données des épreuves existantes** : une migration fusionnée ne se modifie
  plus (ADR-0011), et la `customFormula` stockée ne reflète pas ce qui a été joué.
- **Garder la fenêtre de mode de tableau** : contraire à Q11 (la formule décide, modifiable
  tant que le tableau n'est pas tiré).
- **Trois niveaux fixes** : propre aux rapières ; un rang et des libellés servent aussi aux
  autres usages (petites salles, loisirs).
- **Catégorie d'équipe = le plus jeune des membres** : change le résultat des rapières
  existantes.
