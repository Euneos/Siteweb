# Espace interne EUNEOS — mise en service

Cette PR prépare les calendriers éditorial et équipe, les commentaires et la bibliothèque de ressources. Elle ne remplace pas encore les calendriers Notion. Tant que les accès, la reprise et la recette métier ne sont pas terminés, **Notion reste la source utilisée par l’équipe**.

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

## Configuration à réaliser après revue de la PR

1. Activer Cloudflare Access sur le compte EUNEOS, choisir la formule et approuver les éventuels engagements dans le compte du client. Au contrôle du 17 septembre, l’API du compte répond `access.api.error.not_enabled` ; aucune application ni audience utilisable n’a donc été obtenue. Le navigateur n’est pas connecté au tableau de bord.
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

## Vérification reproductible

`bun run test`, `bun run build`, `bun scripts/check-internal-workspace.mjs` et `bun scripts/check-internal-table.mjs`. Les recettes compilées utilisent exclusivement des identités signées locales et des données fictives ; aucun contournement d’authentification n’est embarqué dans le site. La CI conserve aussi les contrôles newsletter, mise en page, rythme et responsive des pages publiques.
