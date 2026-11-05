# Carte des établissements formés

La page équipe `/etat-candidatures#carte-etablissements` contient la carte
immédiatement avant `#suivi`. Le tableau reste limité à sa cohorte courante ;
la carte lit indépendamment toutes les cohortes.

`GET /api/interne/implantations?formes=1` exige l’identité **équipe**, avant toute
lecture NocoDB. Un accès formateur Ressources ne suffit pas. Cache privé sans
stockage, champs limités aux noms, communes, cohortes et identifiants dossiers.
Aucune écriture, géolocalisation externe ni adresse de rue.

Le filtre d’état de formation est indépendant de la cohorte :
- `Terminé` → Formation terminée ;
- `En cours` → Formation en cours ;
- `Programmée` → Formation programmée (catégorie distincte) ;
- `À préciser`, `Prévisionnelle`, ou statut vide **et** dates début/fin absentes
  → Formation à programmer, selon la confirmation de Charlotte du 5 novembre.

Les décisions Refus et Abandon sont exclues. Un statut inconnu, ou vide avec des
dates déjà renseignées, n’est pas requalifié par supposition. Aucun champ n’est
écrit. Engagement, dates passées, bilan et effectif ne prouvent pas la fin de
formation des adultes, qui ne signifie pas non plus la fin des ateliers élèves.
Les archives sont réconciliées **avant** le filtrage. Les états sont conservés
par dossier lorsqu’un établissement a plusieurs dossiers de la même cohorte ;
le filtre garde uniquement les dossiers concernés dans les détails.

Une entrée par établissement et cohorte, dossiers regroupés dans une même cohorte ;
un établissement revenant dans une autre cohorte figure dans les deux. Les compteurs
globaux décrivent donc des participations par cohorte, pas un cumul d’établissements
uniques. Cohortes vides conservées dans le filtre. Les couleurs indiquent l’état
de formation, pas la cohorte : terminée en vert, en cours en orange, à programmer
en jaune, programmée en rose. La légende nomme ces quatre états. Les repères
regroupant plusieurs états ont une pastille multicolore ; filtrer sur un état
ne conserve que sa couleur. Les détails associent couleur, libellé et dossier.
Une commune ambiguë ou une cohorte inconnue reste dans la liste,
sans coordonnées inventées. Le référentiel géographique est local au site.

Le composant `CarteEtablissements` et son script sont distincts de la carte
formateurs pour préserver ses règles propres (sans cohortes, par résidence).
Seuls le regroupement géographique générique et les fonds sont partagés.
L’API et ses permissions restent distinctes. Aucun élargissement des droits Ressources.

Vérification après `bun run build` :

```
CHECK_SCREENSHOTS=<dossier-prive> bun scripts/check-carte-etablissements.mjs
CHECK_SCREENSHOTS=<dossier-prive> bun scripts/check-carte-reseau.mjs
```

Le premier contrôle couvre l’accès équipe / refus Ressources, la pagination,
l’indisponibilité, le placement avant le tableau, les filtres (cohorte vide incluse),
les couleurs, le clavier et sept largeurs entre 320 et 1440 px.
`SCHOOL_SNAPSHOT` accepte une capture privée des trois tableaux NocoDB pour un
aperçu réel de la carte ; le tableau de suivi de cet aperçu reste fictif et signalé.
`PREVIEW_PORT` sert cet aperçu en lecture seule, sur 127.0.0.1 uniquement.
