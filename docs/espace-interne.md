# Espace interne EUNEOS — mise en service

Cet espace réunit les calendriers éditorial et équipe, les commentaires, la bibliothèque de ressources et la carte des implantations. Elle ne remplace pas encore les calendriers Notion. Tant que les accès, la reprise et la recette métier ne sont pas terminés, **Notion reste la source utilisée par l’équipe**.

Le [tableau des candidatures](tableau-interne.md) continue à lire NocoDB côté serveur. Les calendriers ont un stockage collaboratif distinct : D1, binding `TEAM_WORKSPACE`. Ne pas utiliser `FORM_SUBMISSIONS`, registre technique des formulaires publics, pour les heures ou les commentaires.

## Droits et parcours

| Route                                              | Public                         | Opérations                                                                                              |
| -------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `/interne` et `/api/interne/calendrier`            | Équipe identifiée              | Calendriers, publications, propres heures et absences ; validation des heures réservée aux responsables |
| `/api/interne/commentaires`                        | Équipe identifiée              | Lecture et ajout, auteur imposé par l’identité vérifiée                                                 |
| `/interne/catalogue` et `/api/interne/catalogue`   | Responsables de l’équipe       | Ajout de ressources au catalogue                                                                        |
| `/interne/ressources` et `/api/interne/ressources` | Équipe et formateurs autorisés | Lecture des ressources publiées uniquement                                                              |
| `/etat-candidatures`                               | Équipe identifiée              | Lecture NocoDB, aucune modification implicite des dossiers                                              |

Deux applications Cloudflare Access avec **deux audiences différentes** sont nécessaires : équipe et bibliothèque. Configurer des listes nominatives, jamais « Everyone » ni un simple domaine d’email pour les formateurs. Le JWT doit être signé, non expiré, avec l’émetteur et l’audience attendus. Un simple en-tête email n’est pas accepté. `INTERNAL_ADMIN_EMAILS` donne uniquement le rôle de responsable à des membres déjà admis dans l’application équipe ; cette variable seule n’accorde aucun accès.

L’application bibliothèque doit couvrir les deux chemins exacts `/interne/ressources` et `/api/interne/ressources`, et leur variante avec slash final. L’application équipe couvre `/interne`, `/interne/*`, `/api/interne/*`, `/etat-candidatures` et sa variante avec slash final. La règle bibliothèque plus spécifique doit gagner. L’administration du catalogue reste sur un chemin équipe distinct : un JWT bibliothèque, même portant l’adresse d’un responsable, ne permet jamais d’écrire. Répéter ces protections pour les domaines de preview/alias utilisés. Le contrôle serveur refuse aussi les accès directs au déploiement qui ne fournissent pas le bon JWT.

Les liens de ressources ne modifient pas les permissions des fichiers Drive/Canva d’origine. Ce catalogue n’est pas un hébergeur de pièces jointes et n’accorde pas de nouveaux droits sur les fichiers.

## Carte des implantations

`/interne/implantations` et `/api/interne/implantations` utilisent la même identité équipe que les candidatures ; une audience formateur est refusée. La page n’utilise pas D1 : elle lit intégralement les cohortes, participations et établissements de NocoDB côté serveur, avec une projection des seuls champs nécessaires. Aucun nom de contact, email ni adresse de rue n’est lu pour la carte.

Chaque groupe conserve ses dossiers sources, regroupés uniquement lorsque établissement et cohorte sont connus. Les abandons, statuts mixtes, cohortes inconnues et localisations manquantes restent visibles dans la liste et les filtres. Les compteurs distinguent établissements, participations et groupes : ce ne sont pas des unités interchangeables.

Les repères utilisent le **centre de la commune**, sans prétendre localiser l’école. Le nom normalisé et le code postal doivent correspondre exactement à une commune du référentiel public. Aucune approximation silencieuse ni requête vers un géocodeur n’a lieu pendant la consultation. Métropole/Corse et cinq DROM disposent de fonds séparés ; les autres territoires ou données non résolues restent dans la liste, sans point inventé.

