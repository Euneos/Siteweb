# Espace CA — vue de gouvernance

## Visuels de déploiement — préparation du 9 novembre 2026

Les deux images sont servies par `/api/interne/ca?visual=1` et `?visual=2`, après
le même contrôle d’identité que la synthèse, avec les en-têtes privés `no-store`.
Le stockage prévu est Workers KV, binding `CA_VISUALS`, clés
`deploiement-2026-11-07-1` et `deploiement-2026-11-07-2`, contenu WebP.
Les fichiers sources et images restent hors du dépôt public et des assets publics.

Le 10 novembre, le namespace privé approuvé par Candice a été créé et les deux
images téléversées puis relues, avec comparaison SHA-256 aux originaux locaux.
Le binding de production est déclaré dans `wrangler.toml`. Les previews n’ont
aucun binding vers ces images privées ; utiliser des images fictives en recette.
Après publication, vérifier les images derrière l’accès CA.
Sans binding ou si une image manque, l’API renvoie 503, jamais une image publique.

L’aperçu local accepte `BOARD_VISUALS_DIR` (fichiers `visuel-1.webp` et
`visuel-2.webp`) ; ce répertoire ne doit pas être versionné.

Les actualités de novembre reprennent la fiche de mission du comité scientifique :
ses cinq missions sont synthétisées en quatre axes en regroupant constitution et
animation. La phase 1 concerne la constitution et l’installation du comité.

## Périmètre convenu avec Candice

`/interne/ca` et `/api/interne/ca` : synthèse visuelle en lecture seule, objectif de
30 établissements pour 2026–2027, répartition des cinq décisions de candidature,
cartes métropole/Corse et cinq DROM, états de formation saisis, prochaines dates
de début, formateurs rattachés et demandes d’évaluation. Catalogue pédagogique
publié consultable dans cette page, sans donner accès au circuit des conventions.

Identité visuelle demandée : dominante jaune doux, accents jaunes et repères vert
foncé, réservée à cette page via des variables locales. Les autres espaces ne
changent pas de couleur.

Les notes, coordonnées des personnes, dossiers formateurs, signatures, montants
individuels, calendriers personnels et heures ne sont jamais envoyés à ce client.
Pas de formulaire ni d’API d’écriture : les méthodes hors GET sont refusées.
Les liens externes ne donnent pas de nouveaux droits Drive/Canva.

## Trois audiences séparées, comme pour les ressources

| Identité | CA | Équipe / dossiers / heures | Ressources et propre convention |
|---|---|---|---|
| Équipe autorisée | Oui | Droits existants | Droits existants |
| CA uniquement | Oui, lecture seule | Non | Non (catalogue publié inclus dans la vue CA) |
| Formateur uniquement | Non | Non | Droits existants |
| Visiteur / simple en-tête email | Non | Non | Non |

Créer une **troisième application Cloudflare Access** avec une nouvelle audience,
une liste nominative des adresses validées par Candice et le code à usage unique
par e-mail. Ne pas ajouter ces adresses dans l’application équipe ou formateurs.
Inclure l’équipe dans la politique CA si elle doit passer la protection edge CA.

Chemins exacts : `/interne/ca`, `/interne/ca/`, `/api/interne/ca`,
`/api/interne/ca/`. Les règles spécifiques gagnent sur `/interne/*` et
`/api/interne/*`. Couvrir chaque domaine/alias de production et de préversion
utilisé ; jamais de bypass public. La vérification JWT à l’origine protège
également les accès directs `pages.dev`.

Configurer `BOARD_ACCESS_DOMAIN` et `BOARD_ACCESS_AUD` côté serveur dans les deux
environnements. Le domaine est de type `xxx.cloudflareaccess.com`, sans protocole.
L’audience doit être différente de `INTERNAL_ACCESS_AUD` et `RESOURCE_ACCESS_AUD`.
Le code refuse une configuration réutilisant une de ces audiences. Ne jamais
versionner les emails réels ou les jetons. Les audiences existantes ne changent pas.

Le CA n’est pas ajouté à `getInternalContext` : les API opérationnelles ne peuvent
donc pas hériter de ses permissions. Aucun paramètre `convention=1`, aucune URL
de dossier et aucune identité administrateur ne sont exposés par la vue CA.

## Sources et limites

### Correction demandée par Candice le 5 novembre

Précision ultérieure : **tout suivi du projet reste sur 2026–2027**. Le sélecteur
d’année agit exclusivement sur la carte établissements ; les anciens établissements
restent visibles sur les cartes. La carte des formateurs conserve toutes les promotions
validées, une fois par identifiant, avec commune et promotion uniquement.

Le champ privé optionnel `review` du rapport contient les vérifications ultérieures,
datées séparément : effectif minimum recensé/prévu, limites du périmètre candidatures,
état de l’évaluation. Les personnes retirées sont exclues ; les personnes simplement
déclarées hors import restent distinguées. Ne pas assimiler les fiches établissements
historiques à des candidatures de la campagne actuelle. Les détails réels et les exports
restent hors dépôt. Le comité scientifique et la chargée de conception restent à recruter.

