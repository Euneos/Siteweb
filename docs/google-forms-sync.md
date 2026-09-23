# Ancien raccord Google — retiré avant activation

Le raccord publié dans la PR #15 n'a jamais été activé : aucun déclencheur Google,
aucune écriture métier par ce raccord. La cible confirmée le 23 septembre est
le parcours direct des formulaires du site vers NocoDB.

`/api/hook/google-forms` renvoie désormais 410 sans lire de secret, NocoDB ou D1.
Le script, son processeur et les instructions d'activation ont été retirés.
La migration `0002_google_form_sync.sql` reste dans l'historique : ne pas rejouer
une suppression automatique d'une table sur une base existante. Les preuves et
sources historiques restent privées. Les notes de provenance déjà présentes
continuent à être lues par le suivi interne.

Voir `operational-forms.md` pour le circuit direct. Les anciennes collectes Google
qui précèdent la PR #15 ne doivent être fermées qu'après reprise de leurs réponses
récentes et remplacement de leurs liens de distribution.
