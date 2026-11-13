# Veille thématique EUNEOS

Publication autorisée par Pauline le 13 novembre 2026. Aucun post, email ni contact envoyé.
Base : dernier `origin/main` cloné le 13 novembre. Le dossier de travail initial, qui contenait
plusieurs modifications en cours, n’a pas été touché.

## Parcours proposé

Sous-page `/interne/communication/veille` dans l’espace Communication, avec le même accès
équipe Cloudflare Access et les mêmes protections `no-store` que les autres pages internes.
En-tête vert, semaine sélectionnable, filtres par thème, usage, provenance, source et statut,
recherche textuelle et liste unique des sujets. Les catégories se croisent avec ET ; un
seul choix actif par catégorie. Le statut est filtré sur l’usage choisi quand ce filtre existe.
Les textes s’affichent comme du texte, jamais comme du HTML fourni par une source.

Chaque usage a son statut indépendant : à faire → brouillon → fait → abandonné → à faire.
Son bouton fait avancer le statut d’un clic. Le formulaire permet de choisir directement
le statut, de rédiger le brouillon, d’ajouter ou retirer un usage. Aucun usage ne déclenche
de publication ou d’envoi. Sans usage, une fiche reste à traiter. Les fiches utilisées restent à leur place dans la liste : titre barré, niveaux de gris et opacité de 45 %. Seule une suppression les retire. Le filtre de statut revient à Tous après un changement de statut pour conserver la fiche visible.

L’ajout et la modification utilisent l’identité serveur vérifiée. La provenance initiale et
l’auteur sont conservés comme métadonnées d’audit ; les autres champs sont modifiables.
Toute action humaine protège la fiche. Les imports sont volontairement limités à l’ajout :
ils ne réécrivent aucune fiche existante, même si elle n’a pas été retouchée. Les changements
concurrents produisent un conflit et préservent la saisie dans le formulaire.
Les anciennes URL et titres restent des clés après modification ou suppression ; ils ne
peuvent pas revenir dans un import. Les URL sont normalisées sans les paramètres de suivi.
Une reformulation associée à une nouvelle URL doit aussi être dédupliquée par lecture du
registre avant import : la détection automatique n’est pas une comparaison sémantique.

Les ressources de l’ancien tableau sont intégrées aux fiches par 0030. Chaque ligne, sa version,
son auteur technique, ses dates, ses notes et son éventuelle suppression restent archivés
intégralement dans thematic_watch_legacy et dans le détail de la fiche. Aucune synthèse de
contenu non lu n’est inventée. Les fiches reprises sont protégées, signalées à relire et sans
statut d’usage inventé. Toutes les semaines sont visibles par défaut. Le tableau est retiré,
son ancienne URL redirige vers les fiches et son API renvoie 410 pour empêcher de nouvelles
saisies dans un outil abandonné. Les tables sources restent archivées, sans interface distincte.
Le brouillon utilise une copie locale du 12 novembre, contenant quatre ressources ; 0030 lira
les lignes réellement présentes lors du déploiement.

## Agenda

L’usage Événement reste une piste de travail. La veille ne propose plus de bouton d’ajout
à l’agenda ni de formulaire d’événement et ne crée aucun rendez-vous lors d’une sauvegarde.
Les événements déjà présents dans l’agenda sont conservés.

## Recherche hebdomadaire

Rythme demandé : lundi à 12 h, Europe/Paris, heure locale y compris après changement d’heure.
Automatisation Codex attachée à ce chat : `euneos-veille-th-matique-du-lundi`.
Elle recherche les sujets, relit le registre distant puis ajoute uniquement des fiches nouvelles
par le transport chiffré décrit ci-dessous. Les accès indisponibles sont signalés.
Le bouton « Lancer une recherche » ouvre une demande prête à copier dans la conversation
avec l’agent. Il indique explicitement qu’il n’exécute pas de recherche en arrière-plan.
Ce parcours permet un lancement manuel sans simuler un moteur de recherche côté serveur.

La sélection initiale vit dans `drafts/veille-2026-11-09.json` : sept sujets sourcés et deux
propositions de textes. Elle est chargée uniquement dans la base locale de prévisualisation,
jamais à l’ouverture d’une page ou dans une migration de production.

### Collecte et sélection à chaque passage de l’agent

1. Relire les fiches existantes, y compris celles supprimées, les alias et les statuts avant
   toute proposition. Ne jamais modifier une fiche manuelle/retouchée ni reproposer un sujet
   supprimé. Éviter aussi les doublons de sujets couverts par plusieurs médias.
