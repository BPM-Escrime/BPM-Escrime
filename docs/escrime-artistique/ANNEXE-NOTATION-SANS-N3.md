# Annexe de calcul — N1 du classeur régional, N2 du règlement officiel (N3 désactivé)

## Décision fonctionnelle

Cette annexe formalise la décision du projet : **reproduire N1 et la structure `2×N1+N2` observés dans le tableur `Notation Juge.xlsx`, mais remplacer son calcul N2 par le barème du Livret 4 FFE sabre laser chorégraphié 2026-2027**.

Il **n’existe pas de second mode de notation N2 = somme de cinq notes sur 2** dans le profil cible. Le fichier Excel original est conservé comme **source de traçabilité**, et non comme règle normative sur N2.

## Sources

- Tableur fourni : `Notation Juge.xlsx` (feuilles `Technique`, `Artistique`, `NOTE FINALE`, `Données`).
- Règlement officiel : https://www.ffescrime.fr/wp-content/uploads/2024/09/REGLEMENT_Livret_4_CombatChoregraphie_v.septembre2026.pdf (pages imprimées 17 et 19, système de notation).
- Le règlement PDF publié comporte des modifications visibles par ratures : la phrase « par pas d’un quart de point » est barrée. **Ne pas coder un incrément obligatoire de 0,25** sans précision supplémentaire de la fédération.

## Correspondance entre les cellules Excel et le calcul BellePoule

| Source | Excel original | BellePoule Modern : cible 2026-2027 |
|---|---|---|
| `Technique!C/E/G` lignes 2–26 | `C = B×0,8`, `E = D×0,9`, `G = F×1` | Identique : note pondérée par phrase |
| `Technique!I27:I29` | Somme pondérée, nombre de phrases notées, N1 = somme / nombre | Identique dans le principe ; pas de limite fixée à 25 phrases |
| `Artistique!F3:F7` | 5 notes de 0 à 2 (pas 0,25) | **5 notes de 0 à 10**, une pour chaque critère officiel |
| `Artistique!F8` | `SUM(F3:F7)` | **`AVERAGE(5 critères)`** |
| `Artistique!F9`, `NOTE FINALE!F4` | `=Technique!I29*2+F8` | **`NFJ = 2×N1 + N2`** (N2 fédéral) |
| `NOTE FINALE!F17` | Ajout immédiat des cartons signés | Ne pas recopier : seules les pénalités **validées** lors de la délibération modifient le résultat collectif |
| `Données!A14:A22` | Valeurs N2 historiques de 0 à 2 | Pas de liste d’échelle N2 héritée ; bornes selon profil fédéral |

## Formules cibles

```text
Pour chaque phrase i :
  coefficient_i = { simple:0.8, complexe:0.9, avancée:1.0 }[difficulte_i]
  noteTechniquePonderee_i = noteBrute_i × coefficient_i

N1 = somme(noteTechniquePonderee_i) / nombre_phrases_evaluees

Critères N2, de 0 à 10 :
  histoire, scenographie, espace, harmonie, interpretation
N2 = (histoire + scenographie + espace + harmonie + interpretation) / 5

NFJ = 2 × N1 + N2                  // sur 30, avant pénalités
NFP = agrégation réglementaire des NFJ − pénalités validées
```

- **N3 = désactivé**, absent du calcul, sans renormalisation.
- Une note explicitement à zéro n’est pas une note absente. Les cases N2 vides rendent un bulletin incomplet.
- La question « phrase manquante notée zéro, incluse dans le dénominateur ? » doit être validée par rapport aux pratiques de jugement applicables. Ne pas imposer une réponse implicite par `COUNT` sans test.
- Précision et arrondis : éviter les arrondis intermédiaires arbitraires ; spécifier une politique de calcul à valider sur des résultats officiels.

## Fixture chiffrée officielle cible (adaptation N2)

| Phrase | Difficulté | Note brute | Note pondérée |
|---|---|---:|---:|
| 1 | Simple | 10 | 8 |
| 2 | Complexe | 8 | 7,2 |
| 3 | Avancée | 9 | 9 |

`N1 = (8 + 7,2 + 9) / 3 = 8,066666…`

| Critère artistique fédéral | Note sur 10 |
|---|---:|
| Compréhension de l’histoire | 7,50 |
| Scénographie | 8,75 |
| Espace scénique | 6,25 |
| Harmonie | 7,50 |
| Interprétation | 10,00 |
| **Moyenne N2** | **8,00** |

`NFJ = 2×8,066666… + 8 = 24,133333… / 30`, avant arrondi ou pénalité.

**Les notes du tableau constituent un test fictif de calcul et ne sont pas un résultat de championnat validé.**

## Périmètre de cette annexe

Cette annexe concerne **uniquement le profil de sabre laser chorégraphié FFE 2026-2027**. La formule `NFJ=2×N1+N2` n’est pas utilisée en artistique classique FFE v4.1 : le classique conserve ses deux programmes Technique et Libre et le calcul prévu par son règlement. N3 est absent des deux règlements officiels étudiés.

## Points non encore documentés par les sources

1. **N3 activé** : aucun calcul à reprendre de ce tableur `.xlsx`, qui ne comporte pas N3 ; une formule historique séparée reste nécessaire pour les profils qui l’autorisent.
2. **Phrase manquante** : effet sur le dénominateur de N1, puis avance du compteur, à valider explicitement.
3. **Arrondis / précision N2** : la mention de pas de 0,25 est barrée dans le PDF officiel ; ne pas ajouter une contrainte non fondée.
4. **Validation réglementaire du résultat global** : intégrer le nombre de juges et l’élimination éventuelle des extrêmes avant pénalités validées, selon le profil national/régional.
