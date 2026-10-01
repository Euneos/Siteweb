# Liens publics des formulaires de suivi

Les quatre formulaires s’ouvrent sans compte ni code : `/suivi/fiche-contact`,
`/suivi/deploiement`, `/suivi/activites-jeunes`, `/suivi/participants`.
Les anciens liens `?t=…` restent préremplis et suivent leur contrat antérieur.
Le répondant indique son établissement, sa ville, l’année scolaire puis ses réponses.
Le catalogue interne propose les liens publics à copier dans les guides.

## Conservation et rattachement

Chaque contenu distinct est conservé intégralement dans la table privée NocoDB
`reponses_formulaires_site` avant toute modification de dossier. D1 ne garde que
les empreintes, identifiants et états techniques. Un double envoi identique réutilise
le même reçu ; un POST distant incertain n’est jamais répété à l’aveugle.
Aucune réponse ni existence de dossier/email n’est exposée publiquement.
Aucun email n’est envoyé par ce nouveau parcours.

Un nom et une ville exacts, une campagne active unique, un dossier ouvert unique
et un email déjà enregistré comme référent ou direction permettent le report par
le moteur existant. C’est une déclaration publique, pas une authentification du
répondant. Le nom, la ville ou l’email incertains, les dates contradictoires et les
changements concurrents restent à vérifier par l’équipe, sans perte de la source.
Les réponses publiques sont lisibles dans le catalogue interne après Access.
Les décisions de candidature et missions ne sont pas déduites de ces réponses.

## Activation

1. Créer la table additive décrite par `migrations/nocodb/public-forms.json`, sans
   toucher aux tables existantes. Vérifier noms/types et l’absence de partage public.
2. Appliquer `migrations/0009_public_form_receipts.sql` au registre FORM_SUBMISSIONS,
   après lecture du schéma existant. La migration est additive et idempotente.
3. Configurer PUBLIC_FORMS_TABLE avec l’identifiant non secret de la table.
4. Tester les quatre liens, les erreurs, les reprises, la confidentialité et le
   catalogue. Publier le code testé. Les préversions restent en simulation et
   n’utilisent pas les réponses réelles.

La migration TEAM_WORKSPACE des calendriers est distincte : son pipeline ne doit
pas être utilisé pour appliquer le registre FORM_SUBMISSIONS.

## Périmètre

Les candidatures établissement et formateur restent déjà publiques sur leurs URL.
Cette évolution rend publics les formulaires de suivi existants, sans inventer les
questionnaires encore non migrés du parcours formateur ou de l’évaluation.
Les Google Forms déjà envoyés conservent leur collecte de transition.
