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
un membre `INTERNAL_ADMIN_EMAILS` peut aussi préparer le formulaire pour un compte
formateur explicitement désigné (adresse de connexion, distincte de l'e-mail professionnel) ;
les autres membres de l'équipe ne peuvent ni créer ni valider de convention.
La direction vérifie manuellement le référencement et les missions,
renseigne le représentant, la rémunération du cas 2 et sa décision sur les frais
avant de générer le PDF figé ; le formateur le télécharge,
le signe et le dépose ; la direction vérifie puis dépose le PDF contresigné.
La liste équipe voit les saisies, mais seuls les comptes admin valident et contresignent.
Les formateurs ne voient que leurs conventions ; l'API refuse tout accès sans JWT
Cloudflare Access. Aucune notification ou synchronisation NocoDB n'est déclenchée :
les personnes doivent se prévenir hors de ce circuit. Le catalogue de ressources
reste un répertoire de liens et ne stocke aucun de ces documents.
La page équipe « Catalogue des formulaires » référence la convention dans
« Documents à signer » et permet de copier le lien formateur
`/interne/ressources?convention=1`. Le formateur peut aussi ouvrir le formulaire
depuis « Ressources formateurs », sans passer par le catalogue réservé à l'équipe.
Sa page et son API utilisent les **mêmes deux chemins Cloudflare Access** que le
reste des ressources : `/interne/ressources` et `/api/interne/ressources`, avec
`?convention=1`. Cette application donne accès à l'ensemble des ressources
formateurs, y compris les documents à signer, mais pas aux calendriers ni aux
autres pages internes. La validation EUNEOS conserve son audience équipe sur
`/interne/convention-mission` et `/api/interne/conventions-mission`.
Un lien partagé ne crée pas de compte : l'adresse du formateur doit figurer dans
la liste nominative de l'application « EUNEOS — ressources » ; sa page de connexion
propose un code reçu par e-mail. La liste d'accès est gérée chez Cloudflare,
pas par le champ « adresse du compte formateur » dans la convention.
Ne pas remettre le lien équipe dans les ressources partagées : il exige une
autre audience. L'API des ressources ordinaires reste en lecture seule : seules
ses requêtes portant `?convention=1` acceptent une saisie ou un PDF et appliquent
les contrôles de propriétaire et d'étape. Le rôle de responsable n'est jamais
attribué par l'audience Ressources. Avant de partager le lien, faire ajouter les
adresses choisies à la politique Allow nominative existante, puis tester un
compte formateur autorisé, un non-autorisé et le refus des pages équipe.

Calendrier : chaque établissement reçoit entre 4 et 8 séances datées de 2 h
ou 4 h, pour un total obligatoire de 16 h. L'hybride exige exactement 8 h sur
site et 8 h à distance. Aucun horaire n'est collecté ni imprimé. Les anciennes
saisies de huit séances de 2 h qui contiennent un horaire restent lisibles :
le PDF et toute correction future affichent leurs dates et leurs durées sans
réécrire rétroactivement les documents déjà signés.
À la demande de Candice (15 octobre), l'article 3 généré remplace la phrase
du modèle « 8 sessions d'environ 2 heures » par la répartition des 16 heures
effectivement renseignée ; les autres clauses demeurent celles du modèle.

Chaque PDF est limité à 750 Ko pour rester sous la limite de taille d'une ligne D1.
Un scanner doit produire un PDF léger ; un PDF lourd n'est pas tronqué ni accepté.
L'application contrôle la structure PDF, pas l'authenticité de la signature ni
l'identité de son signataire. Comparer visuellement les versions avant contresignature.
En cas de réponse perdue, relire l'espace avant de recommencer : les transitions
sont conditionnelles et un second dépôt ne remplace pas un document déjà enregistré.

Pour publier : exécuter tests et build, puis les contrôles de pages compilées et
de largeur 390 px ; obtenir l'accord de Candice sur les deux nouvelles tables et
l'aperçu ; suivre les reçus D1 du SHA publié et vérifier le rendu réel.
