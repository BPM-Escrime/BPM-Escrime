# ADR-0033 — Modèles de formule : catalogue fourni en lecture seule, modèles personnels du poste par le contrat

- **Statut** : Proposée
- **Date** : 2026-11-25
- **Tickets** : #2013 (étape B2, décisions D6, D7, D8, D12 ; questions Q13, Q14, Q20, Q22), #1948 (lot 5) ; complète [ADR-0012](0012-formule-domaine.md), [ADR-0022](0022-fonctions-du-poste-contrat.md) et [ADR-0032](0032-formule-interface-unique-apercu.md)

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
| `deleteFormulaTemplate` | commande | Supprime un modèle personnel. Modèle fourni : `station_refused` ; inconnu : `not_found`                                                         |

- **Outils MCP** `list_formula_templates` (lecture), `save_formula_template` et
  `delete_formula_template` (écriture sur autorisation, comme les autres outils d'écriture).
  Exception assumée à la règle « station:admin, pas d'outil MCP » de l'ADR-0022 : un modèle de
  formule n'est ni un secret ni un effet externe, et l'agent doit pouvoir proposer une formule
  (#1948, lot 7).
- **Pas de journal** : ce n'est pas un fait de l'épreuve (ADR-0005). Appliquer un modèle à une
  épreuve passe par la commande qui modifie la formule de l'épreuve, qui journalise.
- Codes d'erreur existants seulement (`station_refused`, `not_found`, ADR-0009).

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

## Conséquences

- Le sélecteur et le badge sont derrière le réglage `formulaPreview` (ADR-0032) ; les opérations
  du contrat et les outils MCP sont livrés directement (D13).
- Les modèles personnels restent propres au poste jusqu'à #1982, qui dira s'ils se partagent.
- `docs/MCP.md` et `docs/API_CONTRACT.md` sont régénérés (`npm run docs:mcp`).
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
