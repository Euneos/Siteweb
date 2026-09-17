# Tableau interne des établissements

Route : `/etat-candidatures`. Lecture seule, cohorte 2026–2027, aucune écriture ni notification.

## Mise en service de l’accès

Cette page refuse de lire NocoDB avant authentification. Elle n’est pas publiée par la fusion d’une PR dans un état ouvert : sans configuration Access, elle renvoie 503. Un accès direct au domaine Pages sans jeton valide renvoie 403.

Configurer une application **Cloudflare Access** sur le chemin du tableau, pour le domaine de production et celui de l’aperçu. Autoriser nominativement les membres de l’équipe. Reporter dans chaque environnement Pages :

- `INTERNAL_ACCESS_DOMAIN` : domaine d’équipe, sans protocole, par exemple `equipe.cloudflareaccess.com` ;
- `INTERNAL_ACCESS_AUD` : audience de l’application Access correspondante ;
- `NOCODB_TOKEN` : secret serveur existant.

L’utilisateur passe par la connexion Access ; aucun compte de site supplémentaire ni mot de passe collectif n’est créé. Ne pas inventer une audience ni réutiliser celle d’une autre application. Les réglages de preview et production sont indépendants.

L’origine vérifie signature RS256, émetteur, audience, expiration et identité. Un simple en-tête email ne donne aucun accès. Référence : [validation des JWT Cloudflare](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).

## Les dix colonnes

| Groupe | Colonne | Preuve affichée |
|---|---|---|
| Candidature | Reçue | Date de candidature ; sinon non renseignée |
| Candidature | Accusé de réception | Statut courant correspondant ; un statut ultérieur ne prouve pas l’envoi |
| Candidature | Analyse et décision | Statut courant ; abandons/refus conservés |
| Sélection | Sélectionné | Date de validation ou statut d’acceptation ; date absente explicitée |
| Sélection | Lettre signée | Case de suivi, sans prétendre avoir vérifié le PDF |
| Sélection | Fiche contact | Case reçue |
| Sélection | Formateur désigné | Personne reliée à une mission non annulée, pas l’apporteur |
| Déploiement | Organisation | Missions reliées, nombre et statut, sans présumer leur achèvement |
| Déploiement | Formations et suivi | Nombre déclaré d’adultes formés ou début renseigné ; pas de suivi complet déduit |
| Déploiement | Ateliers et évaluation | Non documentés dans cette vue ; pas de fausse validation à partir d’un groupe créé |

La lecture parcourt toutes les pages NocoDB et vérifie l’unicité de la cohorte. Les noms de référents, emails, téléphones et notes internes ne sont pas demandés. Les dossiers en doublon restent visibles et signalés : ce tableau ne réalise aucune fusion.

Sur téléphone, chaque établissement devient une fiche avec les dix libellés ; sur ordinateur, l’en-tête conserve les trois groupes et dix sous-colonnes. Une erreur de source reste un état d’erreur, jamais zéro établissement.

Avant validation client : configurer Access sur l’aperçu, vérifier un membre autorisé et un visiteur refusé, comparer le total à NocoDB, puis faire relire la progression par Charlotte. Ne pas présenter la simple réussite des tests comme cette recette métier.