2. Chercher le cœur et les voisins des sept thèmes :
   - santé mentale : jeunes, prévention, Grande cause nationale, souffrance psychique à l’école,
     sommeil, anxiété, phobie scolaire, santé mentale des enseignants ;
   - CPS : stratégie nationale 2022–2037, programmes probants, climat scolaire, coopération,
     estime de soi, esprit critique ;
   - numérique : écrans, réseaux sociaux, IA générative, cyberharcèlement, attention, régulation,
     politiques France/UE, éducation aux médias ;
   - jeunes : enquêtes sur les 11–18 ans, parole, inégalités, engagement, sport et santé mentale ;
   - éducation : formation, politiques, décrochage, harcèlement/pHARe, familles, pédagogies ;
   - relations sociales : vie de classe, conflits, coopération, médiation, relations jeunes-adultes ;
   - émotions : régulation, stress, stress numérique, attention.
3. Consulter LinkedIn (pages et personnes suivies par EUNEOS, si la session le permet), Gmail
   `label:Newsletters` sur la fenêtre et le web. Ne pas prétendre avoir lu un flux inaccessible.
   Ne pas recopier d’emails privés ni de liens de désinscription dans les fiches.
4. Privilégier ministères, DEPP, SPF, HAS, Inserm, CNRS, OMS, UNICEF, OCDE, Commission européenne,
   Assemblée/Sénat, universités/laboratoires, recherches originales, The Conversation, presse
   nationale et éducative reconnue et acteurs du secteur identifiés. Exclure publicités,
   contenus sponsorisés, développement personnel, blogs non sourcés et alarmisme sans recul.
5. Lire le contenu complet accessible avant de résumer. Une notice peut être résumée comme
   notice ; ne pas lui attribuer les conclusions d’un rapport non lu. Signaler les limites de
   consultation et remonter à la source primaire avant publication d’un chiffre ou d’une règle.
6. Retenir 6 à 10 sujets des quinze derniers jours. Priorités : notoriété, partenariats,
   établissements susceptibles de participer, compréhension du secteur. Ne jamais compléter
   artificiellement jusqu’à six si les sources sont insuffisantes : expliquer l’écart.
   Sujet ancien : date réelle conservée et justification du retour d’actualité.
7. Chaque fiche : titre, résumé ≤ 2 phrases, Pertinence pour Euneos concrète ≤ 2 phrases, lien supposé si
   rapprochement indirect, source/lien/date, chiffres exacts entre guillemets avec population,
   période et périmètre, thèmes, type de source, provenance réelle, échéance/à sourcer et usages.
   Hors liste : au moins deux thèmes et une phrase explicite de rapprochement.
8. Proposer Post LinkedIn / Encart newsletter / Idée d’édito / Événement / Contact-partenariat,
   initialement à faire ou brouillon. Textes factuels sans slogan ni superlatif ; numérique
   présenté comme amplificateur. Signaler les événements vérifiés comme pistes, sans ajout automatique à l’agenda.
9. Écrire un JSON daté du même format que le brouillon fourni, avec bilan de couverture des
   trois canaux, limites d’accès et motifs de sélection. Importer les nouvelles propositions dans la page interne ; aucun post, email ou contact ne doit être envoyé.

## Stockage et transport agent

Migration additive `0029_thematic_watch.sql` dans `TEAM_WORKSPACE`, après 0028, selon le circuit
`docs/internal-migrations.md`. Aucun autre binding ni donnée de candidature concerné.
`thematic_watch` stocke les fiches et versions ; `thematic_watch_keys` conserve les alias
même après suppression ; `thematic_watch_runs` conserve les bilans de recherche.
API humaine : `/api/interne/veille` (GET/POST/PATCH/DELETE), accès équipe et même origine.
Les API de formulaire ne permettent pas de se faire passer pour l’agent.
`saveWatch(..., { automated: true, provenance })` valide les imports et ne fait que des ajouts.

Le workflow `veille-sync.yml` utilise le même canal chiffré que l’agenda, la clé publique
existante et les secrets CI existants. Aucun secret ni contenu privé en clair dans les
arguments ou journaux GitHub. Les réponses chiffrées sont supprimées après lecture locale.

```sh
bun scripts/veille-sync.ts list
bun scripts/veille-sync.ts import /chemin/prive/selection.json
```

