# Conventions de mission — espace privé

Source contractuelle : export texte du modèle Drive du 15 octobre 2026,
`src/content/convention-mission-modele.txt`. La génération conserve les quatorze
articles, remplace les tableaux vierges par les missions contrôlées et supprime
les anciennes consignes d'échange de PDF par e-mail. Toute modification du modèle
doit être revue avant de modifier la génération. La signature dessinée dans un PDF
n'est pas une signature électronique qualifiée ; aucun dossier de preuve n'est produit.

La migration additive `0009_conventions_mission.sql` ajoute uniquement deux tables
dans `TEAM_WORKSPACE` : `mission_conventions` (saisies, propriétaire, étapes et
vérification) et `mission_convention_files` (trois PDF privés, leurs empreintes SHA-256).
Elle ne modifie aucune table ni ligne existante. Les migrations passent uniquement
par le workflow documenté dans `docs/internal-migrations.md`, jamais à la main.

Parcours : un compte Cloudflare Access formateur soumet puis peut corriger sur demande ;
un membre `INTERNAL_ADMIN_EMAILS` vérifie manuellement le référencement et les missions,
renseigne le représentant, la rémunération du cas 2 et sa décision sur les frais
avant de générer le PDF figé ; le formateur le télécharge,
le signe et le dépose ; la direction vérifie puis dépose le PDF contresigné.
La liste équipe voit les saisies, mais seuls les comptes admin valident et contresignent.
Les formateurs ne voient que leurs conventions ; l'API refuse tout accès sans JWT
Cloudflare Access. Aucune notification ou synchronisation NocoDB n'est déclenchée :
les personnes doivent se prévenir hors de ce circuit. Le catalogue de ressources
reste un répertoire de liens et ne stocke aucun de ces documents.

Chaque PDF est limité à 750 Ko pour rester sous la limite de taille d'une ligne D1.
Un scanner doit produire un PDF léger ; un PDF lourd n'est pas tronqué ni accepté.
L'application contrôle la structure PDF, pas l'authenticité de la signature ni
l'identité de son signataire. Comparer visuellement les versions avant contresignature.
En cas de réponse perdue, relire l'espace avant de recommencer : les transitions
sont conditionnelles et un second dépôt ne remplace pas un document déjà enregistré.

Pour publier : exécuter tests et build, puis les contrôles de pages compilées et
de largeur 390 px ; obtenir l'accord de Candice sur les deux nouvelles tables et
l'aperçu ; suivre les reçus D1 du SHA publié et vérifier le rendu réel.
