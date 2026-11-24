# ADR-0015 — Le plan des pistes (piste de départ, pistes indisponibles) est une donnée du moteur

- **Statut** : Acceptée (principe : 2026-11-20 ; stockage validé le 2026-11-24) ; amendée le
  2026-11-24 (migration 50, journalisation)
- **Date** : 2026-11-20
- **Tickets** : #2033, #1501, #1878, #1958, #1979, #1980

## Contexte

Le plan des pistes d'une épreuve a deux composantes, stockées à deux endroits côté écran :

| Donnée                               | Stockage actuel                                                                                                       | Lecteurs                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Piste de départ (`remoteStripStart`) | état de session de l'écran (`session_state`, `useCompetitionSession`)                                                 | écran, feuilles de poule (QR), serveur distant                            |
| Pistes indisponibles                 | `localStorage` **du poste**, clé `bellepoule-strips-unavailable-<épreuve>` (`renderer/hooks/useStripAvailability.ts`) | écran (cartes, boutons de piste, répartition du tableau), serveur distant |

Le serveur distant reçoit le plan **de l'écran** (`useStripPlanSync` → `remote:setStripPlan` →
`main/remote/stripPlan.ts`), et seulement quand la saisie distante est active.

Cela pose quatre problèmes :

- **Perte du marquage** : une piste marquée en panne sur un poste est inconnue d'un second poste,
  d'une restauration `.bpm` et d'un redémarrage dans un autre profil.
