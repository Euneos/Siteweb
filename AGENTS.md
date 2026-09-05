# EUNEOS — site web

> **Ce fichier est la doc technique, à destination de qui intervient dans le code
> (Stella / LAOM).** Le document destiné à l'équipe d'EUNEOS — Candice, Charlotte,
> Pauline — est la page `/style-guide` : elle explique la charte et comment leur
> faire vivre le site **via l'agent**, sans jamais ouvrir un fichier.

Site des 4 pages validées par Candice le 7 août 2026. Construit à partir de
`charte_graphique.pdf` (V3, juillet 2026) et `maquette_euneos V 7 aout candice.pdf`.
La spécification complète est dans le vault NILA :
`4 - CASQUETTES/11. Agence/Stella Collab/Client/EUNEOS/DA-SITE.md`.

## Stack

Identique au site LAOM, volontairement.

| Brique | Choix |
|---|---|
| Framework | Astro 5 |
| Adaptateur | `@astrojs/cloudflare` |
| CSS | Tailwind 4 via `@tailwindcss/vite` + tokens en variables CSS (`src/styles/global.css`) |
| Paquets | **bun** |
| Déploiement | Cloudflare Pages (compte client, accès admin `orion.aubert@gmail.com`) |
| Police | Open Sans SemiCondensed, self-hostée, licence OFL (`public/fonts/`) |

`output: 'static'` — les 4 pages sont du contenu pur, servies depuis le CDN.
Seuls les endpoints de formulaire sont rendus à la demande (`prerender = false`).

```bash
bun install
bun run dev      # http://localhost:4321
bun run build    # astro check + build
```

## Le concept, à respecter

> « Euneos fait du format papier la symbolique de son ancrage dans le réel. »

Chaque bloc est **une feuille au format A avec un coin plié**. Le triangle du pli
prend la **couleur « + »** : la variante foncée de la teinte du bloc. Tout est en
CSS (`clip-path` + pseudo-élément), aucune image.

La charte précise « 1 ou 2 plis par compo maximum » — c'est le point n°2 des
arbitrages à valider (voir plus bas).

### Le pli a une taille ABSOLUE, pas un pourcentage

Relevé sur les **59 plis des 4 pages** du PDF (extraction vectorielle) : un CTA
de 88 pt de large et un de 295 pt ont le **même** pli de 12,9 pt. La taille
dépend de la famille de bloc, jamais de sa largeur.

| Famille | PDF | Calibre | Valeur |
|---|---|---|---|
| CTA, étiquette, champ | 12,9 pt | `foldSize="sm"` | ~31 px |
| Carte de grille | 27,5 pt | `foldSize="md"` | ~67 px |
| Bulle de titre | 46,9 pt | `foldSize="lg"` (défaut) | ~113 px |
| Coin de section | 94,3 pt | `foldSize="xl"` | ~228 px |

Conversion : la page PDF fait 595,3 pt pour 1440 px, soit 1 pt = 2,419 px.

**Le pli n'est pas toujours carré.** La charte dit « sa hauteur et sa largeur
sont libres », et la maquette s'en sert : bandeau d'impact 69,2 × 22,7 ·
témoignage 60,3 × 25,2 · photo mission 76,3 × 25,2 · étiquette d'équipe
18,5 × 3,6. On pose alors `--fx` et `--fy` sur le bloc ; ils retombent sur `--f`
quand le pli est carré.

Les CTA du PDF font **26,7 pt de haut, soit ~64 px** — beaucoup plus généreux
qu'un bouton web ordinaire.

## Règles de couleur (charte p.10 à 16)

- **Vert `#00382D`** = couleur principale · **Jaune `#F8C702`** = principale également
- **Bleu `#8AA9FF`** = **réservé au Programme clé (WISE-UP)**. Ne pas l'utiliser ailleurs.
- Orange `#FC5E27` et rose `#F2B3F0` = secondaires, **par touches**
- Fond de page = **`#F1EEEE`** (pas du blanc pur)
- « Les lettres du logo ne sont jamais colorisées » · « les textes ne s'utilisent qu'en noir ou blanc »

