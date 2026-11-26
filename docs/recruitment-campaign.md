# Campagne de recrutement

Page privée `/interne/recrutement`, accessible depuis Organisation.
Les fiches `PROS-…` sont des **contacts de prospection**, pas des candidatures
ni un décompte d’établissements. Aucun lien ni changement NocoDB automatique.

Migration additive `0031_recruitment_campaign.sql`, appliquée uniquement par
le circuit `docs/internal-migrations.md`. Aucun contact personnel dans Git.

## Import validé par Charlotte

Le manifeste JSON privé contient les 36 contacts marqués « Oui — campagne 20/11 »
dans `Suivi-commun-prospection-WISE-UP-2026-11-20.xlsx`, avec sept comptes rendus
d’appels sans date connue. Les 145 lignes sans envoi renseigné restent hors import.
Les libellés multi-établissements et coordonnées incertaines sont conservés et signalés.
Le fichier Excel reste inchangé.

`bun scripts/import-recruitment.ts /chemin/prive/contacts.json` valide le manifeste
sans réseau ni écriture. Après publication vérifiée de la migration et validation
de la page, ajouter `--confirmer`, avec les variables D1 locales déjà utilisées
par `scripts/calendrier.ts`. Ne jamais afficher ces variables.
L’import précontrôle tous les identifiants, refuse tout existant, puis crée et
relit chaque contact. Après interruption, réconcilier les lignes déjà enregistrées :
ne pas relancer le même lot à l’aveugle.

## Recette

`bun test tests/recruitment.test.ts`, `bun run test`, `bun run build`.
`bun scripts/preview-recruitment.mjs` teste la page compilée avec des contacts
fictifs. `RECRUITMENT_MANIFEST` peut pointer vers le manifeste privé pour la
relecture locale ; `RECRUITMENT_OUTPUT` place les captures hors du dépôt.
`--serve` ouvre uniquement sur `127.0.0.1:4355`, avec une identité locale signée
et une base en mémoire. Ni accès distant ni exception d’authentification dans
le site déployé. Les modifications de cet aperçu ne sont pas persistées.