Références publiques du 17 septembre 2026 : [API communes](https://geo.api.gouv.fr/decoupage-administratif/communes), [contours régionaux Etalab/IGN 2026](https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/2026/geojson/regions-1000m.geojson), Licence Ouverte. Le référentiel est complet et ne contient aucun rapprochement EUNEOS. Son actualisation passe par une nouvelle version revue.

## Configuration et déploiement

### Statut Programmé — 24 septembre

Le schéma courant comprend `0001_workspace.sql` puis
`0002_programme_status.sql`. Cette seconde migration a été appliquée et relue
sur les bases de préversion et de production avant la publication du nouveau
statut. Ne pas la rejouer sur ces bases : vérifier d'abord le `CHECK` de
`workspace_entries` dans `sqlite_schema`. Les sauvegardes et reçus d'exécution
restent dans le dossier d'exploitation privé.

Sur une nouvelle base, appliquer les deux fichiers dans l'ordre, chacun dans
une transaction. `0002` conserve tous les champs, commentaires, ressources,
index et clés étrangères ; seul `programme` s'ajoute aux statuts autorisés.
D1 fournit la transaction implicite : transmettre le fichier entier sans
désactiver les clés étrangères, puis comparer les données avant/après et
exécuter `PRAGMA foreign_key_check`. Les tests SQLite et D1 local couvrent
aussi l'annulation complète en cas d'erreur.

Le menu Canal propose LinkedIn, Newsletter et Site. Une valeur historique
différente reste visible et conservée jusqu'à son remplacement explicite.
L'activité est masquée dans la fiche sans effacer sa valeur enregistrée.

### Publication du 21 septembre

La configuration de production lie désormais `TEAM_WORKSPACE` à la base européenne
`euneos-team-workspace`, avec le schéma `migrations/interne/0001_workspace.sql`.
La préversion conserve sa base distincte et son bandeau d’essai. Le registre
`FORM_SUBMISSIONS` et les variables des formulaires sont conservés dans les deux environnements.

`INTERNAL_WORKSPACE_IMPORT_PENDING=true` affiche en production que l’historique Notion
n’a pas encore été repris. Les nouvelles saisies sont persistantes ; la publication
n’effectue aucun import et ne synchronise pas les deux outils. Retirer ce paramètre
après une reprise vérifiée. Les identités, audiences Access et rôles responsables
restent configurés côté serveur, hors du dépôt public.

### Préparation du 21 septembre

La base D1 européenne `euneos-team-workspace-preview` a été créée et la migration
`0001_workspace.sql` appliquée. Ses trois tables sont vides : aucun historique Notion
n'a été importé. Son binding existe uniquement dans `env.preview` ; aucun binding
des calendriers n'est ajouté à la production. La configuration de préversion conserve
explicitement les variables et le registre des formulaires déjà présents.

`INTERNAL_WORKSPACE_PREVIEW=true` affiche un avertissement sur les pages de l'espace :
les saisies réelles restent dans Notion jusqu'à la bascule. La carte et le suivi
consultent NocoDB en lecture seule. Les domaines et audiences Access ne sont pas
inventés : ils seront renseignés après la création des applications réelles.

Cette préparation D1 ne donne aucun accès à elle seule : tant que les audiences
ne sont pas configurées, les routes refusent toute lecture de données. Conserver
les listes nominatives et le suivi d'activation dans le dossier d'exploitation privé,
sans les ajouter au dépôt du site.

1. Cloudflare Access est activé sur le compte EUNEOS. Maintenir les protections équipe et bibliothèque sur tous les domaines servis, y compris le domaine Pages et les alias de préversion ; vérifier les refus anonymes avant chaque changement de domaine.
2. Vérifier avec EUNEOS les emails de l’équipe, les responsables habilités à valider et la liste des formateurs ayant accès aux ressources. Créer les deux applications et relever leurs audiences réelles.
3. Définir `INTERNAL_ACCESS_DOMAIN`, `INTERNAL_ACCESS_AUD`, `RESOURCE_ACCESS_DOMAIN`, `RESOURCE_ACCESS_AUD`, `INTERNAL_ADMIN_EMAILS` dans l’environnement cible. Le domaine est de la forme `equipe.cloudflareaccess.com`, sans URL ni slash ; l’audience est celle de l’application, pas son nom.
4. Créer une base D1 **de preview distincte**, puis y appliquer `migrations/interne/0001_workspace.sql`. Ajouter le binding `TEAM_WORKSPACE` dans la configuration `env.preview` de Wrangler, avec l’ID réel. Préserver les autres bindings explicitement lorsque l’environnement les remplace. Les previews Pages partagent leur configuration d’environnement : ne pas y placer de données client avant protection effective de tous les alias accessibles.
5. Faire la recette avec des identités équipe, responsable, formateur et visiteur. Vérifier les pages ET les API, les permissions Drive, les écritures signées, les conflits et les totaux. Aucun accès au calendrier ou aux candidatures avec une identité formateur.
6. Préparer une base de production séparée, la reprise auditée et une date de bascule. Présenter la preview à Charlotte/Candice/Pauline. La PR n’autorise pas à lancer une deuxième saisie concurrente ni à publier en production.

Exemple de binding, à compléter avec une base réellement créée — ne pas copier un identifiant de production dans la preview :

```toml
[[env.preview.d1_databases]]
binding = "TEAM_WORKSPACE"
database_name = "euneos-team-workspace-preview"
database_id = "<ID_DE_LA_BASE_PREVIEW>"
migrations_dir = "migrations/interne"
```

L’absence de configuration renvoie une indisponibilité explicite et ne lit aucune donnée. Une base vide n’est affichée qu’après authentification et lecture réussie. Les réponses privées sont `no-store` et hors sitemap.

## Reprise Notion : préparation hors ligne

Les références d’équipe comprennent le calendrier principal et une sous-page « Plages horaires présence & vacances ». Le lien public permet de lire des vues, mais n’offre pas l’export intégral avec les auteurs, commentaires et métadonnées. Il ne suffit pas pour annoncer une migration complète.

Obtenir un export intégral autorisé ; conserver l’original dans les preuves privées, hors Git. Construire un manifeste normalisé contenant chaque fiche et ses commentaires explicitement vérifiés. Les champs d’origine non encore mappés restent dans `original`, notamment les deux plafonds mensuels dont la signification doit être confirmée. Un compte collectif comme « EUNEOS TEAM » reste attribué à ce compte. Ne jamais deviner une personne à partir du texte ou du titre.

```json
{
  "schemaVersion": 1,
  "exportedAt": "2026-09-17T12:00:00Z",
  "entries": [
    {
      "sourceId": "ID_STABLE_NOTION",
      "author": "Auteur identifié dans la source",
      "createdAt": "2026-09-01T12:00:00Z",
      "entry": {
        "kind": "equipe",
        "title": "Coordination",
        "starts_on": "2026-09-17",
        "ends_on": "2026-09-17",
        "person": "membre@example.test",
        "activity": "Coordination",
        "channel": "",
        "attendance": "presence",
        "location": "",
        "status": "a_valider",
        "hours": 3,
        "notes": "",
        "content": "",
        "link": ""
      },
      "original": { "propriétés": "copie complète de la source" },
      "comments": [
        {
          "sourceId": "ID_COMMENTAIRE",
          "author": "EUNEOS TEAM (Notion)",
          "content": "Commentaire source",
          "createdAt": "2026-09-02T12:00:00Z"
        }
      ]
    }
  ]
}
```

`Présence` / `OFF` alimente `attendance`, jamais le statut d’approbation. Une durée traversant plusieurs mois doit être répartie avec une règle métier explicite ; le validateur refuse une allocation arbitraire. Les doublons apparents restent à arbitrer, sans suppression déduite des titres. Les identités collectives ou multiples doivent être rapprochées avec l’équipe avant de calculer des totaux individuels définitifs.

```bash
# Validation seulement ; aucune connexion externe ni écriture distante.
bun scripts/prepare-workspace-import.ts /chemin/prive/snapshot.json
# Crée une nouvelle base locale privée, refuse d’écraser un fichier existant.
bun scripts/prepare-workspace-import.ts /chemin/prive/snapshot.json /chemin/prive/reprise.sqlite
```

Le script vérifie les données et les commentaires avant écriture, conserve dates/auteurs/propriétés originales, refuse les identifiants source dupliqués et rejoue l’import pour vérifier son idempotence. Toute divergence d’une source existante annule la transaction entière. Un réimport identique préserve les modifications déjà faites dans la destination. Ce script produit une base locale de préparation ; il n’importe pas automatiquement dans D1 et ne ferme pas Notion.

Avant bascule : comparer fiches/commentaires et totaux par personne/mois, vérifier les sources non mappées, faire valider, sauvegarder l’existant et convenir d’un seul outil de saisie. Aucun historique existant n’a encore été importé.

## Saisie quotidienne des heures — proposition du 22 septembre

Avant de déployer cette version, appliquer `migrations/interne/0004_daily_hours.sql` dans l’environnement de préversion, puis dans celui de production uniquement après validation de l’aperçu. La migration ajoute une colonne vide aux anciennes fiches ; elle ne répartit ni ne modifie leurs totaux. Ne pas fusionner tant que cette préparation et la recette de préversion ne sont pas vérifiées. Le workflow de déploiement ne réalise pas cette migration automatiquement.

Dans Équipe & heures, « Saisir les heures par jour » active le détail quotidien pour une période dans un même mois. Le préremplissage propose 7 h les mardis et jeudis sans remplacer les valeurs existantes. Chaque mercredi/vendredi dispose d’un raccourci 3 h 30. Les heures réalisées restent vides tant qu’elles ne sont pas saisies ; le total déclaré est calculé uniquement sur le réalisé. Les jours vides ne sont pas affichés. Une ancienne fiche reste en mode période jusqu’à sa conversion explicite ; la conversion avertit avant de remplacer un total non réparti. Les droits et la validation par un responsable restent identiques.

Les tests unitaires couvrent la persistance, le déplacement d’une demi-journée, les dépassements, les dates invalides et la distinction prévu/réalisé. La recette compilée couvre aussi la saisie, le rechargement et l’affichage sur téléphone/ordinateur avec des données fictives.

## Vérification reproductible

`bun run test`, `bun run build`, `bun scripts/check-internal-workspace.mjs` `bun scripts/check-internal-table.mjs` et `bun scripts/check-implantations.mjs`. Les recettes compilées utilisent exclusivement des identités signées locales et des données fictives ; aucun contournement d’authentification n’est embarqué dans le site. La CI conserve aussi les contrôles newsletter, mise en page, rythme et responsive des pages publiques.


## Dossiers courants et historique des regroupements

La carte et le suivi des candidatures lisent tous les enregistrements avant de valider `fusionne_vers`. Une fiche portant cet Id est une archive conservée ; sa cible doit exister, être courante et avoir le même établissement et la même cohorte. Pour les parcours formateurs, la personne doit être identique et une cohorte non renseignée des deux côtés peut être conservée. Les chaînes, cycles et identités divergentes provoquent une erreur de cohérence, pas un masquage silencieux.

Les totaux portent sur les dossiers courants. Les fiches sources et leurs valeurs demeurent consultables dans la vue NocoDB « Historique des regroupements » ; `historique_fusion` conserve les valeurs et les anciennes références. Ces archives ne doivent pas être modifiées comme des candidatures actives. Le numéro d'établissement, stable sur plusieurs années, est affiché séparément du numéro de dossier. Les références importées `ETAB-C…` ne sont pas des clés uniques.

Avant tout futur regroupement, contrôler aussi les relations enfants. Une fiche portant encore des missions, adultes, groupes ou présences nécessite leur rattachement ou agrégation vérifiés dans le suivi courant ; renseigner seulement `fusionne_vers` ne réalise pas ce travail. Les archives préparées pour cette publication ne portent aucun lien enfant.

Le déploiement exige les champs `fusionne_vers` (Number, vide par défaut) et `historique_fusion` (LongText) sur participations et parcours formateurs. Une lecture sans ce champ est compatible avec l'ancien schéma, mais aucune donnée ne doit être marquée archivée avant préparation de l'historique et contrôle des liens. Les autres outils qui lisent NocoDB directement doivent appliquer le même contrôle ; un filtre d'interface NocoDB ne filtre pas automatiquement l'API.