Le CA peut suggérer des parrainages et des contacts dans un établissement identifié ;
l’organisation des projections appartient à l’opérationnel. Les liens Drive gardent
leurs droits existants. Le catalogue est consultable dans la vue CA et un lien permanent
ouvre les supports de formation, sans donner accès aux conventions de la bibliothèque.
L’aperçu utilise une sélection de liens réels vérifiés, distincte du catalogue D1 complet.

La vue commence désormais par le **point d’étape validé du 3 novembre**, fourni
par Candice, avec les candidatures bien mises en avant. Il est injecté côté serveur
par le secret `BOARD_PROGRESS_REPORT` (JSON validé par `board-report.ts`). Le
document et ses données nominatives ne sont pas versionnés dans le dépôt public.
Le calendrier conserve la date de référence du rapport : un démarrage annoncé
ne devient pas automatiquement une réalisation après passage de sa date.

Les actualités « En développement » sont également fournies par Candice dans ce
JSON. Les partenariats restent présentés comme des échanges en cours. La section
« Vous investir dans EUNEOS » propose des exemples d’actions au CA, sans engager
l’association. Le contenu daté est à renouveler lors du prochain point validé.

La vue complémentaire de la base inclut **2025–2026 et 2026–2027**, avec un
sélecteur d’année. Les établissements présents les deux années sont dédoublonnés
dans le cumul. Les alertes documentaires et candidatures anciennes portent sur
la campagne actuelle ; les archives de la précédente année ne deviennent pas
des blocages actuels.

Le réseau de formateurs est désormais calculé sur les **statuts et promotions**,
toutes années comprises. Les parcours validés sans cohorte sont inclus : en base,
les cohortes d’établissements ne constituent pas le périmètre du réseau formateur.
« Formateur validé », « Formateur en cours de validation » et « En cours de
formation » sont comptés séparément, par personne distincte. Refus, abandons et
simples candidatures ne sont pas assimilés à des formateurs validés.

L’aperçu de validation doit utiliser le rapport et un export réel daté obtenu par
les outils NocoDB : `scripts/preview-board-dashboard.mjs`, avec
`BOARD_SNAPSHOT_FILE`, `BOARD_REPORT_FILE` et `CHECK_SCREENSHOTS` pointant hors du
dépôt. Ce serveur n’écoute que sur `127.0.0.1` et ne remplace pas Cloudflare Access.
Les tests automatisés conservent leurs jeux fictifs ; leurs captures ne doivent
plus être présentées comme l’aperçu métier à valider.

- Cohortes explicites 2025–2026 et 2026–2027. Objectif 30 propre à 2026–2027,
  distinct du cumul historique et des candidatures reçues.
- Pagination complète et rapprochement des archives par le lecteur existant.
  Les `fusionne_vers` non vides sont exclus après vérification du dossier cible.
- Nombre d’établissements engagés distincts (id établissement) pour l’objectif ;
  barres par dossier courant. Dossiers engagés multiples ou orphelins signalés.
- Début passé ≠ formation réalisée. La page affiche séparément le statut de
  formation saisi et les dates. Dates invalides = information à préciser.
- Évaluation : `evaluation_jeunes_demandee` explicitement affirmative (`Oui` ou case cochée).
  Ne pas présenter le reste comme des refus ou les demandes comme des résultats.
- Formateurs : personnes distinctes selon le statut et la promotion, y compris
  sans cohorte. Les archives sont exclues. Un accord de parcours n’est pas une
  convention de mission signée.
- Points d’attention calculés, sans prétendre restituer des arbitrages rédigés
  par la direction. Pas de faux historique « avancées du mois » : aucun journal
  comparatif fiable n’est actuellement branché à cette vue.
- Catalogue publié lu dans D1. Son indisponibilité est distinguée d’un catalogue
  vide. Échec de lecture NocoDB : pas de totaux partiels ni de cache ancien affiché.
- Aucune migration de base, aucune écriture NocoDB, aucun envoi d’e-mail.

## Recette et activation

`bun run test`, `bun run build`, puis `bun scripts/check-board-dashboard.mjs`
(page compilée, données et identités fictives, cartes locales, largeurs mobiles et
ordinateur, refus des autres audiences et des écritures). Les captures portent
explicitement la mention de données fictives. Vérifier aussi les contrôles de
mise en page habituels après compilation.

Avant activation : montrer les captures à Candice et obtenir son accord de
publication ; obtenir les adresses nominatives du CA. Après configuration :
relire la politique Cloudflare et ses chemins, vérifier avec des comptes CA,
équipe et formateur les pages **et** les API, y compris les variantes avec slash
et les domaines directs. Ne pas annoncer d’accès ouvert tant que cette recette
et le déploiement ne sont pas confirmés.

## Note à Charly

Candice souhaite une vue de gouvernance synthétique et visuelle et un périmètre
analogue à celui des formateurs. Choix : une projection serveur distincte, une
troisième audience et une page autonome, plutôt qu’un accès aux pages métiers.
Les cartes réutilisent les fonds et le référentiel local existants. Les données
restent calculées à la lecture ; les états inconnus ne deviennent pas des zéros
de réalisation. Pour une autre cohorte, revoir explicitement l’objectif et les
filtres, sans modifier silencieusement les compteurs de cette campagne.
