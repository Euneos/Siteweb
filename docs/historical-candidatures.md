# Reprise de deux candidatures déjà notifiées

L'import des dossiers `ETAB-C2-46` et `ETAB-C2-48` ne doit pas renvoyer à l'équipe
les notifications déjà envoyées depuis le système Google. Le webhook NocoDB reste
actif pour les nouvelles candidatures.

L'exception est limitée aux participations des établissements 60 et 61, cohorte 2,
portant leur code exact et, sur une ligne entière de leurs notes, le marqueur
`[euneos-reprise-2026-09-21-v1:notification-source-deja-envoyee]`. Ces identifiants
sont ceux des établissements, pas les futurs IDs de participation. Les preuves
nominatives et le lot d'import restent dans le dossier privé d'exploitation.

Le webhook authentifié accepte cette exception uniquement dans l'enveloppe NocoDB
v3 `records.after.insert` de la table participations. Un marqueur reconnu avec des
références incohérentes renvoie 422 sans envoyer d'email, même dans un lot mixte.
Sans marqueur, une candidature conserve son comportement habituel. Un rejeu de
l'import reste silencieux. Un lot mixte notifie uniquement les nouvelles lignes.

Avant tout import, le script doit vérifier sur le domaine exact du webhook
`GET /api/hook/candidature`, avec l'en-tête secret habituel : réponse 200 et
`historicalImportVersion = euneos-reprise-2026-09-21-v1`. Cette lecture ne déclenche
aucun envoi. L'ancienne version ou une absence d'authentification interdit l'import.
Ne pas utiliser POST comme test sur une version inconnue : elle pourrait envoyer.

L'import NocoDB, le rattachement de l'adulte concernée et les regroupements ne sont
pas effectués par cette PR. Aucune modification de hook, aucun formulaire rejoué,
aucune donnée personnelle ajoutée au dépôt.
