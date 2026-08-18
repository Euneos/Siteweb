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

## Typographie (charte p.15, valeurs exactes)

H1 56 px / 110 % · H2 40 px / 120 % · H3 20 px / 120 % · Chapô 20 px / 140 % ·
Body 16 px / 160 % · letter-spacing 0 partout · SemiBold (600) + Regular (400).
La variante SemiCondensed s'obtient par l'axe `wdth` à 87.5 %.

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
5. **Un utilitaire partagé entre pages doit vivre dans `global.css`.** Déclaré
   dans le `<style is:global>` d'une page, il n'existe que sur cette page :
   `.c-t` était dans la page Programme, et tous les titres de section des autres
   pages s'affichaient alignés à gauche.

## Formulaires

- `POST /api/contact` — page Nous contacter
- `POST /api/newsletter` — pied de page, avec la **segmentation en 3**
  (établissement / partenaire / curieux) portée par le design lui-même

Les deux valident les champs et tracent la demande dans les logs Cloudflare.
**Il ne manque que `BREVO_API_KEY`** pour brancher l'envoi et l'accusé de
réception prévus au brief. La segmentation doit alimenter la même base que le
portail de candidature.

## Ce qui reste à obtenir du client

**Éditorial** (dépend de Pauline, retour le 26/08) : textes des 3 colonnes
Programme de l'accueil, blocs « pourquoi/quoi » et méthodologie de la page
Programme, 3 témoignages d'établissements pilotes, fonctions et contacts de
l'équipe, 6 logos partenaires, textes réglementaires des 3 pages légales.

**Photos** : le site utilise pour l'instant **la photo de la maquette** (celle
que Candice a validée), importée dans `src/assets/photos/jeunes.jpg`. Deux
réserves à lever avant la mise en ligne :
- **résolution** : 816 × 552, suffisant pour la démo, trop juste pour un hero en
  écran retina. Il faut l'original ;
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