- **Ignorée par le moteur** : le MCP, l'affectation des pistes de la journée (#1878,
  `dayStripHandlers`) et le futur planning (#1958) ne la voient pas.
- **Règle de répartition dans l'écran** : `distributeArenasRoundRobin`
  (`useTableauViewState.tsx`) lit le store de l'écran.
- **Sens inversé** : le moteur apprend le plan par l'écran, alors que c'est lui qui devrait le
  fournir.

## Décision

- Le plan des pistes d'une épreuve, `{ start, unavailable[] }`, est une **donnée du moteur**,
  enregistrée en base. Écran, tablettes, MCP, affectation des pistes de la journée et planning
  le lisent par le contrat. Aucun ne le garde comme source.
- **Stockage** (validé le 2026-11-24) : migration **50** (d'abord numérotée 47 ; 47 à 49 ont
  été prises entre-temps par les ADR-0023, 0025 et 0028), autorisée par cette ADR
  ([ADR-0011](0011-migrations-schema-3-0.md)) :

  ```sql
  CREATE TABLE competition_strip_plans (
    competition_id TEXT PRIMARY KEY,
    start          INTEGER NOT NULL DEFAULT 1,
    unavailable    TEXT NOT NULL DEFAULT '[]',   -- JSON, entiers > 0, triés, sans doublon
    updated_at     TEXT NOT NULL
  );
  ```

  La table est purgée et archivée par le parcours générique de `competition_id` (RGPD, `.bpm`),
  comme `competition_events`.

- **Commandes** ([ADR-0008](0008-nommage-contrat.md)) :
  - `setStripStart({ competitionId, start })` ;
  - `setStripAvailability({ competitionId | eventDayId, strip, available, dryRun })`.
    - Avec `eventDayId`, la piste est marquée pour **toutes** les épreuves de la journée, dans
      une transaction : une piste en panne l'est pour la salle.
  - Une requête `getStripPlan({ competitionId })` et le signal `changed` de portée `strips`
    ([ADR-0010](0010-bus-evenements.md)).
- **Validation unique** : `normalizeStripPlan` (aujourd'hui dans `main/remote/stripPlan.ts`) part
  dans `shared/domain/planning/` avec `nextFreeStrip` et la répartition des pistes du tableau
  (`distributeArenasRoundRobin`).
- **Diffusion** : le moteur pousse le plan au serveur distant à chaque changement. `remote:setStripPlan`
  et `useStripPlanSync` disparaissent.
- **Reprise de l'existant** : au premier chargement d'une épreuve dont le plan est absent en
  base, l'écran envoie le contenu de son `localStorage` par `setStripAvailability`, puis efface la
  clé.
  - La piste de départ est reprise de `session_state` par la migration 50.
  - Ce code de reprise est retiré après la 3.0.

## Conséquences

- #1958 (planning) lit les pistes disponibles par le moteur dès le départ. **Ce changement est un
  prérequis de #1958.**
- L'affectation des pistes de la journée (#1878) exclut les pistes indisponibles de chaque
  épreuve.
- `useStripAvailability` devient un simple lecteur du contrat. Le cliquet `electronApiCalls`
  baisse d'autant.
- Le marquage est journalisé (amendement du 2026-11-24, § « Journal ») : #1980 est livré et
  l'[ADR-0007](0007-format-evenement.md) appliquée.

## Amendement du 2026-11-24 (#2033)

Décisions de l'utilisateur à la mise en œuvre de #2033.

### Stockage validé, migration 50

- La table `competition_strip_plans` ci-dessus est retenue telle quelle, **par épreuve**.
  Migration **50**, la prochaine libre : 47 (ADR-0023), 48 (ADR-0025) et 49 (ADR-0028) sont
  prises.
- Reprise de la piste de départ : `session_state.state_json.remoteStripStart` (entier ≥ 1) de
  chaque épreuve devient une ligne `{ start, unavailable: '[]' }`. Les épreuves sans valeur
  n'ont pas de ligne : leur plan se lit `{ start: 1, unavailable: [] }`.
- La piste de départ quitte `getCompetitionState` (`remoteStripStart`) : une seule source,
  `getStripPlan`.
- Purge RGPD, suppression d'une épreuve et archive `.bpm` : parcours générique de
  `competition_id` (`privacyRepo`, `competitionArchive`), comme `competition_events`.
- Reprise de l'écran, une fois par poste : la clé `bellepoule-strips-unavailable-<épreuve>`
  présente, ses pistes pas encore indisponibles en base passent par `setStripAvailability`,
  puis la clé est effacée. La piste de départ du poste (`bellepoule-ui-<épreuve>`,
  `remoteStripStart`, écrite par la 3.0 en développement) passe par `setStripStart` si la base
  est encore à 1, puis est retirée. Une piste remise en service sur un autre poste avant la
  reprise peut donc revenir indisponible : on l'accepte, la reprise ne sert qu'au passage à la
  3.0.

### Journal

Les deux commandes écrivent un événement par épreuve touchée, dans la transaction de la
commande ([ADR-0006](0006-expected-revision.md)). Format de l'[ADR-0007](0007-format-evenement.md) :
passé, PascalCase, numéros seulement, `schemaVersion` 1.

| Commande               | Événement                                       |
| ---------------------- | ----------------------------------------------- |
| `setStripStart`        | `StripStartChanged { start }`                   |
| `setStripAvailability` | `StripAvailabilityChanged { strip, available }` |

- Rien ne change (piste déjà dans l'état demandé, même piste de départ) : aucun événement.
- Avec `eventDayId`, chaque épreuve de la journée reçoit son événement, sous le même
  `commandId`. Une épreuve déjà dans l'état demandé n'en reçoit pas.
- Journée et transaction (revue de la PR #2234) : la commande ne contourne pas `runCommand`.
  Le moteur (`runCommandAcross`) ouvre **une** transaction englobante et y lance une
  `runCommand` par épreuve : l'échec d'une épreuve annule toutes les autres, rien n'est écrit.
  `journal:appended` part ensuite pour chaque journal qui avance, comme pour toute commande.
- `commandId` accepté en entrée, tiré s'il manque, commun à toutes les épreuves. Rejouer un
  `commandId` déjà présent au journal d'une des épreuves : `command_already_applied`, rien
  n'est réécrit.
- `expectedRevision` est une révision par épreuve : avec `eventDayId`, refusé par le contrat
  (`invalid_input`). `dryRun` n'ouvre aucune transaction et n'écrit rien.
- Rejeu : `projectCompetition` range la dernière piste de départ et l'état de chaque piste
  nommée par le journal (`facts.strips`). Ces événements ne sont pas des faits de structure :
  ils ne rendent pas un journal « incomplet » quand ils précèdent le tirage (comme l'appel).
  `compareWithState` compare ces faits au plan en base (écart `strip_plan`). Un plan repris par
  la migration, sans événement, n'est pas comparé.

### Articulation avec l'ADR-0023

- L'[ADR-0023](0023-appareils-de-piste-salle.md) range les **appareils** sur les pistes de la
  **salle** : un fait physique, durable, partagé par toutes les épreuves qui y ont lieu.
- La **disponibilité** d'une piste reste une donnée **de l'épreuve** : elle change pendant la
  journée et une épreuve seule doit pouvoir l'avoir. Une panne de salle se dit par `eventDayId` :
  la commande la recopie dans toutes les épreuves de la journée, dans une transaction.
- Une piste passée en manuel par l'épreuve (ADR-0023) reste disponible : l'appareil est
  remplacé par la tablette, la piste sert toujours.

### Diffusion

Le signal `changed` de portée `strips` (`strips:changed` sur le bus) déclenche, côté main,
l'envoi du plan relu en base au serveur distant de l'épreuve, s'il tourne. Au démarrage d'un
serveur distant, le plan de l'épreuve lui est envoyé. L'opération `setStripPlan` du groupe
`remoteOperations` (ex-`remote:setStripPlan`, ADR-0022) et `useStripPlanSync` sont retirés.

## Alternatives écartées

- **Ranger le plan dans `competitions.settings`** : on éviterait une migration, mais on
  mêlerait un état de salle, qui change pendant la journée, aux réglages de l'épreuve, fixés
  avant. Et la piste de départ reste dans `session_state`.
- **Ajouter une règle « indisponible » à `event_day_strip_rules`** : cela ne couvre que les
  épreuves rattachées à une journée. Une épreuve seule n'aurait pas de plan.
- **Laisser `localStorage` et synchroniser le serveur** : le moteur resterait dépendant d'un
  écran ouvert. C'est la situation actuelle.