Le JSON contient `items`, chaque fiche comprenant `week` (lundi) et `provenance`.
Le transport refuse les modifications, les usages terminés et les ajouts d’événements :
la gestion des rendez-vous se fait uniquement sur la page Agenda.
Les écritures d’une fiche et de ses clés sont un seul lot transactionnel D1.
Lire les fiches et suppressions avant toute sélection ; dédupliquer aussi par sujet.
Après import, contrôler le reçu chiffré et le rendu réel. En cas de réponse perdue,
relire avant toute tentative ; les clés empêchent le retour des sujets supprimés.

La première sélection LinkedIn est préparée le 13 novembre depuis le fil suivi par EUNEOS.
Les fichiers privés de sélection et réponses restent dans `preview-veille/`, ignoré par Git.
Les sept anciens exemples web restent une fixture de recette, jamais un import automatique.

## Recette locale

```sh
TMPDIR=/tmp bun install --frozen-lockfile
bun run test
bun run build
bun scripts/preview-thematic-watch.mjs
bun scripts/preview-thematic-watch.mjs --serve
```

Le dernier mode sert le brouillon sur `http://127.0.0.1:4351/interne/communication/veille`.
Les saisies sont conservées uniquement dans `preview-veille/local.sqlite`, hors Git.
Le harness génère une identité fictive, intercepte uniquement sa clé Access locale et bloque
les appels externes. Aucune dérogation d’authentification n’est ajoutée au code du site.
Les captures de la recette sont `preview-veille/veille-390.png` et `veille-1440.png`.
Avant toute publication ultérieure, refaire les contrôles obligatoires d’AGENTS.md et la
vérification du vrai déploiement. Les contrôles de ce brouillon ne valent pas publication.

## Accès LinkedIn vérifié le 13 novembre 2026

La session Chrome « Pauline Euneos » permet la lecture du compte Pauline et du fil
des pages suivies par EUNEOS :
`https://www.linkedin.com/company/113190350/admin/feed/following/`.
La lecture a été vérifiée dans l’application Chrome, en suivant Mes pages → EUNEOS →
Fil d’actualité. Les contrôles de l’extension ont échoué dans cette session ; le
contrôle natif de Chrome a permis la vérification sans exporter de cookie ni de jeton.
Aucun post, commentaire, abonnement, message ou réglage n’a été modifié.
Le navigateur intégré possède une session distincte et n’est pas connecté : utiliser
Chrome pour cette source. Cette connexion navigateur n’est pas un connecteur permanent
ni une garantie de disponibilité sans intervention lors d’une future recherche.
Si la session expire, demander à Pauline de se reconnecter elle-même.
La sélection LinkedIn est distincte des exemples web de la première prévisualisation.

## Présentation simplifiée demandée le 13 novembre

Les fiches et le formulaire n’affichent plus le lien supposé, l’échéance, les citations
chiffrées, la justification d’ancienneté ni les notes de lecture. Les vérifications déjà
enregistrées restent conservées en données. Les mentions d’import et les détails du tableau
historique ne sont plus affichés. Les résumés temporaires de reprise sont masqués ; une
fiche manuelle peut rester sans résumé ni pertinence le temps de sa relecture.
Le champ « Format de la ressource » est distinct du type de source et de la provenance :
article, post LinkedIn, post Instagram, vidéo, podcast, livre, film/documentaire, newsletter,
rapport/étude, webinaire, BD/manga ou autre. Il est modifiable dans le formulaire.

## Couleurs de thèmes communes — 13 novembre

Agenda et veille partagent topic-tags.css : santé mentale jaune pâle, CPS rose foncé,
numérique gris foncé, éducation bleu clair (#c5d4ff), jeunes ocre, relations sociales
pêche, émotions jaune. Aucun thème vert. Le bleu d’éducation est une exception
explicitement demandée par Pauline pour les pages internes. Les couleurs de statut
et de présence de l’agenda restent indépendantes des thèmes.

L’agenda ne présente plus qu’une seule série de quatre filtres de thèmes.

Le badge « à sourcer » utilise un rouge clair (#f9dada). L’ordre des fiches dépend de la semaine, de la date de parution et de leur identifiant, sans déplacement lors du changement de statut.

Le formulaire de modification est centré dans la fenêtre avec un défilement intérieur.
Les sources affichent un lien explicite « Lire la source ». Les notices de méthode et les compteurs redondants ont été retirés de la page.
