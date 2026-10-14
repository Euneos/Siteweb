---
name: bilan-des-mails
description: Faire le bilan d'une boîte mail — ce qui est arrivé, ce qui attend une réponse, depuis quand — puis inscrire les relances dans la base pour que l'équipe les voie. À utiliser pour « qu'est-ce qui attend une réponse », « bilan de mes mails », « au retour de congés », « qui dois-je relancer ».
---

# Bilan des mails

L'agent lit **la boîte de la personne qui lui parle**, en lecture seule (outils `mail_*`).
Il ne peut ni envoyer, ni supprimer, ni déplacer un mail. Une boîte est privée : ne jamais
chercher à lire celle d'une collègue.

## Étapes

1. **Période** : la demander si elle n'est pas donnée (« depuis le 1er octobre ? »).
2. **Dossiers** : lister les dossiers de la boîte et repérer la réception **et les envoyés**
   (Viaduc : souvent `Sent` ou `Éléments envoyés`). **Sans les envoyés, ne rien conclure** :
   un mail sans réponse visible a peut-être été répondu depuis cette boîte.
3. **Lire** les mails reçus de la période, puis les envoyés de la même période et des jours
   suivants (une réponse peut arriver après la fin de la période).
4. **Rapprocher** chaque reçu de sa réponse : même fil (`In-Reply-To` / `References`), sinon même
   correspondant avec un objet équivalent (sans « Re: », « TR: »). Ignorer les notifications,
   newsletters, accusés automatiques et les mails de l'équipe entre elles, sauf demande.
5. **Relier à un dossier** : chercher l'adresse de l'expéditeur dans NocoDB (contacts des
   `etablissements`, `adultes`, `formateurs`). Donner l'identifiant du dossier quand il existe ;
   dire « aucun dossier trouvé » sinon, sans deviner.
6. **Présenter**, du plus ancien au plus récent :

   | Reçu le | De | Objet | Dossier | Attend depuis |

   Séparer « sans réponse » de « répondu ». Dire combien de mails ont été lus et sur quels
   dossiers de la boîte : si une source manque ou si la lecture est partielle, l'écrire.
7. **Proposer** pour chaque mail sans réponse : préparer un brouillon (compétence
   `preparer-un-email`) ou noter une relance.

## Rendre le bilan visible pour l'équipe

Le bilan reste dans la conversation tant qu'il n'est pas écrit dans la base. Avec l'accord
de la personne, créer une ligne dans la table **`relances`** pour chaque relance décidée :

- `type_relance` : objet court (« lettre d'intérêt », « fiche contact », « réponse formateur »…)
- `date_envoi` : la date à laquelle la relance est faite (vide si seulement prévue)
- `statut` : `prevue` ou `envoyee`
- le lien vers la `participation` ou l'`adulte` concerné

Ne jamais créer de relance pour un mail dont la réponse n'a pas été vérifiée dans les envoyés.

## Règles

- **Ne pas présumer** : « pas de réponse trouvée dans les envoyés de cette boîte » n'est pas
  « personne n'a répondu » — une collègue a pu répondre depuis sa propre boîte.
- Ne recopier aucun contenu de mail dans un document partagé : seulement le fait utile
  (date, correspondant, objet, dossier) dans la base.
