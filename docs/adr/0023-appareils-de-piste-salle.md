# ADR-0023 — Les appareils de piste se déclarent sur la salle ; l'épreuve peut seulement passer une piste en manuel

- **Statut** : Acceptée (2026-11-22)
- **Date** : 2026-11-22
- **Tickets** : #2117, #1981 (ADR-0022, groupe appareils), #1829, #1960, #1878, #2033, #2075 ; s'appuie sur
  l'[ADR-0019](0019-plan-arene-salle.md)

## Contexte

Un appareil de piste (Cyrano, OPP2) se déclare par son adresse IP, son port, son protocole et
son mode (maître ou esclave). Ce sont des faits **physiques** : l'appareil reste sur sa piste
d'une épreuve à l'autre et d'un jour à l'autre. Aujourd'hui, cette déclaration vit à trois
endroits, avec un ordre de repli :

| Endroit                      | Clé                                     | Écrit par                                              |
| ---------------------------- | --------------------------------------- | ------------------------------------------------------ |
| Table `cyrano_pistes`        | `competition_id` de l'épreuve           | `cyrano:savePistes` (#1829)                            |
| Même table                   | `day:<id>` de la journée multi-épreuves | `cyrano:savePistes` si l'épreuve a une journée (#1878) |
| `venue_strips.cyrano_config` | piste de la **salle par défaut**        | réglages des salles (#1880)                            |

À la lecture (`cyrano:loadPistes`), la table de la journée passe d'abord, puis celle de
l'épreuve, puis la salle par défaut. Les pistes OPP2 (`opp2:setPistes`) suivent ce même chemin
à travers l'écran.

Conséquences :

- un appareil se redéclare à chaque nouvelle épreuve ou journée ;
- trois copies peuvent diverger ;
- on ne sait pas laquelle fait foi.

Par ailleurs, une épreuve doit pouvoir **passer une piste en saisie manuelle**, par exemple
quand l'appareil est en panne ou réservé à une autre épreuve, sans toucher à la déclaration de
l'appareil.

## Décision

**La salle est le seul référentiel des appareils**

- La déclaration d'un appareil est un attribut de la **piste de la salle** : colonne
  `venue_strips.device_config`, qui remplace `cyrano_config`. On y met le protocole (`cyrano`
  ou `opp2`), l'adresse, le port, le mode, la version du protocole et l'identifiant OPP2.
- La salle est le lieu physique. Elle se réutilise d'une épreuve à l'autre et d'un jour à
  l'autre.

**Une épreuve trouve sa salle, sans rien redéclarer**

1. Par sa salle propre, `competitions.venue_id` : décision 2 de l'[ADR-0019](0019-plan-arene-salle.md),
   reprise ici.
2. Sinon, par la salle de sa journée multi-épreuves (`event_days.venue_id`, qui existe déjà).
3. Sinon, par la salle par défaut du poste.

**L'organisation ne porte pas d'appareils**

- Une organisation sur plusieurs jours se décrit par ses **journées**, chacune rattachée à une
  salle, souvent la même.
- On n'ajoute pas d'objet « organisation » qui porterait des appareils : il dupliquerait la
  salle.
- Si un regroupement de journées devient nécessaire (programme d'un week-end, par exemple), il
  référencera des journées et des salles, jamais des appareils.

**L'épreuve ne fait que désactiver une piste**

- Nouveau réglage de l'épreuve, `manualStrips: number[]` : pistes dont l'appareil est ignoré
  pour cette épreuve. Le pilote ne lui envoie plus de match et ne prend plus ses scores ; la
  tablette ou l'écran saisissent à la place.
- C'est un réglage, pas un fait du journal. Il passe par `updateCompetitionSettings`, et sa clé
  est vérifiée par le schéma strict des réglages.
- L'épreuve ne déclare jamais d'adresse ni de port.

**Contrat**

Les opérations entrent dans le contrat selon l'[ADR-0022](0022-fonctions-du-poste-contrat.md),
avec le droit `remote:admin`, jamais servies sur le réseau :

- `setStripDevice({ venueId, strip, device | null })` ;
- `listStripDevices({ venueId })` ;
- `getCompetitionStripDevices({ competitionId })` : appareils effectifs, salle résolue et pistes
  manuelles déduites ;
- démarrage, arrêt, état et journal des pilotes Cyrano et OPP2 ;
- `setCompetitionVenue({ competitionId, venueId | null })` (ADR-0019).

**Migration**

- Une seule migration, qui cite cette ADR et l'ADR-0019 :
  - ajout de `competitions.venue_id` ;
  - renommage de `cyrano_config` en `device_config` ;
  - reprise des lignes de `cyrano_pistes`, vers la salle de la journée si l'épreuve en a une,
    sinon vers la salle par défaut. Une piste de salle déjà déclarée n'est pas écrasée, et les
    conflits sont listés dans le journal de diagnostic.
- `cyrano_pistes` reste en lecture seule jusqu'à la 3.0, puis elle est supprimée par une
  migration ultérieure.

**Pilotage hors compétition** (#2117, partie 2)

- La configuration de la salle envoie un **affichage libre** aux appareils : arme, noms et
  nations (ou clubs), ou remise à blanc, sur plusieurs pistes en une fois
  (`sendStripDisplay`, `listVenueStripControl`, `onStripControlChanged`). C'est une commande du
  modèle commun des appareils (`panel`), pas un match : pas d'Id de tireur, pas de fait
  d'épreuve, **pas de journal**, état en mémoire seulement.
- **Piste occupée** : refusée si une épreuve en saisie distante dont la salle résolue est cette
  salle a l'arène de la piste dans sa séance ; une piste que cette épreuve a passée en manuel
  (`manualStrips`) reste pilotable.
- **Accusé de réception** : Cyrano n'acquitte pas un `DISP`. L'accusé est l'état suivant de
  l'appareil (un `HELLO` suit le `DISP` pour le provoquer) qui renvoie les noms et l'arme
  envoyés ; appareil en plein combat : refusé ; rien sous 8 s : sans réponse. OPP2 : écho
  `apparatus/fencers`.
- Les appareils de la salle pilotée sont chargés dans les pilotes **après** ceux des salles des
  épreuves suivies : une épreuve garde toujours la priorité sur une piste du pilote commune.
- Déclaration en masse (`setStripDevices`, `getStripDevicesFile`, `importStripDevices`) : le
  fichier circule par contenu, jamais par chemin ; import validé ligne par ligne, rien d'écrit
  sur erreur.

## Conséquences

- Un appareil se déclare une fois, dans les réglages de la salle. Toutes les épreuves et
  journées qui s'y tiennent le retrouvent.
- Le panneau Cyrano de la saisie distante n'édite plus les adresses. Il montre l'état des
  appareils de la salle et permet de **passer une piste en manuel** pour l'épreuve.
- Deux épreuves simultanées dans la même salle partagent les appareils. Le pilote route chaque
  piste vers l'épreuve dont la tablette l'occupe, comme aujourd'hui (`pisteHub`). Une piste
  passée en manuel par une épreuve reste disponible pour l'autre.
- Le planificateur de salle (#2075) et les appareils décrivent la même salle.
- La configuration de la salle peut piloter directement ses appareils hors compétition : arme,
  noms et nationalités, en masse (#2117). Ce sont des ordres d'affichage, pas des faits d'épreuve.
- La reprise automatique peut placer un appareil sur la mauvaise salle quand une installation a
  plusieurs salles sans journée. Le diagnostic le signale, et la correction se fait dans les
  réglages de la salle.

## Alternatives écartées

- **Garder la déclaration par épreuve, avec une copie depuis la salle à la création** : la
  copie diverge dès qu'un appareil change d'adresse en cours de journée.
- **Déclarer les appareils sur la journée multi-épreuves** : il faudrait les redéclarer chaque
  jour, alors que le matériel ne bouge pas.
- **Un objet « organisation » porteur des appareils** : il double la salle et ajoute un niveau
  sans fait nouveau.
- **Passer une piste en manuel pour toute la salle** : une panne passagère couperait aussi les
  autres épreuves. Le réglage se fait par épreuve, et la panne durable se règle en retirant
  l'appareil de la piste.
