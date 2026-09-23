# Formulaires opérationnels directs

La cible confirmée le 23 septembre : site → NocoDB → suivi interne et agent.
Brevo assure l'accusé de réception. Google n'intervient pas dans ce circuit.

## Parcours

L'équipe ouvre `/interne/formulaires`, sélectionne le dossier annuel et crée un
lien de fiche contact, de déploiement ou de participants. Elle le copie dans son
message. La création d'un lien n'envoie aucun email.

Les liens sont conservés dans les colonnes URL privées de `participations` :
`lien_fiche_contact`, `lien_deploiement`, `lien_participants`. Les créer avant le
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

## Configuration

`FORM_SUBMISSIONS` conserve seulement les reçus techniques, empreintes, IDs et
verrous ; les réponses métier restent dans NocoDB. Appliquer les migrations
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

Le hook Google ajouté en PR #15 est retiré avant son activation et renvoie 410.
Conserver les preuves historiques sans installer de nouveau déclencheur Apps Script.
Inventorier les anciens liens distribués, reprendre les dernières réponses puis
fermer chaque ancienne collecte seulement lorsque son remplacement est vérifié.
Les messages déjà reçus ne peuvent pas être réécrits. Les formulaires historiques
fermés doivent indiquer comment obtenir le nouveau lien personnel auprès d'EUNEOS.
La migration ne signifie pas que les anciens questionnaires jeunes, contrats ou
relances ont été remplacés sans avoir été inventoriés et testés séparément.