Chaque teinte a 3 niveaux (clair / base / `-fold`) déclarés dans `global.css`.
Une surface s'applique avec une classe `s-vert`, `s-jaune`, `s-bleu`… qui pose
`--surface`, `--on-surface` et `--fold-color`.

### Écart assumé par rapport à la charte

La charte prescrit du **texte blanc sur rose et sur bleu clair** : ratios 1,7:1 et
2,2:1, très en dessous du minimum WCAG AA (4,5:1). Le code met donc du vert foncé
ou du noir sur les teintes claires — solution **déjà employée par la maquette
page 2** (titre « Notre Programme » en vert sur fond bleu). À faire valider.

## Typographie — une echelle unique, dans `global.css`

La charte p.15 donnait H1 56 / H2 40 / H3 20 / body 16. **La maquette v4 n'utilise
pas ces valeurs** et c'est elle que Candice a validee : le site suit la maquette.
Relevees dans le PDF (tailles de police exactes des spans, ramenees a 1440 px),
la maquette n'a que ces corps, codes une fois pour toutes en variables `--t-*` :

| Role | px a 1440 | Variable | Ou |
|---|---|---|---|
| Titre (H1 = H2) | 47 | `--t-titre` | heros, sections, « Notre approche », 3 principes, Reveler/Eclairer/Diffuser, bloc mission |
| Sous-titre (H3) | 39 | `--t-h3` | titres des 5 etapes |
| CTA / etiquette | 36 | `--t-cta` | libelles de bouton, noms sur etiquette, titres des cartes « niveaux », cartes « prendre part » |
| Titre de carte | 27 | `--t-carte` | cartes bleues de l'accueil |
| Texte courant | 24 | `--t-corps` | tout le reste, labels, surtitres, bouton Envoyer |
| Navigation | 21 | `--t-nav` | menu |
| Note | 17 | `--t-note` | notes de source, mentions RGPD |
| Chiffres | 62 · 94 | `--t-chiffre`, `--t-chiffre-xl` | pourcentages p.1 · impact chiffre et numeros d'etape p.2 |

Chaque valeur est fluide (`clamp`), exacte a 1440 et reduite en dessous. Interlignes :
1,3 pour le texte, 1,2 pour les titres. SemiBold (600) + Regular (400), `wdth` 87.5 %.
**Aucune page ne pose de `font-size` en dur** : pour changer une taille, on change
la variable.

Meme logique pour les espaces (`--s-bloc` 122 px entre deux blocs, `--s-titre`
79 px entre un titre et son contenu, `--s-int` 42 px de marge interne de carte),
les elements graphiques (`--picto-sm/md`, `--pbox-sm/md/lg`, `--logo-h`) et les
CTA (tout en `em` : un libelle de 36 px donne un bouton de 65 px, `.cta--sm` pour
les petits CTA des cartes « niveaux »). `.section` porte la moitie de `--s-bloc`
de chaque cote : deux sections qui se suivent donnent l'espace de la maquette,
et aucune section ne redefinit son padding.

## `/style-guide` — le document de passation à EUNEOS

Page interne (hors sitemap, `noindex`) qui montre la charte **telle qu'elle est
codée** : les pastilles de couleur affichent les variables CSS du site, pas des
captures. Sept sections de référence (concept, couleurs avec hex + règle d'usage
+ contrastes mesurés, typographie, logo, les 15 pictogrammes, le pli, les
composants), puis une huitième écrite pour **une équipe non technique** :

- l'équipe d'EUNEOS ne code pas et n'ouvrira aucun fichier. Elle formule ses
  demandes **à l'agent, en français** — c'est le fonctionnement vendu le 4/08 :
  demande en langage naturel → code → GitHub → déploiement Cloudflare ;
- la section liste donc des **exemples de phrases à dire**, pas des chemins de
  fichiers, plus ce dont elles gardent la main (demandes reçues, relecture avant
  publication, retour arrière) et les deux règles de charte à ne pas casser
  (le bleu réservé au Programme, un ou deux plis par composition).

Ne pas y remettre de chemin de fichier ni de vocabulaire de dev : ça vit ici.

## Composants

