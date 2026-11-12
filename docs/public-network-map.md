# Carte publique du réseau

`/oùnoustrouver` est une page publique, dans le sous-menu Programme, au même niveau que FAQ.
Elle partage l’en-tête et le pied de page du site. Les sources restent NocoDB et les corrections
de résidence configurées côté serveur ; aucune copie locale de données réelles n’est versionnée.

## Mise à jour automatique

La route Astro est rendue à la demande (`prerender = false`) et répond avec
`Cache-Control: no-store, max-age=0`. Chaque ouverture ou actualisation relit les sources complètes,
avec leur pagination et la réconciliation des doublons archivés. Aucun cron, webhook ou envoi
supplémentaire n’est nécessaire. Une page déjà ouverte conserve sa sélection et ses données
jusqu’à son actualisation ; elle ne lance pas de scrutation en arrière-plan.
Les cinq tables sont lues une seule fois, successivement, pour éviter les rafales NocoDB.
Les requêtes sont espacées et les visites simultanées partagent uniquement la lecture en cours.
Une réponse de limitation HTTP 429 déclenche une nouvelle lecture après 30 secondes ;
aucune écriture ni soumission de formulaire n’est répétée.

La page utilise `NOCODB_TOKEN`, `RESOURCE_NETWORK_LOCATIONS` et `RESOURCE_NETWORK_RESIDENCES`
déjà disponibles côté serveur. Aucun secret n’est transmis au navigateur. Si une lecture échoue,
la réponse est une indisponibilité HTTP 503, sans ancien résultat présenté comme actuel.

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

## Données publiques et contrôles

Les sérialisations publiques sont des listes blanches : noms d’établissements, communes,
repères géographiques publics, années et états d’affichage ; effectifs anonymes de formateurs
par ville et état. Aucun nom de personne, contact, identifiant de personne ou numéro de dossier ne
sort des lecteurs serveur.

- `bun run test` couvre les filtres, les états, les personnes sans localisation, le dédoublonnage
  et le maintien du périmètre privé.
- Après `bun run build`, `bun scripts/check-public-network.mjs` vérifie la route compilée,
  la mise à jour à la requête suivante, l’absence de cache et de données privées, les sélections,
  l’unicité des régions et le balayage de 320 à 3840 px avec une base entièrement simulée.
- Ce contrôle est inclus dans le workflow Deploiement. Aucun envoi ni changement réel en base
  n’est effectué pendant la recette.
