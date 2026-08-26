---
name: preparer-un-email
description: Rédiger un e-mail à partir des modèles officiels d'EUNEOS (accusé de réception, invitation, confirmation, refus, liste d'attente, lettre d'intérêt). À utiliser quand l'équipe veut écrire à un établissement, à un formateur ou à un candidat.
---

# Préparer un e-mail

EUNEOS a **16 modèles rédigés**, stockés dans la base. Ils ne s'inventent pas : on part
toujours du modèle existant.

```
bun scripts/base.mjs modeles          # la liste
bun scripts/base.mjs modele <code>    # le contenu complet d'un modèle
```

## Les modèles disponibles

**Formateurs** — `accuse_formateur` · `invitation_reunion` · `confirmation_formation` ·
`liste_attente` · `refus_formateur` · `equipe_cand_formateur`

**Établissements** — `accuse_etab` · `lettre_interet` · `fiche_contact` ·
`form_deploiement` · `liste_participants` · `bilan_etab` · `equipe_cand_etab`

**Évaluation** — `questionnaire_pre` · `questionnaire_post` · `questionnaire_j45`

## Méthode

1. Lire le modèle.
2. Ouvrir la fiche de la personne ou de l'établissement pour avoir les vraies valeurs :
   `bun scripts/base.mjs etablissement <id>`.
3. Remplacer les variables — `{{prenom}}`, `{{nom}}`, `{{etablissement}}`, `{{cohorte}}`,
   `{{date}}` — par les valeurs réelles. **Ne jamais laisser une variable non remplie** dans
   un texte destiné à partir : le système précédent a envoyé des e-mails contenant
   littéralement `[URL Web App]`.
4. Présenter le message final, prêt à copier.

## Règles

- **Rien ne part d'ici.** Le message est remis à l'équipe, qui l'envoie depuis sa messagerie.
  Le dire à chaque fois.
- **Ne pas réécrire le fond d'un modèle** sans le demander. Ces textes ont été pesés : ils
  engagent l'association auprès d'établissements scolaires.
- Si un modèle doit changer durablement, il se modifie **dans NocoDB**, table
  `templates_emails` — pas dans le message du jour.
- Si aucun modèle ne convient, le dire, et proposer d'en créer un plutôt que d'improviser
  au coup par coup.
