---
name: adr-check
description: Contrôle de conformité de la branche courante aux ADR acceptées (agent adr-conformity, opus, lecture seule) — matrice phrase normative → code → test et verdict BLOQUANT / OK. Obligatoire avant de passer une PR en « ready », avant tout push d'une PR refactor ou #1978 / #2013, et dès qu'une ADR est modifiée.
---

# /adr-check

Contrôle la branche courante contre les ADR qu'elle cite ou modifie (docs/adr, CLAUDE.md
section « Nouvelle fonctionnalité – ADR »).

## Étapes

1. Vérifier qu'on est sur une branche de travail (pas `dev`, pas `main`) et que le travail
   est commité (`git status --short` vide, sinon le signaler : l'agent lit les commits).
2. Lancer l'agent `adr-conformity` (outil Agent, `subagent_type: "adr-conformity"`) avec
   **seulement** cette consigne :
   « Contrôle la conformité aux ADR de la branche courante contre origin/dev. »
   - Ne jamais lui transmettre de résumé du travail, d'explication ni de liste d'ADR : il
     collecte lui-même le diff, les commits, la PR et les ADR.
   - Si le type d'agent n'est pas chargé dans la session (agent créé en cours de session) :
     agent `general-purpose`, `model: "opus"`, dont la consigne est le corps de
     `.claude/agents/adr-conformity.md` lu tel quel, suivi de la même phrase. Rester en
     lecture seule.
3. Rendre à l'utilisateur la matrice et le verdict tels que l'agent les donne.
4. Verdict `BLOQUANT` :
   - ne pas pousser, ne pas passer la PR en « ready » ;
   - écart de code ou de test → corriger dans un nouveau commit, puis relancer /adr-check ;
   - écart qui demande de changer l'ADR → **poser la question** à l'utilisateur ; amendement
     rédigé seulement après son accord, validé par lui avant le code ;
   - `non couvert` → ajouter le test qui prouve la phrase, puis relancer.
5. Verdict `OK` : le push (ou le passage en « ready ») peut se faire.
