# Formulaires opérationnels directs

La cible confirmée le 23 septembre : site → NocoDB → suivi interne et agent.
Brevo assure l'accusé de réception. Google n'intervient pas dans ce circuit.

Le contrat actuel des formulaires 3 (contact), 4 (organisation adultes) et 5
(activités jeunes), leurs champs et les migrations préalables sont décrits dans
[Formulaires 3, 4 et 5](operational-forms-3-5.md). Les réponses anciennes restent
lisibles et les reçus réutilisables ; le n°5 nécessite une activation distincte.

## Parcours

L'équipe ouvre `/interne/formulaires`, sélectionne le dossier annuel et crée un
lien de fiche contact, de déploiement, de participants ou d’activités jeunes si
ce dernier est activé. Elle le copie dans son
message. La création d'un lien n'envoie aucun email.

Les liens sont conservés dans les colonnes URL privées de `participations` :
`lien_fiche_contact`, `lien_deploiement`, `lien_participants`, `lien_activites_jeunes`. Les créer avant le
déploiement, sans défaut ni contrainte unique. Copier un lien existant ne le renouvelle
pas. L'agent peut lire ces colonnes pour préparer les modèles NocoDB `fiche_contact`,
`form_deploiement` et `liste_participants` : variable `lien`, sans retour vers Google.
Le lien donne accès au formulaire : ne pas le placer dans des logs ou exports publics.

Le lien personnel porte un jeton aléatoire de 256 bits, limité au dossier et au
type de formulaire, valable 90 jours. Le registre ne conserve que son empreinte.
La création d'un nouveau lien du même type invalide le précédent. Une validation
réussie consomme logiquement le lien ; une retransmission identique retrouve le
reçu. Pour une correction, l'équipe crée un nouveau lien. Un incident d'écriture
n'est pas effacé par ce renouvellement : le verrou métier impose sa réconciliation.
Une création de lien interrompue après l'écriture NocoDB conserve aussi son verrou.
Vérifier la colonne du dossier, l'empreinte du lien et le slot D1 avant de conclure
ou de débloquer ; ne pas lancer automatiquement une autre création.

L'établissement et la cohorte ne sont pas modifiables par le répondant. Aucune
liste nominative existante n'est dévoilée sur la page publique. Les réponses sont
validées côté serveur, puis rattachées au dossier exact. Les nouvelles personnes
identifiables sont ajoutées sans supprimer les personnes déjà inscrites. Un nom
de formateur déclaré ne crée pas une mission et aucun participant n'est réputé
formé par le simple envoi du formulaire.

## Catalogue interne

`/interne/formulaires` sépare les exemples fictifs, les quatre URL publiques
réutilisables dans les guides et les liens personnels du dossier. Consulter un
exemple, choisir un formulaire ou copier un lien existant ne crée aucun lien et
n'envoie aucun email. Les exemples simplifiés ne remplacent pas le formulaire
complet et ne contiennent ni jeton ni donnée de dossier.

Les cartes 3 (contact), 4 (formation adultes), 5 (activités jeunes) et le complément
participants suivent `enabled` et la liste `kinds` du GET interne. Un type absent
reste « À préparer » et son bouton est désactivé. Le sélecteur n'offre que les types
annoncés ; une actualisation qui retire un type masque aussi son ancien lien.
Une erreur donne « État non vérifié », une preview « création désactivée ».
La disponibilité du service ne certifie pas la reprise des réponses historiques.

Le n°5 devient disponible uniquement lorsque l'API annonce `activites-jeunes`
avec `enabled: true` (route `/suivi/activites-jeunes`). Le catalogue ne modifie aucun
flag. Sans propriété `kinds`, la compatibilité avec l'ancienne API se limite aux
trois types `contact`, `deploiement`, `participants` ; une liste vide n'active rien
et une liste malformée bloque la génération. L'activation serveur du n°5 reste
conditionnée à sa recette de bout en bout. La lettre d'intérêt reste un document
à obtenir auprès de l'équipe ; les questionnaires adultes pré/post/suivi/bilan
n'ont pas de remplacement annoncé dans ce catalogue.

La recette `bun run test:operational` vérifie le catalogue compilé, ses interactions,
les états actif/indisponible/preview/erreur et les dix largeurs d'écran, avec des
dossiers fictifs et des transports simulés uniquement.

## Configuration

Pour les formulaires directs, `FORM_SUBMISSIONS` conserve seulement les reçus
techniques, empreintes, IDs et verrous ; leurs réponses métier restent dans NocoDB.
Le raccord Google temporaire décrit dans `google-forms-sync.md` ajoute une capture
privée distincte de ses sources brutes dans cette même base, s’il est activé.
Appliquer les migrations
`0003_operational_links.sql` et `0004_operational_submissions.sql` sur la base
existante avant publication. Le site utilise `NOCODB_TOKEN` et les variables
Brevo déjà configurées. Aucun nouveau secret Google ou service externe à créer.
`OPERATIONAL_FORMS_ENABLED=true` ouvre le circuit en production.

L'espace équipe conserve la vérification Cloudflare Access à l'origine. Les
formulaires destinés aux établissements utilisent leur lien individuel et
n'exigent aucun compte Google. Leurs pages sont privées, sans cache ni indexation,
et n'envoient pas leur adresse comme référent de navigation.

## Vérification et incidents

Sur une preview, `?t=demo` affiche uniquement un collège fictif. Les POST sont
validés mais n'écrivent rien et n'envoient aucun email. Un vrai lien de production
ne fonctionne pas en preview.

Une panne avant toute mutation permet une nouvelle tentative. Une réponse perdue
pendant ou après une écriture produit un état à vérifier et conserve le verrou.
Aucun délai ne libère automatiquement ce verrou. Inspecter la base et le reçu
avant de le réconcilier ; ne pas rejouer les créations à l'aveugle. NocoDB ne
fournit pas ici de transaction couvrant les personnes et le dossier. La comparaison
avant écriture ne protège pas de toutes les éditions humaines simultanées.

L'accusé Brevo est tenté une seule fois après un enregistrement confirmé. Un envoi
incertain ne se répète pas automatiquement et ne remet pas en cause les données
correctement enregistrées. Aucun autre email, contrat ou changement de candidature
n'est déclenché par ces formulaires.

## Sortie de l'historique

Le hook Google ajouté en PR #15 a été retiré avant son activation et reste à 410
par défaut. Le raccord temporaire préparé le 29 septembre est décrit dans
`google-forms-sync.md` ; son activation est distincte du circuit direct.
Inventorier les anciens liens distribués, conserver les réponses récentes puis
fermer chaque ancienne collecte seulement lorsque son remplacement est vérifié.
Les messages déjà reçus ne peuvent pas être réécrits. Les formulaires historiques
fermés doivent indiquer comment obtenir le nouveau lien personnel auprès d'EUNEOS.
La migration ne signifie pas que les anciens questionnaires jeunes, contrats ou
relances ont été remplacés sans avoir été inventoriés et testés séparément.
