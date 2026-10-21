# Conventions de mission — espace privé

Source contractuelle : export texte du modèle Drive modifié le 15 octobre 2026 à 14 h 24 UTC,
`src/content/convention-mission-modele.txt`. La génération conserve les quatorze
articles, remplace les tableaux vierges par les missions contrôlées et supprime
les anciennes consignes d'échange de PDF par e-mail. Toute modification du modèle
doit être revue avant de modifier la génération. La signature dessinée dans un PDF
n'est pas une signature électronique qualifiée ; aucun dossier de preuve n'est produit.
Le Word source n'est pas lié depuis le formulaire partagé : le formateur relit
les 14 articles dans le PDF finalisé avant signature. Sa permission Drive
« toute personne avec le lien » est actuellement **lecteur** ; seuls le propriétaire
et les rédacteurs nommément autorisés peuvent modifier. Retirer le lien du site
ne change pas cette permission.

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
Cloudflare Access. Les nouvelles soumissions (dont corrections resoumises) et les
PDF signés déposés par les formateurs déclenchent une alerte à `euneosequipe@gmail.com`.
Le catalogue de ressources
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

Calendrier : chaque formation reçoit des séances datées de durée libre positive
(3 h, 1,5 h, 2 h, 4 h, etc.). Le parcours choisi impose 16 h pour la formation adultes,
ou 8 h pour la formation à l’animation des ateliers jeunes en année 2 (décision
Candice du 19 octobre). Les anciennes conventions sans volume restent à 16 h.
Le parcours de 8 h n'entraîne pas automatiquement le forfait de 1 000 € : sa
rémunération est renseignée par la direction dans le montant complémentaire validé,
avec le cas 2 éventuel. Le PDF identifie le parcours et son calendrier à l'article 3.
La borne technique est de 1 à 64 séances. Plusieurs groupes dans un même établissement
ont des blocs distincts, identifiés par établissement + groupe, repris dans le PDF.
L'hybride comprend au moins une
séance sur site et une à distance ; la proportion 8 h / 8 h est un exemple,
pas une obligation. Aucun horaire n'est collecté ni imprimé. Les anciennes
saisies de huit séances de 2 h qui contiennent un horaire restent lisibles :
le PDF et toute correction future affichent leurs dates et leurs durées sans
réécrire rétroactivement les documents déjà signés.
Le PDF reprend l'article 3 du modèle Drive actualisé et détaille la répartition
effective. Le modèle nomme Candice Marro, Directrice Générale, comme représentante ;
ces deux champs sont proposés séparément et restent à confirmer par EUNEOS lors
de la validation de chaque convention. L'article 1
inclut les coordonnées, codes, mention ESS et dates institutionnelles du modèle.
La fiche récapitulative figure à nouveau après les 14 articles ; seules les
dates et signatures du formateur et d'EUNEOS restent à remplir. Le visa / tampon
facultatif de l'établissement, encore présent dans le Word source, est supprimé
du PDF généré à la demande de Candice (16 octobre) : l'établissement n'est pas
partie à cette convention.
Le générateur utilise une taille de corps homogène, des titres séparés, des
listes aérées et des sauts de page qui évitent un titre isolé en bas de page.
Les PDF déjà approuvés ne sont pas régénérés automatiquement : l'essai approuvé
le 15 octobre reste inchangé et n'est pas supprimé.

Chaque PDF est limité à 750 Ko pour rester sous la limite de taille d'une ligne D1.

### Financement extérieur — décision Candice du 20 octobre 2026

Chaque mission peut déclarer `financement: externe` et son `financeur`. Dans ce cas,
le volume horaire est libre et positif (borne technique 1 024 h, 64 séances de 16 h maximum),
et le calendrier doit correspondre à ce volume lors de la soumission. Le forfait de
formation à payer par EUNEOS est nul, y compris pour un volume de 8 h. Les cas 1/2 et
les frais restent distincts. Le récapitulatif et le PDF explicitent le financeur et
le montant nul ; les anciens dossiers sans ce champ conservent `euneos` et leur tarif.
Le cas confirmé est deux formations de 18 h financées par un organisme académique,
avec seuls deux forfaits ateliers élèves à 200 € à la charge d’EUNEOS ; les frais
d’impression restent une demande à examiner. Aucune donnée métier n'est migrée.
La confirmation de sauvegarde distingue désormais le brouillon de la soumission ;
elle ne prétend plus qu'il manque des informations sans les avoir contrôlées.