| Composant | Rôle |
|---|---|
| `Paper.astro` | la feuille pliée. Props `surface`, `fold` (`br`/`tr`/`tl`/`bl`/`none`), `outline` |
| `Cta.astro` | étiquette à coin plié, pleine ou contour |
| `Brand.astro` | tous les vectoriels : `wordmark`, `fig1`..`fig5` (silhouettes), 10 pictos |
| `Cartouche.astro` | le logo en cartouche, portrait (avec silhouette) ou paysage |
| `PictoBox.astro` | petit cartouche coloré à picto blanc, posé en débord |
| `Photo.astro` | emplacement photo au bon ratio (aucune photo fournie à ce jour) |

Les vectoriels de `src/assets/brand/` ont été extraits de `charte_graphique.pdf`
(pages 5, 20, 21) avec `pdftocairo -svg`, puis normalisés en `fill="currentColor"`.

## Les bonshommes : deux usages, à ne pas confondre

- **`.silo`** — silhouette de débord : pleine, opaque, elle sort du cadre par un
  bord de page. Dans la maquette elle occupe **toujours la marge, jamais la zone
  de texte** : c'est une règle de mise en page. La classe borne sa largeur, et les
  colonnes de texte sont resserrées pour lui laisser la place. Masquée en mobile.
- **`.filigrane`** — fond de bandeau : opacité **0,08**, derrière le contenu.
  Au-delà, le texte devient sale.

## Cinq pièges rencontrés, à ne pas refaire

1. **Astro ne scope pas les classes passées à un composant.** Une classe donnée
   à `<Paper class="mon-bloc">` ne sera jamais atteinte par un `<style>` scopé du
   parent. C'est pourquoi les styles de page sont en **`<style is:global>`** avec
   des noms préfixés (`hero__`, `etapes__`, `faq__`…). À l'intérieur d'un
   composant, styler ses propres éléments et utiliser `:global(svg)` pour le SVG
   injecté par `set:html`.
2. **Un `padding` en % se résout sur la largeur du conteneur, pas sur celle de la
   boîte.** Sur un petit cartouche dans une colonne large, le padding mangeait
   tout l'élément. `PictoBox` reçoit donc sa taille en variable CSS et calcule son
   padding avec `calc(var(--pbox) * 0.17)`.
3. **`:global()` n'existe pas en CSS**, c'est une extension Astro valable
   uniquement dans un `<style>` de composant. Écrit dans `global.css`, il rend le
   sélecteur invalide — et un sélecteur invalide **annule toute la règle**.
4. **Le style scopé d'un composant gagne en spécificité** sur une règle
   extérieure. Pour dimensionner un `Brand` par la hauteur, passer par son API
   (`height="100%"`) plutôt que d'écrire une règle concurrente.
5. **Un `background` posé sur un bloc à pli masque son rabat.** Le rabat est
   peint en arrière-plan (`::after` en `z-index: -1`) : un fond sur l'élément
   lui-même passe devant. C'est ce qui rendait le rebord invisible sur la section
   hero et les cartouches alors qu'il marchait sur les boutons. Un garde-fou
   `.paper[class*='fold-'] { background: transparent !important }` l'empêche
   désormais : **le fond d'un bloc à pli passe toujours par `::before`.**
   Exception conforme à la maquette : le grand rabat de `.hero-zone` passe au
   premier plan pour recouvrir la partie de photo prise dans le pli.
6. **Un utilitaire partagé entre pages doit vivre dans `global.css`.** Déclaré
   dans le `<style is:global>` d'une page, il n'existe que sur cette page :
   `.c-t` était dans la page Programme, et tous les titres de section des autres
   pages s'affichaient alignés à gauche.

## Formulaires

- `POST /api/contact` — page Nous contacter
- `POST /api/newsletter` — pied de page, avec la **segmentation en 3**
  (établissement / formateur-ice / partenaire) portée par le design lui-même
- `POST /api/candidature-etablissement` et `/api/candidature-formateur` —
  écriture dans NocoDB et accusé Brevo lorsque le transport est configuré

Les formulaires refusent les valeurs trop longues, les choix inconnus et les
soumissions d'une autre origine. Ils comportent aussi un champ piège anti-robot.
Contact et newsletter ne renvoient jamais un faux succès : sans configuration
Brevo, ils affichent une indisponibilité et ne jettent pas les données dans les
logs.

