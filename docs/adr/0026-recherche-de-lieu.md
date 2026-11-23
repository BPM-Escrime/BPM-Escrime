# ADR-0026 — La recherche de lieu passe par le poste, sur deux services gratuits sans clé

- **Statut** : Proposée
- **Date** : 2026-11-23
- **Tickets** : —

## Contexte

Le champ « Lieu » se tape à la main : création d'une compétition (`NewCompetitionModal`) et
feuille de route (`RoadmapInfoForm`, variables `{lieu}` et `{adresse}`). L'organisateur veut
chercher le gymnase par son nom et récupérer son adresse.

Contraintes :

- la CSP de l'écran n'autorise que `self`, `localhost`, `api.github.com` et `api.ffe.fr`
  (`src/main/windowSecurity.ts`) ; le webhook passe déjà par le processus principal pour cette
  raison (`src/main/webhook.ts`) ;
- aucun nouveau canal `ipcMain.handle` (ADR-0022) ;
- pas d'abonnement payant ni de clé à distribuer avec un logiciel libre ;
- RGPD (docs/RGPD.md) : rien de personnel ne doit sortir du poste.

Services gratuits, sans clé, vérifiés le 2026-11-23 :

| Service                                       | Couverture | Lieux nommés | Autocomplétion                |
| --------------------------------------------- | ---------- | ------------ | ----------------------------- |
| Photon (komoot, OpenStreetMap)                | Monde      | Oui          | Oui                           |
| Géoplateforme IGN (`data.geopf.fr/geocodage`) | France     | Oui (`poi`)  | Oui                           |
| Nominatim (OpenStreetMap)                     | Monde      | Oui          | **Interdite** (1 req./s max.) |
| `api-adresse.data.gouv.fr`                    | France     | Non          | Fermée, remplacée par l'IGN   |

## Décision

- On ajoute la requête du contrat `listPlaceSuggestions({ query, language })` au groupe du poste
  (`contractStation.ts`, droit `station:admin`) : jamais sur le réseau, pas de journal, pas
  d'outil MCP, comme ADR-0022.
- On fait l'appel sortant dans le processus principal (`src/main/placeSearch.ts`), branché par le
  port `ctx.station.places` (`stationPort.ts`). La CSP de l'écran ne change pas.
- On interroge Photon d'abord, puis la Géoplateforme si Photon échoue ou ne trouve rien.
  Délai de 5 s par service, 6 résultats au plus, réponses gardées en mémoire pour la session.
- On garde les règles pures (requête admise, URL, lecture du GeoJSON, doublons, libellé) dans
  `src/shared/domain/places/placeSearch.ts` (ADR-0002).
- On ne cherche qu'à la frappe : 3 caractères au moins, après 400 ms de pause. Seul le texte
  tapé part ; aucun nom de personne, aucune donnée de l'épreuve.
- Sans poste (navigateur), sans réseau ou sans réponse, le champ reste un champ libre ; la liste
  dit « recherche indisponible ». Aucun refus remonté à l'opérateur.
- On cite les sources sous la liste (« Données © OpenStreetMap, IGN »), comme le demandent leurs
  licences (ODbL, Licence ouverte).

## Conséquences

- Le poste contacte `photon.komoot.io` et `data.geopf.fr` quand l'opérateur tape un lieu. À
  mentionner dans docs/RGPD.md et à autoriser par un pare-feu restrictif.
- Photon public n'a pas de garantie de service : la Géoplateforme le remplace en France ; à
  l'étranger, plus de suggestion s'il tombe.
- Pas de réglage pour couper la recherche : à ajouter si un organisateur le demande.

## Alternatives écartées

- Appel depuis l'écran en élargissant la CSP — ouvre l'écran à deux hôtes externes ; le poste
  fait déjà les appels sortants (webhook).
- Nominatim — l'autocomplétion est interdite par sa politique d'usage.
- Google Places, Mapbox — clé et facturation.
- Salles déclarées (`listVenues`) seulement — ne connaissent ni l'adresse ni les lieux jamais
  déclarés ; restent un complément possible.
