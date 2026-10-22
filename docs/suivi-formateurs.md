# Suivi des formateurs WISE-UP

Décision Candice : alerte à **wiseup@euneos.fr uniquement**, repères dans l’espace
interne et accès aux réponses de candidature depuis le suivi.

## Page interne

`/interne/formateurs` utilise la même audience Cloudflare Access que le suivi des
établissements. Lecture serveur paginée des personnes et parcours NocoDB ; les
archives `fusionne_vers` sont exclues après vérification des rattachements.
Les réponses ne sont pas mises en cache ni copiées dans une base intermédiaire.
Toutes les promotions sont affichées. Les compteurs distinguent personnes et
parcours. Les décisions restent celles du champ `statut`, sans déduction à partir
d’un accord signé. Les filtres portent sur nom/ville, statut et points d’attention.

Les repères affichent les candidatures datées des sept derniers jours et celles
encore au statut `Candidature recue` ou `Accuse reception` après trente jours.
Ce dernier repère ne signifie pas qu’aucun contact n’a eu lieu. Une actualisation
de la page relit la base. Aucun changement de statut automatique.

## E-mail

Le webhook existant de `parcours_formateur` appelle `/api/hook/candidature` à
l’insertion. La branche dédiée reconnaît `data.table_id` et
`records.after.insert`, garde les nouvelles candidatures `Candidature recue`
non archivées et adresse Brevo à wiseup@euneos.fr, indépendamment de `EQUIPE_EMAIL`.
Le lien utilise l’Id du parcours : l’insertion précède parfois le rattachement
de la personne. Le message n’embarque pas les réponses personnelles.

La configuration et l’authentification du webhook existant ont été vérifiées par
GET, sans envoi. Les tests d’envoi utilisent uniquement un transport simulé.
Une panne de Brevo retourne 503 ; l’interface reste une lecture directe de la
base même si le mail échoue. Il n’existe pas de reçu durable de livraison ni de
déduplication des répétitions du webhook : ne pas promettre une livraison garantie
ou rejouer des événements historiques pour tester.

## Recette avant publication

`bun run test`, `bun run build`, puis
`CHECK_SCREENSHOTS=<dossier-local> bun scripts/check-suivi-formateurs.mjs`.
Ce contrôle rend la page compilée avec des données fictives et vérifie accès,
archives, pagination, erreur de base, clavier et largeurs 320/390/768/860/861/1440.
Relire les captures. Publier seulement après validation visuelle de Candice.
