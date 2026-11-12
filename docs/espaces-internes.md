# Espaces internes EUNEOS

Le portail `/interne` propose Équipe, Organisation, Communication et CA. Les
contrôles d’accès des pages restent côté serveur. Le retour du CA vers le portail
accepte les identités CA, sans leur donner accès aux espaces équipe.

Équipe utilise `/interne/equipe`, `/interne/equipeheures` et l’URL existante
`/interne/organisation-equipe`. Communication possède son calendrier éditorial à
`/interne/communication/calendriereditorial`. Les calendriers partagent l’API et
les données existantes ; aucune copie ni migration de leurs fiches n’est nécessaire.
Organisation conserve les URL de ses anciens outils. CA conserve `/interne/ca`.

## Tableaux Communication

Les trois sources XLSX sont des données privées, jamais du code ni des consignes.
Les migrations 0019–0023 ajoutent les tables, les compteurs de statut, les liens
entre personnes et un reçu technique d’import, sans toucher aux calendriers ni
aux formulaires existants. La migration 0018 de la carte publique reste intacte.

Partenariats comporte six vues par feuille et un seul tableau visible à la fois.
La première s’appelle TOP 10 ; le mode d’emploi n’est pas affiché. Recherche et
filtres portent sur la vue active. Toutes les feuilles proposent Statut.

Les cinq statuts initiaux sont À contacter, En attente de réponse, À relancer, Annulé et
Accepté. Après vingt jours d’attente, la lecture retourne À relancer. Le compteur
démarre au changement de statut et n’est pas remis à zéro par une note. Le tableau
visible s’actualise chaque minute, hors édition. Dans Partenariats le statut teinte
la ligne sauf Priorité : A orange #ffe0cc, B rose #f3c8ef, C jaune #f5d76e.
Les champs catégoriels sont des sélecteurs dont les valeurs se gèrent directement
dans chaque menu, y compris les statuts. Les modifications de menu sont enregistrées
immédiatement et deviennent disponibles pour toute l’équipe, indépendamment de la fiche.

Les fiches de personnes présentes dans plusieurs feuilles sont liées par leur Nom
lors de l’import initial. La synchronisation porte sur les champs communs et
incrémente les versions des fiches concernées, dans la même opération D1. Les liens
restent stables lorsque le nom change. Les autres structures et listes distinctes
restent séparées. Les versions bloquent une écriture périmée ; les créations
identiques peuvent être rejouées sans doublon. Aucun nouvel envoi automatique après
un échec n’est effectué par le navigateur.

## Import privé initial

Le secret GitHub temporaire `EUNEOS_COMMUNICATION_SEED` contient une source gzip
encodée en base64. Il ne contient que les trois nouveaux tableaux Communication,
pas les copies locales de calendriers, candidatures, CA ou ressources existantes.
Aucun contenu de contact ne figure dans le dépôt ni dans un artifact CI.
`scripts/lib/communication-seed.json` ne contient que l’empreinte SHA256 et les
nombres de feuilles, fiches et liens de la source validée.

Le workflow Deploiement migre la preview, importe et vérifie les sources, puis
publie la preview. Il migre ensuite la production, importe et vérifie les mêmes
sources, puis publie Pages. L’import est réservé au workflow autorisé et aux cibles
TEAM_WORKSPACE fixes. Il n’écrase aucune fiche existante : une reprise partielle
exige des données identiques ; un reçu déjà présent évite toute réimportation et
préserve les modifications ultérieures. Sans source ni reçu, le déploiement échoue
pour éviter d’annoncer des tableaux vides. Après les deux imports vérifiés, supprimer
le secret temporaire ; les déploiements suivants utilisent les reçus.

Les données sont transmises à D1 par paramètres HTTP. Les logs et erreurs de
l’import ne contiennent ni SQL, ni paramètres, ni données des fiches, ni clés.
L’environnement reçoit un point Time Travel avant les migrations via le circuit
existant décrit dans `internal-migrations.md`. Ne jamais rejouer l’historique ou
restaurer automatiquement une base après un échec.

## Vérification

Les tests unitaires Communication couvrent validation, concurrence, délai de vingt
jours, compteurs, synchronisation et reprise de l’import. La recette compilée
`check-internal-workspace.mjs` vérifie également les droits, le statut enregistré,
les couleurs, la synchronisation entre vues et le mobile avec des données fictives.
Le contrôle D1 local vérifie les nouvelles migrations et leurs triggers. Les tests
publics de layout, rythme et responsive restent obligatoires avant publication.

## Menus modifiables et sélection multiple

Les migrations 0024 et 0025 ajoutent le registre des choix et la corbeille.
Chaque menu catégoriel, dans les filtres et les fiches, permet d’ajouter, renommer
ou retirer une valeur. Les statuts sont communs à Médias et Partenariats. Les
autres choix appartiennent au tableau et à leur colonne. Les libellés ont des
identités stables et des alias : les fiches existantes affichent le nouveau nom
sans réécriture de leurs cellules privées ; un renommage conserve la couleur et
le compteur de relance. Les versions des choix empêchent les modifications
concurrentes. Une valeur retirée est masquée, pas détruite ; l’ajouter à nouveau
la rétablit. Les couleurs et le délai de vingt jours suivent les rôles des
valeurs initiales, même renommées. Les nouvelles valeurs n’acquièrent pas de
couleur ou d’automatisation par simple ressemblance de nom.

La première colonne contient les cases de sélection. La case d’en-tête cible
toutes les lignes visibles après recherche et filtres dans la vue active.
Une nouvelle recherche ou vue efface la sélection ; aucun rafraîchissement
automatique ne l’interrompt. Dupliquer crée des lignes indépendantes dans la
même feuille. Supprimer nécessite une confirmation puis déplace uniquement les
lignes choisies dans une corbeille récupérable. Restaurer conserve les données.
Les opérations groupées vérifient la collection, l’autorisation, l’origine et les
versions de toutes les lignes. Une sélection périmée échoue sans action partielle.
Aucune nouvelle importation des XLSX n’est effectuée : les modifications faites
sur le site depuis la publication initiale sont conservées.

### Attribution et déplacements Communication

Suivi médias et Partenariats proposent une attribution à Charlotte, Candice ou
Pauline, directement dans le tableau ou la fiche. Une attribution crée une tâche
« En cours » dans Organisation équipe ; la réattribution reprend la même tâche.
Les fiches de partenariat liées entre plusieurs vues partagent cette tâche.
Une modification des notes ne recrée pas de tâche.

Le tableau montre cinq fiches complètes avant défilement ; les aperçus de texte montrent cinq lignes. Dans Parrainage, le filtre Priorité A
remplace l’ancienne vue TOP 10. TOP 10 et Qui parraine quoi sont retirées de
l’interface ; les données source restent archivées. La migration remplit les
statuts vides avec « À contacter », sans remplacer les statuts renseignés.

La sélection de lignes propose Déplacer, avec le choix d’un autre tableau puis
d’une feuille. Les colonnes communes sont reprises ; le nom et le lien sont
rapprochés lorsque leurs intitulés diffèrent. Les autres champs sont conservés
dans Notes, avec leurs libellés. Un historique privé conserve aussi les valeurs
source. Une fiche déplacée sort de sa feuille de départ et devient indépendante
des anciennes vues liées. Les versions sont contrôlées pour l’ensemble du lot :
si une ligne a changé, aucune n’est déplacée. Un déplacement qui produirait des
notes de plus de 10 000 caractères est refusé sans modification.