Variables Cloudflare nécessaires (voir `.dev.vars.example`) :

- `NOCODB_TOKEN` pour les candidatures ;
- `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` et `EQUIPE_EMAIL` pour les e-mails ;
- `BREVO_LIST_ETABLISSEMENT`, `BREVO_LIST_FORMATEUR` et
  `BREVO_LIST_PARTENAIRE` pour la segmentation de la newsletter ;
- `BREVO_DOI_TEMPLATE_ID` pour l'e-mail de double confirmation de la newsletter ;
- `HOOK_SECRET` pour authentifier le webhook NocoDB.

Les quatre endpoints de formulaire publics sont proteges dans Cloudflare par la
regle de securite `Limiter les formulaires publics EUNEOS` : blocage pendant
10 secondes au-dela de 5 requetes en 10 secondes pour une meme adresse IP. La
limitation reste au niveau de la zone car Pages ne prend pas en charge les
bindings `ratelimits` de Workers.

## Ce qui reste à obtenir du client

**Éditorial** (dépend de Pauline, retour le 26/08) : textes des 3 colonnes
Programme de l'accueil, blocs « pourquoi/quoi » et méthodologie de la page
Programme, 3 témoignages d'établissements pilotes, fonctions et contacts de
l'équipe, 6 logos partenaires, textes réglementaires des 3 pages légales.

**Photos** : le hero de la page d'accueil utilise `classe.jpg` (collégiens en
atelier), choisie par Charly — elle colle mieux à la direction de la charte que
la photo de la maquette. Les autres emplacements gardent `jeunes.jpg`, la photo
de la maquette. Réserves identiques sur les deux :
- **résolution** : 816 × 552 pour `jeunes.jpg`, 1137 × 540 pour `classe.jpg` —
  suffisant pour la démo, trop juste pour un hero en écran retina. Il faut les
  originaux ;
