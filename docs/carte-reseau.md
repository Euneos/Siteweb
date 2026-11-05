# Carte du réseau dans les Ressources

`/interne/ressources#carte-reseau` lit les personnes et parcours NocoDB via
`GET /api/interne/ressources?reseau=1`. Le chemin est volontairement celui déjà
protégé par l’application Access Ressources : aucune nouvelle autorisation,
aucune extension de l’audience équipe. L’API vérifie le JWT équipe ou ressources,
renvoie `private, no-store` et ne publie ni email, téléphone, notes, métier ni
adresse de rue. Aucune écriture dans les dossiers.

## Périmètre — retour Candice confirmé par Charlotte le 5 novembre 2026

- **Seul « Formateur validé » est admis**, en vert. Aucune cohorte, année de
  promotion ni date de formation n’est transmise dans les membres de l’API.
- Formations en cours, validations en attente, candidatures, accords seuls,
  invitations, attente de confirmation, refus et abandons sont exclus **côté
  serveur** : pas de noms, points, listes ni compteurs transmis à l’interface.
- Aucun filtre cohorte ni statut. La liste et les compteurs suivent le même
  périmètre validé. La métropole est affichée à l’ouverture, selon le dernier
  retour de Charlotte. Le filtre permet de choisir la Guadeloupe ou « Tous les
  territoires » pour afficher les cartes ensemble.
- Les archives `fusionne_vers` sont exclues après contrôle de leurs cibles et
  identités, avec pagination complète. Une personne n’apparaît qu’une fois, même
  avec plusieurs parcours validés ou une reprise de modules une autre année.
  Des localisations confirmées contradictoires pour la même personne provoquent
  une indisponibilité à qualifier, pas un choix arbitraire.

Le croisement initial des présences et du suivi des formations sert à contrôler
le périmètre ; une présence ou une progression à 100 % ne change jamais un
statut. Les reprises de modules de personnes déjà validées ne les déclassent pas.
Le fichier de suivi historique contient des présences plus récentes que la base :
ne pas déduire une validation des seuls calendriers passés ou des séances suivies.

## Géographie

Le référentiel communal et les fonds locaux existants sont réutilisés. Aucun nom
ou contact n’est envoyé à un géocodeur, un fournisseur de tuiles ou un service de
carte tiers. Ville + code postal doivent correspondre exactement. Sans code
postal, une commune unique au nom exact est admise ; les homonymes restent dans
la liste. La notation générique Paris 75000 désigne le centre de Paris, pas un
arrondissement. Les personnes sans localisation restent dans
la liste et les compteurs ; les points proches sont regroupés selon la largeur
réelle de l’écran pour garder des cibles de 44 px accessibles.

Le menu Territoire inclut aussi **Belgique**. L’extension géographique est propre
au réseau des formateurs (`network-territories.ts`) : le référentiel partagé des
établissements reste inchangé. Le fond belge vient de Natural Earth (contour
national simplifié 110m, domaine public), et le centre d’Anvers de Wikidata
Q12892 (CC0). Une localisation belge n’est positionnée qu’après confirmation
explicite, via la configuration privée `place: "BE-11002"`. Le statut du dossier
reste inchangé ; le filtre territoire fonctionne aussi sur la Belgique. Une personne
encore en formation n’y apparaît plus, même si sa localisation a été confirmée.
Seuls les territoires avec des membres localisés figurent dans le sélecteur ;
les résidences sans point restent dans la liste « Tous les territoires ».

La carte ne lit **jamais** les missions ni les communes des établissements : elle
utilise `formateurs.ville` et `formateurs.cp`, ou une correction de résidence
explicitement confirmée. Ces champs peuvent contenir une erreur historique : ne
pas prétendre les avoir tous certifiés. Charlotte a confirmé **Toulouse pour
Candice**, dont la fiche source indique encore Draguignan. L’exception privée
`RESOURCE_NETWORK_RESIDENCES` est indexée par **personne**, sans réécrire sa fiche
ni remplacer les exceptions de parcours
existantes dans `RESOURCE_NETWORK_LOCATIONS`. La résidence confirmée est prioritaire
et s’applique à tous ses parcours validés. Vérifier
sa présence à Toulouse dans l’API après déploiement. Une exception utilisée
uniquement par l’aperçu local ne vaut pas correction de production.

Les couleurs viennent directement des variables de la charte (`--vert`,
`--papier`). Les contours locaux sont intégrés dans le SVG
de la carte avec un fond `--vert-clair` et un trait `--vert` ; les fonds partagés
de la carte des établissements ne sont pas modifiés.

### Localisations confirmées, sans réécrire les fiches

`RESOURCE_NETWORK_LOCATIONS` est une **configuration privée de déploiement**
(secret Cloudflare Pages), jamais une variable publique `[vars]` ni un fichier
versionné avec les identités. Elle associe des Id de **parcours**, pas de personnes,
à un code INSEE de commune, un repère territorial approximatif explicitement
étiqueté, une localité étrangère du référentiel public (`place`) ou une
localisation non cartographiable conservée hors carte (`outside`).

Exemple exclusivement fictif :

```json
{"999001":{"commune":"35238"},"999002":{"territory":"971"},"999003":{"outside":"Ville étrangère, pays"}}
```

Ne jamais remplir cette configuration par déduction. Conserver la confirmation
de Charlotte dans le suivi privé de l’intervention. Avant la publication, poser
la configuration confirmée dans l’environnement concerné et relire la réponse de
l’API après connexion ; les corrections ne sont pas déployées avec le code seul.
Si une fiche est corrigée ultérieurement, retirer son ancienne exception après
contrôle pour ne pas masquer une nouvelle localisation.

## Recette

`bun run test`, `bun run build`, puis
`CHECK_SCREENSHOTS=<dossier-local> bun scripts/check-carte-reseau.mjs`.
Ce dernier contrôle le vrai rendu compilé, l’API privée, l’audience formateur,
le refus anonyme avant toute lecture, la pagination, les filtres, la navigation
clavier, les territoires, le repli après panne et sept largeurs de 320 à 1440 px.
Les données par défaut sont fictives ; aucun appel aux services réels.

`NETWORK_SNAPSHOT=<json-prive-hors-git>` permet une capture locale de relecture
des données réellement lues avec les outils NocoDB (`personnes`, `parcours`,
`locations`). `PREVIEW_PORT=<port>` ouvre ensuite un aperçu sur 127.0.0.1 seulement,
avec bandeau « Aperçu local — non publié » et refus de toute écriture. Ne jamais
publier cette capture ou le serveur de démonstration. Les captures nominatives
restent privées, tout comme le futur annuaire protégé.
