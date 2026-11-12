# Carte publique du réseau

`/oùnoustrouver` est une page publique, dans le sous-menu Programme, au même niveau que FAQ.
Elle partage l’en-tête et le pied de page du site. Les sources restent NocoDB et les corrections
de résidence configurées côté serveur ; aucune copie locale de données réelles n’est versionnée.
La carte des établissements est également intégrée à `/programme`, dans un encart vert plié, sans silhouette, après la FAQ.
La carte des formateurs figure en bas de `/candidater/formateur`, avant le retour au Programme
et le trait blanc qui sépare le pied de page. `PublicNetworkMap` et `lireCartesPage` sont communs
aux trois pages : seuls le fond, le titre et le bouton d’action changent. Le Programme conserve
sa page statique et ses photos optimisées ; sa carte charge les données à chaque ouverture via
`GET /api/reseau-public?carte=school`, sans cache. Les deux autres pages sont rendues à la demande.
Une panne temporaire de NocoDB conserve la dernière carte complète avec sa date de mise à jour.
Sans aucune lecture initiale réussie, la carte affiche son indisponibilité ; aucun effectif n’est inventé.

## Mise à jour automatique

Les réponses publiques et l’API gardent `Cache-Control: no-store, max-age=0` pour le navigateur.
La projection anonyme est partagée dans `TEAM_WORKSPACE.public_network_snapshots` (migration 0018).
Une seule lecture complète de NocoDB est autorisée par minute pour l’ensemble des visiteurs,
des instances Workers et des trois emplacements, grâce à un bail atomique D1. Les requêtes concurrentes
réutilisent la dernière lecture complète ; au premier démarrage elles attendent le propriétaire du bail.

Après une minute, une visite sert la carte existante et lance sa mise à jour via `waitUntil`.
Les visites suivantes voient les nouvelles données une fois cette lecture terminée. En cas de panne,
la dernière carte reste affichée avec sa date exacte ; une nouvelle tentative est autorisée après 30 secondes.
Une page déjà ouverte conserve ses données et sa sélection jusqu’à son actualisation.
La migration est appliquée en preview puis production par le workflow habituel, avant Pages.
Les cinq tables NocoDB sont lues successivement, avec pagination et réconciliation des doublons.
Leur lecture complète dispose d’un budget de 20 secondes, inférieur aux 30 secondes de `waitUntil`.
Une limitation 429 libère le bail avec un délai partagé de 30 secondes ; aucune attente longue ni
promesse d’I/O n’est partagée en mémoire entre requêtes Cloudflare.
Aucune écriture NocoDB ni soumission de formulaire n’est répétée.

Les secrets `NOCODB_TOKEN`, `RESOURCE_NETWORK_LOCATIONS` et `RESOURCE_NETWORK_RESIDENCES`
restent côté serveur. Le stockage partagé contient uniquement la projection publique autorisée,
jamais les lignes privées, les contacts ou les identifiants des dossiers. La clé `network-v1` doit
être versionnée si le contrat public ou son périmètre de confidentialité change.

## Périmètre éditorial confirmé

- Établissements : tous les engagés et les candidatures acceptées. Exclure les abandons et les
  candidatures reçues non validées, même si un champ de formation est rempli.
- Les états terminés/en cours renseignés sont conservés. Une candidature acceptée se présente
  comme « Formation en cours » sur cette page uniquement. Un engagé dont la formation n’a pas
  d’état public se présente comme « Établissement engagé » : ne pas inventer un démarrage.
- Les libellés approuvés « Collège Charloun Rieu » et « Collège Paul Emile Victor » sont appliqués
  aux lectures d’affichage communes, sans réécriture des champs NocoDB.
- Formateurs : inclure les personnes formées et celles au statut exact « En cours de formation ».
  Une personne compte une fois ; un parcours validé prime si elle a également un parcours en
  formation. Les libellés publics sont « formateur(s) » et « en cours de formation ».
- Le répertoire privé des ressources conserve son périmètre validé uniquement. Son contrôle
  d’accès et ses compteurs ne sont pas élargis par la carte publique.

Les deux cartes regroupent leurs repères par région administrative. Le détail n’apparaît qu’au
clic et regroupe les villes, en gras. Les personnes sans localisation fiable restent accessibles
par « Sans repère » ; aucun repère n’est inventé. Les établissements sont dédoublonnés entre
années et les deux années restent consultables séparément.
La carte publique est limitée à la France (métropole et outre-mer), sans onglet Belgique.
Les cinq établissements dont le code postal importé empêchait la localisation ont une correspondance
publique vérifiée dans `src/data/public-school-communes.json`, avec une source par établissement.
Ce secours ne s’applique qu’au couple nom/ville confirmé et ne remplace jamais une localisation
déjà renseignée correctement dans la source. Les données internes ne sont pas réécrites.

## Données publiques et contrôles

Les sérialisations publiques sont des listes blanches : noms d’établissements, communes,
repères géographiques publics, années et états d’affichage ; effectifs anonymes de formateurs
par ville et état. Aucun nom de personne, contact, identifiant de personne ou numéro de dossier ne
sort des lecteurs serveur.

- `bun run test` couvre les filtres, les états, les personnes sans localisation, le dédoublonnage
  et le maintien du périmètre privé.
- Après `bun run build`, `bun scripts/check-public-network.mjs` vérifie la route compilée,
  les données communes aux emplacements, l’absence de cache navigateur et de données privées,
  la conservation d’une lecture complète lors d’une panne, les sélections, l’unicité des régions
  et le balayage de 320 à 3840 px avec une base entièrement simulée.
- Les tests `public-network-store` utilisent SQLite et vérifient le bail partagé, l’absence
  de rafales concurrentes, la reprise après panne et la protection contre un propriétaire expiré.
- Ce contrôle est inclus dans le workflow Deploiement. Aucun envoi ni changement réel en base
  n’est effectué pendant la recette.