- **licence** : à vérifier auprès de Pauline (probablement une banque d'images).

Direction imposée par la charte pour les suivantes — humaine, authentique,
lumineuse, saturation douce, couleurs naturelles ; **pas de studio, pas de
détourage, pas de pose**. `<Photo empty />` revient au cadre vide si besoin.
Les images passent par `astro:assets` : webp + variantes responsives au build.

**Arbitrages** (les 8 points du chapitre 10 de `DA-SITE.md`), dont les deux qui
comptent : le contraste ci-dessus, et **« Calendly » (docx) contre « Candidatez /
Infos et candidature » (maquette)** — ce ne sont pas les mêmes mécaniques et ça
conditionne le portail de candidature.

## Domaine

`euneos.fr` répond aujourd'hui avec un certificat `*.conceptiondesite.com`
(constructeur Viaduc) : **alerte de sécurité navigateur pour tout visiteur**.
Rien à préserver, la bascule DNS vers Cloudflare ne détruit aucun site existant.

## Maquette v2 (20/08) — ce qui a change dans le code

Recue par mail le 20/08. `maquette_euneos_2.pdf` remplace `maquette_euneos V 7 aout candice.pdf` comme reference.
Les deux vivent dans le dossier client (`Client/EUNEOS/Ressources/`).

### Geometrie du hero page 1

Candice a **elargi la bulle** pour loger le nouveau titre. Releve au pixel sur les deux PDF
(rendu a 110 dpi, page 595,276 pt ramenee a 1440 px) :

| | v7 | v2 | dans le code |
|---|---|---|---|
| bord gauche de la bulle | 15,02 % | 15,02 % | inchange |
| bord droit de la bulle | 51,08 % | **54,29 %** | `.hz:not(.hz--mirror) .hz__grid` |
| largeur de la bulle | 36,08 % | **39,27 %** | rendu mesure : 39,27 % |
| bord gauche de la photo | 51,27 % | **54,68 %** | rendu mesure : 54,68 % |
| bord droit de la photo | 95,05 % | 95,05 % | inchange |

Les pages 2 et 3 (`hz--mirror`) gardent leur geometrie : le bord droit de la bulle page 3
est identique dans les deux versions.

### Titre bicolore : la regle est par page, pas globale

Erreur commise puis corrigee : j'ai d'abord supprime la seconde teinte partout. Releve a
l'encre, page par page :

- **page 1** : la v7 avait un titre bicolore, la **v2 le passe en blanc uni** (#ffffff sur
  toute la hauteur) -> plus de `hz__soft` dans `index.astro` ;
- **page 2** : bicolore **conserve**, « Le Programme EUNEOS : » en blanc puis le reste en
  bleu clair #c5d4ff -> `.hz__strong` + `.hz__soft`, et `.s-bleu .hz__bubble h1` doit forcer
  le blanc (l'encre par defaut de la surface bleue est le vert, ce qui rendait le titre
  vert fonce) ;
- **page 3** : n'a jamais eu de seconde teinte.

### Echelle typographique : mesurer l'encre, pas la bbox

`pdftotext -bbox` donne une boite qui depend du descripteur de la fonte : le rapport
bbox/corps n'est **pas** le meme pour le gras de titrage (1,375) et pour le regular de
labeur (1,665). Comparer deux bbox de fontes differentes donne un rapport faux (1,98 au
lieu de 1,88).

La methode fiable : rendre a 300-400 dpi, detecter les bandes d'encre par ligne, et
comparer des lignes de meme profil (avec accent **et** jambage), dont l'empan vaut ~0,97 em.

Mesures sur la v2 (a 1440 px) :

| | encre | corps deduit | interligne |
|---|---|---|---|
| paragraphe | 10,08 pt | ~25 px | 1,15 |
| H1 du hero | 18,98 pt | ~47 px | 1,18 |
| bandeau Erasmus+ ligne 1 | 19,70 pt | ~47 px | — |
| bandeau Erasmus+ ligne 2 | 10,10 pt | ~25 px (= le corps) | — |

**Rapport H1 / corps = 1,883** — c'est cette valeur qui est codee
(`.hz__bubble h1: clamp(1.38rem, 2.49vw, 2.33rem)` a un corps de 19 px), pas l'echelle
absolue de la maquette. Voir l'arbitrage ouvert dans `CONTEXT.md`.

### Piege n7 — un utilitaire partage dans le `is:global` d'une seule page

Meme piege que `.c-t` / `.c-cta` : `.source` (la note de bas de bloc) a d'abord ete
declaree dans `index.astro`, donc invisible sur `qui-sommes-nous.astro`. Tout selecteur
utilise par plus d'une page vit dans `global.css`.

## Maquette v4 (1/09) — retour de Pauline, ce qui a change

`maquette_euneos_4.pdf` remplace la v2 comme reference. Mail de Pauline : tailles
d'elements graphiques, espaces qui varient, tailles de texte et de boutons
incoherentes, fleches qui ne deroulent pas, blocs de couleur de la page
Programme trop espaces, URL de newsletter. Tout est traite a la racine
(variables de `global.css`), pas page par page — voir la section Typographie.

- **Les fleches « qui ne deroulent pas »** avaient deux causes, verifiees sur un
  build de prod : sur l'accueil, tout le texte des cartes bleues etait dans le
  `<summary>` et seule la hauteur de la carte le coupait — sur un grand ecran
  tout tenait, cliquer ne changeait rien ; sur la page Programme, les fleches
  sous les 3 principes etaient un `<span aria-hidden>` decoratif sans aucune
  interaction. Desormais : accueil, le summary porte titre + intro et les points
  sont dans le corps du `<details>` (il y a toujours quelque chose a derouler) ;
  Programme, plus de fleche, le texte est complet (comme la v4).
- **Etapes de la page Programme** : grille a deux colonnes en quinconce (cartes
  de 611 x 409 a 1440, gouttiere 37 px, colonne droite decalee d'un quart de
  carte par `transform`), au lieu d'une carte par ligne sur une demi-largeur.
- **`/newsletter`** : page dediee, meme formulaire et meme `POST /api/newsletter`
  que le pied de page ; le champ cache `retour` (liste blanche) choisit la page
  de retour. Rendue a la demande pour afficher `?nl=` sans JavaScript.
- Titres verts par defaut (`--ink-titre`), blancs sur les surfaces foncees.
- La page privee « facon Notion » n'est PAS faite : decision produit a cadrer.

## Corrections Pauline — 5 septembre 2026 (règles actuelles)

Ces règles complètent les relevés historiques ci-dessus. Partir du dernier `origin/main`
propre avant une intervention et préserver les textes et changements récents de Pauline.

### Images : l'agent réalise l'intégration

- Les originaux vectoriels disponibles sont déjà dans `src/assets/brand/` : les réutiliser
  via `Brand`, `PictoBox`, `Cartouche`, sans recréer les dessins ni demander un hébergement.
- Les photos disponibles vivent dans `src/assets/photos/`. Une nouvelle photo fournie
  est copiée dans ce dossier, importée et passée à `Photo` avec un `alt` adapté. L'agent
  fait ces opérations ; Pauline n'a pas à téléverser un fichier dans Cloudflare.
- Une capture de maquette sert à comparer, pas à fabriquer une fausse photo originale.
  Les portraits nominatifs et les logos partenaires absents restent à fournir ; ne pas
  prétendre qu'une photo générique est le portrait réel d'un membre.
- Définir le cadrage ordinateur ET mobile. La mission utilise 3/4 puis 4/3. Son cartouche
  reste dans le flux sous la photo ; seul le pictogramme décoratif est positionné en absolu.

### Espaces, textes et interactions

- Réutiliser `--s-bloc`, `--s-titre`, `--s-int` et les rôles `--t-*`. Pour un en-tête avec
  introduction : petit espace titre → paragraphe, espace supérieur paragraphe → cartes.
- Sur une grille contenant du texte dépliant, `align-items: start` et, si nécessaire,
  `align-content: start`. Aucun étirement automatique de l'espace entre deux paragraphes.
- Un accordéon grandit avec son contenu ; ses espaces internes ne changent pas entre
  fermé et ouvert. Ne pas figer sa hauteur, ne pas cacher le débordement du texte.
- Une biographie est du texte en bloc. Poser la taille ET l'interligne sans unité sur son
  conteneur pour éviter la ligne de base héritée d'un parent plus grand. `--t-bio` garde
  au moins 16 px, avec `--lh-corps`, sans `!important` ni interligne inférieur au corps.
- Les « + » ont une cible de 44 × 44 px, une place réservée hors du texte et du pli,
  un libellé accessible et une ouverture/fermeture au clavier.
- Le carrousel utilise une seule liste de membres et le défilement tactile natif. Ne pas
  tripler les biographies dans le DOM ni déplacer le scroll pendant que l'utilisateur lit.
- Les décors mobiles occupent une zone distincte du titre et du bouton. Le clipping est
  limité au décor ; il ne doit pas masquer une mauvaise largeur de contenu.
- Dans `<style is:global>`, écrire des sélecteurs CSS ordinaires, sans `:global(...)`.

### Vérification obligatoire avant publication

1. `bun run test` : vérifie les trois profils de newsletter avec Brevo simulé, sans email.
2. `bun run build` : vérification Astro et compilation.
3. Démarrer le site compilé : `bunx wrangler pages dev dist --port 4321`.
4. `bun run test:layout` : contrôle à 320, 390, 768, 860, 861, 1024 et 1440 px,
   ouverts/fermés, touches Entrée, flèches de carrousel, débordements et chevauchements.
   Installer Chromium au besoin : `bunx playwright install chromium`.
5. Inspecter aussi les captures ordinateur et téléphone :
   `CHECK_SCREENSHOTS=/tmp/euneos-layout bun run test:layout`.
   `CHECK_BASE_URL` permet de refaire le contrôle sur la preview ou la production.
6. Vérifier le déploiement GitHub et le rendu réel avant d'annoncer la mise en ligne.

Newsletter : la liste Brevo « EUNEOS — Newsletter — Formateurs » porte l'ID **6**,
configuré dans `BREVO_LIST_FORMATEUR` via `[vars]` de `wrangler.toml`. Une variable
non secrète ajoutée seulement dans le tableau Cloudflare est supprimée par un déploiement
Wrangler si elle manque dans ce fichier : toujours versionner les IDs publics ici. Le modèle de
confirmation est également **6** : les listes et modèles ont des espaces d'identifiants
séparés. Les autres profils gardent leurs listes 3 et 4 ; la liste historique Curieux
n'est ni supprimée ni réaffectée. Les previews ne déclenchent aucun envoi réel.
