# ADR-0033 — Modèles de formule et formule d'une épreuve par le contrat, MCP compris

- **Statut** : Acceptée (arbitrage du 2026-11-25 : outils MCP des modèles en lecture seule)
- **Date** : 2026-11-25
- **Tickets** : #2013 (étape B2, décisions D6, D7, D8, D12 ; questions Q13, Q14, Q20, Q22), #1948 (lots 5 et 7) ; complète [ADR-0012](0012-formule-domaine.md), [ADR-0022](0022-fonctions-du-poste-contrat.md) et [ADR-0032](0032-formule-interface-unique-apercu.md)

## Contexte

- Les modèles de formule personnels vivent dans le stockage local du renderer
  (`keyValueStore`, clé `bellepoule-formula-templates`, `tournamentTemplates.ts`). Ils ne passent
  pas par le contrat : le MCP ne les voit pas, et un autre poste (#1982) non plus.
- Ils ne contiennent qu'une `CustomFormulaConfig`, donc ne servent qu'à l'arme « Autre ».
- `OFFICIAL_TEMPLATES` (5 modèles) n'est utilisé que par les tests.
- L'interface unique (ADR-0032) veut, à la création comme dans Organisation ▸ Formule :
  - un sélecteur avec recherche ;
  - une formule standard par arme × catégorie × type (D7) ;
  - des modèles fournis en lecture seule (D12), dont « Tournoi des rapières » (D8) ;
  - un badge Standard / Adaptée calculé à partir du modèle d'origine (§ 9 de #2013).
- Jusqu'à l'étape C de #2013, deux modèles de formule coexistent (ADR-0032).
- **Le MCP ne peut pas modifier la formule d'une épreuve.** `updateCompetitionSettings` existe
  dans le contrat mais n'a pas d'outil MCP. `create_competition` n'accepte que l'épée, le fleuret
  et le sabre, avec les réglages par défaut. Or l'ADR-0012 place la formule dans le domaine
  précisément pour que le MCP puisse l'éditer, et #1948 (lot 7) veut un agent qui propose et
  applique une formule.

## Décision

**Deux sources, une seule liste**

- **Modèles fournis** : fichiers versionnés dans `src/shared/domain/formula/presets/`, un par
  source et saison (`ffe-2026-2027.ts`…), validés par un test au chargement. Lecture seule.
  `OFFICIAL_TEMPLATES` y migre, valeurs revues (Q20). Le contenu du catalogue reste à #1948,
  lot 5.
- **Modèles personnels** : un réglage structuré du poste, `formulaTemplates`, dans
  `app_settings` (comme `matchDurations`). **Aucune migration de schéma.** Absent du patch de
  `updateStationSettings` : il a ses propres opérations.

**Forme d'un modèle** (`shared/domain/formula/formulaTemplate.ts`)

```ts
interface FormulaTemplate {
  id: string; // fourni : 'ffe-2026-2027/epee-seniors' ; personnel : identifiant injecté
  source: 'provided' | 'personal';
  name: string;
  applies?: { weapons?: Weapon[]; categories?: Category[]; team?: boolean };
  season?: string; // fourni : saison du règlement (Q13)
  reference?: string; // fourni : article ou lien du règlement (Q14)
  origin?: { templateId: string; season?: string }; // personnel issu d'un modèle fourni
  body:
    | { kind: 'draft'; draft: FormulaDraft } // épée, fleuret, sabre, Sabre Laser
    | { kind: 'custom'; formula: CustomFormulaConfig; specialMode?: CompetitionSpecialMode };
  savedAt?: string;
}
```

L'étape C remplace `body` par le modèle unique. La migration des modèles se fait dans la même
fonction que celle des épreuves.

**Opérations du contrat** (ADR-0008, droit `station:admin`, ADR-0022)

| Opération               | Nature   | Effet                                                                                                                                           |
| ----------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `listFormulaTemplates`  | requête  | Fournis puis personnels. Filtres facultatifs : arme, catégorie, type, texte. Le premier modèle compatible est marqué `standard`                 |
| `saveFormulaTemplate`   | commande | Crée ou remplace un modèle **personnel**. Un `id` de modèle fourni est refusé (`station_refused`) : on enregistre une copie, qui garde `origin` |
| `deleteFormulaTemplate` | commande | Supprime un modèle personnel. Modèle fourni : `station_refused` ; inconnu : `formula_template_not_found` (code ajouté, catégorie not_found)     |

- **Un seul outil MCP, en lecture** : `list_formula_templates`. Exception limitée à la règle
  « station:admin, pas d'outil MCP » de l'ADR-0022 : un modèle de formule n'est ni un secret ni
  un effet externe, et l'agent doit pouvoir choisir un modèle (#1948, lot 7). L'agent
  n'enregistre ni ne supprime de modèle : `saveFormulaTemplate` et `deleteFormulaTemplate`
  restent réservées à l'écran (arbitrage du 2026-11-25).
- **Pas de journal** : ce n'est pas un fait de l'épreuve (ADR-0005). Appliquer un modèle à une
  épreuve passe par `applyFormulaTemplate` (ci-dessous).
- Codes d'erreur (ADR-0009) : `station_refused` existant, et un code ajouté,
  `formula_template_not_found` (catégorie `not_found`).

**Origine sur l'épreuve et badge**

- L'épreuve garde l'origine de sa formule dans `CompetitionSettings.formulaOrigin`
  (`{ templateId, season? }`, absent = formule libre). C'est une **exception explicite** à « plus
  de nouveau réglage plat » de l'ADR-0012 : ce n'est pas un réglage de la formule mais sa
  provenance. Elle passe dans le modèle unique à l'étape C.
- Le badge **Standard / Adaptée / Libre** est calculé, jamais stocké : on compare la formule de
  l'épreuve au modèle d'origine (domaine, `formulaDeviations`).

**Reprise des modèles locaux**

- À la première ouverture du sélecteur, l'écran lit l'ancienne clé locale, enregistre chaque
  modèle par `saveFormulaTemplate` (`body.kind = 'custom'`), puis efface la clé (même principe
  que `LEGACY_LOCAL_STORAGE_KEYS`). En cas d'échec, la clé locale reste : rien n'est perdu.

**Tournoi des rapières (D8, temps 1)**

- Modèle fourni `bpm/tournoi-des-rapieres` : arme « Autre », `specialMode: 'rapieres'`, formule
  poules → tableau. Choisir ce modèle crée une épreuve identique à celle du mode spécial actuel.

**Formule d'une épreuve par le contrat et le MCP** (amendement du 2026-11-25)

| Opération                       | Nature   | Outil MCP                               | Effet                                                                                                                                                                                       |
| ------------------------------- | -------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getCompetitionFormula`         | requête  | `get_competition_formula` (lecture)     | Phases de la frise, réglages par phase, origine, état Standard / Adaptée / Libre et écarts, relevé de cohérence avec la catégorie, briques autorisées à chaque position                     |
| `applyFormulaTemplate`          | commande | `apply_formula_template` (écriture)     | Applique un modèle fourni ou personnel compatible ; enregistre `formulaOrigin`                                                                                                              |
| `updateCompetitionFormula`      | commande | `update_competition_formula` (écriture) | Liste d'opérations de frise appliquées dans l'ordre, tout ou rien : `insertPhase` (brique, position), `removePhase` (phase), `setPhase` (phase, réglages), `setGeneral` (réglages généraux) |
| `createCompetition` (existante) | commande | `create_competition` (étendu)           | Accepte aussi le Sabre Laser et l'arme « Autre », et un `templateId` facultatif                                                                                                             |

- **Mêmes règles que l'écran, un seul code** : les commandes appellent les opérations de la frise
  du domaine (`formulaFrieze.ts`, ADR-0032) et la validation `validateFormulaSettings`
  (ADR-0012). Une brique interdite à une position, ou une formule incohérente, est refusée par
  `invalid_settings` ; une épreuve déjà tirée, par `draw_done` (codes existants, ADR-0009).
  L'agent ne voit jamais d'option que le moteur n'exécute pas (P2).
- **Droit `competition:write`**, comme `updateCompetitionSettings` : même transaction de
  l'épreuve, avec `dryRun`, `expectedRevision` et `commandId` (ADR-0006, ADR-0008), et comme
  elle **sans événement du journal** (réglages, ADR-0018). Le journal des modifications en cours
  d'épreuve (§ 10 de #2013) viendra avec le verrou par phase. Aucune exception à l'ADR-0022 n'est nécessaire pour ces opérations ;
  les outils d'écriture restent soumis à l'autorisation d'écriture du MCP.
- **Verrou** : formule figée après le tirage (`draw_done`, comme `updateCompetitionSettings`
  aujourd'hui), puis verrou par phase commencée quand l'étape D de #2013 l'apportera (P8).
- **Le réglage `formulaPreview` ne s'applique pas** (ADR-0032) : l'agent voit et modifie toute la
  formule, quel que soit l'écran du poste.
- **Ce que l'agent peut régler suit les étapes de #2013** : à l'étape B2, ce que le moteur
  exécute aujourd'hui (1 à 5 tours, touches, qualifiés, tableau, 3ᵉ place, Tour Quest, barème de
  l'arme « Autre ») ; après les étapes C et D, réglages par tour, 0 tour, tableau intercalé ;
  après #1948, tirages, exemptés, consolante et `suggest_formula` (lot 7).
- L'écran passe par les mêmes commandes : Organisation ▸ Formule et la fenêtre de création
  cessent d'écrire la formule par `updateCompetitionSettings` (un fait, un chemin).

## Conséquences

- Le sélecteur et le badge sont derrière le réglage `formulaPreview` (ADR-0032) ; les opérations
  du contrat et les outils MCP sont livrés directement (D13).
- Les modèles personnels restent propres au poste jusqu'à #1982, qui dira s'ils se partagent.
- `docs/MCP.md` et `docs/API_CONTRACT.md` sont régénérés (`npm run docs:mcp`).
- `contractNaming.test.ts` couvre les nouveaux noms ; chaque outil MCP a un test de refus
  (brique interdite, épreuve tirée, révision périmée).
- `updateCompetitionSettings` garde les réglages qui ne sont pas de la formule (arme, catégorie,
  arbitrage…). Les champs de formule y restent acceptés jusqu'à l'étape C pour la
  compatibilité, puis passent par `updateCompetitionFormula` seulement.
- Un modèle personnel enregistré sous une formule d'un type (`draft`) ne s'applique pas à
  l'arme « Autre », ni l'inverse, jusqu'à l'étape C. Le sélecteur ne propose que les modèles
  compatibles.

## Alternatives écartées

- **Table dédiée `formula_templates`** : il faudrait une migration (ADR-0011) pour une donnée
  que `app_settings` porte déjà, comme les durées de match.
- **Fichier dans `userData`** : une seconde source de vérité pour le poste, hors de la base
  sauvegardée et chiffrée.
- **Garder le stockage local du renderer** : contraire à ADR-0005 et ADR-0012, invisible pour le
  MCP.
- **Modèles fournis modifiables sur place** : une mise à jour de saison écraserait les
  modifications ou figerait le catalogue, et le badge perdrait sa référence.
- **Stocker l'état Standard / Adaptée** : il dériverait de la formule réelle.
- **Exposer `updateCompetitionSettings` tel quel au MCP** : un patch de réglages plats, sans la
  grammaire de la frise ; l'agent pourrait écrire une suite de phases que l'écran refuse, et
  le contrat changerait de forme à l'étape C.
- **Une seule commande qui remplace toute la formule** : simple, mais l'agent devrait
  reconstruire la formule entière et les refus ne désigneraient pas la phase fautive. La liste
  d'opérations garde les deux usages : l'écran envoie toutes ses modifications en une fois,
  l'agent peut n'en envoyer qu'une.
- **Outils MCP d'écriture des modèles** : écartés à l'arbitrage du 2026-11-25 ; l'agent agit
  sur la formule des épreuves, pas sur la bibliothèque du poste.
