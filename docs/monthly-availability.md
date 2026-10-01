# Disponibilités mensuelles de l’équipe

Dans `/interne`, choisir **Équipe & heures**, le mois affiché, puis
**Disponibilités du mois**. Le bouton rouvre la fiche de la personne connectée.
Un responsable peut utiliser la personne sélectionnée dans le filtre si elle
possède déjà une fiche visible dans ce mois. Aucune donnée réelle n’est migrée.

La fiche contient les dates du mois entier et un détail quotidien : sélectionner
les jours de semaine, les matins/après-midi/journées ou un créneau personnalisé,
puis appliquer. Une journée de 7 h exclut la pause de 12 h 30 à 13 h 30.
Chaque date permet de retirer une prévision, choisir d’autres horaires ou saisir
une durée libre. La demi-journée variable se place sur la date réellement prévue.
Les créneaux sont des heures locales, pas des événements convertis en UTC.

Une nouvelle application des jours récurrents remplace **les prévisions et leurs
exceptions** après confirmation ; elle conserve toutes les heures réalisées,
y compris zéro. Les lignes contenant du réalisé restent visibles même si leur
prévision est supprimée. Aucune prévision ne devient automatiquement du réalisé.
Les changements de sélecteurs doivent être appliqués avant l’enregistrement.

## Persistance et compatibilité

- `daily_hours` conserve les dates avec `planned`, `actual` et éventuellement
  `slots` (un ou deux intervalles, validés et ordonnés sans chevauchement).
  Les anciennes lignes sans créneau restent valides. Une durée libre retire
  les créneaux de cette date pour ne pas conserver des horaires contradictoires.
- La répartition hebdomadaire est un outil de préparation, pas une règle qui
  s’exécute en arrière-plan. Les dates résultantes et exceptions sont conservées.
  Il faut choisir une nouvelle répartition pour remplacer les prévisions.
- Le type métier `Disponibilités mensuelles` utilise une clé déterministe issue
  du mois et de l’adresse exacte de la personne. La clé primaire SQL empêche
  les doubles créations même entre onglets ou identifiants de requête différents.
  Une correction utilise toujours l’ID existant et sa version ; un conflit est
  signalé sans écrasement. Le mois, la personne et le type de cette fiche sont fixes.
- Aucun nouveau schéma ni migration D1. Les API existantes, droits d’auteur et
  de responsable, CSRF et contrôle des versions restent applicables.
- Une fiche historique unique couvrant déjà tout le mois est rouverte telle
  quelle. Plusieurs anciennes fiches couvrant ce mois nécessitent une sélection
  explicite ; aucune fusion ou correction des heures historiques n’est devinée.
  Les autres fiches d’activités ponctuelles restent indépendantes : ne pas
  déclarer les mêmes heures réalisées dans deux fiches différentes.

## Vérification locale

`bun test tests/internal-workspace.test.js` vérifie février bissextile, durées,
exceptions, refus des créneaux incohérents, droits, concurrence et modifications
de la même fiche. `bun run build`, puis
`CHECK_SCREENSHOTS=/tmp/euneos-monthly-qa bun scripts/check-internal-workspace.mjs`
exécutent les pages et routes compilées avec une base SQLite en mémoire, des
JWT fictifs et Chromium. Aucun accès aux données réelles ni email.

La recette couvre la création, le refus d’enregistrer des réglages non appliqués,
les exceptions, la réouverture après rechargement, le refus puis l’acceptation du
remplacement des prévisions, la conservation du réalisé et les captures à
390/1440 px. Le même harnais couvre les permissions et le reste du calendrier.
L’utilisation depuis Stella et la recette en production sont hors de ce chantier.
