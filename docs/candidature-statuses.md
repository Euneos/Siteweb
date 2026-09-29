# Statuts de candidature : présentation et choix futurs

`src/lib/statut-candidature.ts` définit cinq choix pour les participations
établissements. Il ne modifie aucune ligne ou option NocoDB.

| Code existant, conservé | Libellé affiché |
|---|---|
| `Candidature recue` | Candidature reçue |
| `Candidature acceptée` | Candidature acceptée |
| `Engage` | Établissement engagé |
| `Abandonne` | Abandon |
| `Refuse` | Refus |

L’ancien code `En cours d’analyse` se lit et se filtre sous **Candidature reçue**.
Il n’est plus proposé pour une nouvelle décision. `Retenu`, `Accuse reception`,
`Invite`, `En discussion` et les valeurs inconnues restent explicitement
**historiques à qualifier**. `Retenu` ne prouve jamais une acceptation, même avec
une date de validation ou des pièces renseignées. Le filtre des historiques est
une aide de consultation, pas un sixième choix de décision.

La normalisation concerne la présentation : les codes sources, identifiants,
cohortes, archives et pièces restent intacts. Deux pièces présentes ne changent
jamais une candidature acceptée en engagement. Un ancien code `Engage` affiche
la décision enregistrée ; son libellé ne certifie pas les justificatifs.

Le suivi applique les filtres après la réconciliation existante des archives.
La commande `etablissement` permet toujours de consulter une archive avec sa
valeur stockée, sans redirection vers une autre ligne. Les statuts formateurs
ne sont pas concernés.

`bun scripts/base.mjs statut <id> "<code>"` conserve son caractère de commande
d’écriture explicite. Elle accepte seulement les cinq codes du tableau, jamais
un libellé nouveau ou un ancien choix. Un choix déjà enregistré ne produit
aucun PATCH. Pour une nouvelle décision `Engage`, elle relit les deux cases
`fiche_contact_recue` et `lettre_interet_signee` immédiatement avant l’écriture
et exige `true` ou `1` pour chacune. Cela vérifie les indicateurs de la base,
pas les documents eux-mêmes ; la qualification des anciennes données reste
une revue séparée. La prélecture n’est pas une transaction distante.

Cette correction n’ajoute ni champ, migration, promotion automatique, envoi
d’email ni déclencheur. Les flux existants et les contrôles des formulaires
opérationnels restent inchangés puisque les codes stockés sont conservés.
Les appels de mutation des tests utilisent exclusivement une base simulée.

Contrôles : `bun test tests/statut-candidature.test.ts tests/etat-candidatures.test.js
tests/base-read.test.js tests/base-write.test.js`, `bun run build`, puis
`bun scripts/check-internal-table.mjs` pour la page compilée avec des données
synthétiques et sans accès distant.
