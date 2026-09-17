# Fiche contact établissement : correction préparée

La fiche d'organisation Google est distincte de `/api/contact` et des candidatures
du site. Son handler `onFicheContactEtab` se trouve dans `SyncFormulaires.gs`.
Il écrit dans le suivi Google et utilise sa propre notification ; il n'écrit pas
dans NocoDB via les endpoints du site.

Le lecteur générique `_champ(e, ['etablissement', 'établissement'], 2)` prend la
première question contenant « établissement ». Selon l'ordre de `namedValues`,
il lit le type d'établissement, le regroupement avec d'autres établissements ou
le consentement, au lieu de son nom. La notification « À RATTACHER » reprend
alors cette mauvaise réponse. La reproduction locale sur l'export du script
retrouve ce défaut. Plusieurs soumissions distinctes produisant cette alerte
ne prouvent pas qu'un même événement a été renvoyé plusieurs fois.

## Préparer le fichier corrigé

```sh
bun scripts/prepare-contact-patch.mjs /chemin/prive/SyncFormulaires.gs /chemin/prive/SyncFormulaires-patched.gs
```

La commande ne contacte aucun service. Elle refuse tout export dont le SHA-256
diffère de la source revue, ainsi qu'un fichier de sortie déjà présent. Elle écrit
un fichier local en mode `600` et affiche les deux empreintes.

Le correctif remplace les six lectures du seul handler contact par les libellés
exacts, tolérants aux accents, apostrophes et espaces. Il ne se rabat jamais sur
une position. Un nom absent ou des libellés ambigus arrêtent le traitement avant
écriture. Les champs optionnels absents restent vides ; le mécanisme existant
n'écrit pas les valeurs vides.

Le rapprochement propre au contact conserve la recherche exacte puis partielle
unique, mais refuse désormais aussi deux noms exactement identiques. Aucun dossier
n'est fusionné. Les autres handlers et leur lecteur générique sont conservés,
ainsi que la priorité des dates définitives de déploiement sur les prévisions.

## Installation et reprise séparées

Ce fichier préparé n'est **pas installé** dans Apps Script par la CI du site.
La fusion de cette PR ne publie pas ce correctif Google. Avant une installation
autorisée, exporter de nouveau le fichier depuis le projet propriétaire, vérifier
son empreinte et conserver la sauvegarde. Toute différence demande une nouvelle
comparaison, jamais une désactivation du contrôle d'empreinte.

Ne pas rejouer les réponses historiques avec le handler : il notifie l'équipe
et peut modifier des dates prévisionnelles. La reprise du stock doit être un lot
distinct, sans envoi, qui rapproche chaque réponse de la bonne ligne, préserve
les dates définitives et laisse les ambiguïtés à l'équipe. Les variantes de noms
non reconnues et les homonymes nécessitent toujours une preuve d'identité ; la
correction du lecteur ne les résout pas à elle seule.

`bun run test` vérifie le lecteur et ses refus en simulation. Les sources réelles,
la corrélation des réponses au journal et la reproduction du handler complet
restent dans le rapport privé d'intervention, hors dépôt.