### Brouillons à compléter — décision Candice du 19 octobre 2026

La migration additive `0012_mission_convention_drafts.sql` crée une table privée,
sans réécrire les conventions existantes. La direction peut préparer un brouillon
pour une adresse autorisée ; le formateur ne voit que ses brouillons. Les données
manquantes, dates, durées et choix (frais, cas 1/2) restent vides. Une note visible
conserve la provenance et les points à confirmer. La sauvegarde accepte l'incomplet,
mais vérifie les types et les bornes ; la soumission exige le formulaire complet et
le volume de 8 h ou 16 h choisi. Les corrections d'une convention soumise suivent le circuit existant.
La révision empêche l'écrasement d'une modification concurrente. La soumission du
brouillon et la création de la convention partagent une transaction et un identifiant,
sans effacement du brouillon source ni double création après une réponse perdue.

### Notifications — décision Candice du 21 octobre 2026

La migration additive `0013_mission_convention_notifications.sql` crée un registre
privé et trois triggers : soumission initiale, resoumission après correction,
dépôt `trainer_signed`. L'événement partage la transaction de la donnée métier.
Les brouillons, validations PDF et dépôts contresignés n'envoient pas cette alerte
de demande de vérification ; aucun événement historique n'est rejoué.

Brevo reçoit un mail texte destiné exclusivement à `euneosequipe@gmail.com`, avec
le nom du formateur, les établissements et le lien privé vers la convention.
Aucun PDF ni donnée bancaire n'est joint. Le destinataire n'est pas choisi côté client.
L'adresse destinataire du mail ne reçoit aucun droit d'accès supplémentaire.
Seuls `euneos.fr` et `www.euneos.fr`, hors `INTERNAL_WORKSPACE_PREVIEW`, peuvent envoyer.
Le statut `sent` signifie accepté par le service d'envoi, pas livré dans la boîte.

L'événement est réclamé une seule fois avant transport ; une erreur réseau laisse
`uncertain`, sans renvoi automatique. Un arrêt pendant l'envoi peut laisser `sending` :
vérifier Brevo et la boîte avant toute intervention. Un événement resté `pending`
avant réclamation sera traité lors d'une prochaine action notificatrice sur la même
convention. Pas de tâche planifiée de reprise. Une panne de notification ne remet pas
en cause la réception du document ; l'écran montre séparément son état d'envoi.
Le bandeau équipe indique si l'envoi est configuré, et chaque convention affiche
le reçu de sa dernière alerte. Les tests de transport sont simulés, sans e-mail réel.

### Préparation de la vérification et anciens brouillons — 21 octobre 2026

La même migration additive 0013 ajoute `fees_euros`, nullable pour les anciens
documents. La direction retrouve la demande de frais dans le texte de vérification.
Un montant unique explicitement suivi de « € » ou « euros » est proposé, jamais
autorisé automatiquement ; les barèmes ou montants multiples restent à renseigner.
Les forfaits ateliers sont calculés séparément du complément cas 2, qui est masqué
quand il n'est pas applicable. Le total préparé affiche prestations + frais retenus.
`save-review` conserve les champs préparés en laissant l'état `submitted` ;
`approve` exige la décision, le montant/plafond et les détails, puis fige le PDF.
Les deux actions comparent `updated_at` pour refuser un écrasement concurrent.
Le PDF contient aussi le montant/plafond des frais et le total prévisionnel avec frais.
La resoumission après correction efface l'ancienne décision financière à revérifier.

`supersede-draft`, réservé à la direction, rattache un ancien brouillon à une
convention existante du même compte via `submitted_id`, avec contrôle de révision.
Son contenu est conservé, une note précise qu'il ne s'agit pas d'une nouvelle soumission.
Il disparaît des brouillons actifs. Aucune correspondance de noms ni fusion automatique.
Un scanner doit produire un PDF léger ; un PDF lourd n'est pas tronqué ni accepté.
L'application contrôle la structure PDF, pas l'authenticité de la signature ni
l'identité de son signataire. Comparer visuellement les versions avant contresignature.
En cas de réponse perdue, relire l'espace avant de recommencer : les transitions
sont conditionnelles et un second dépôt ne remplace pas un document déjà enregistré.

Pour publier : exécuter tests et build, puis les contrôles de pages compilées et
de largeur 390 px ; obtenir l'accord de Candice sur les deux nouvelles tables et
l'aperçu ; suivre les reçus D1 du SHA publié et vérifier le rendu réel.
