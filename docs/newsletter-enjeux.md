# Newsletter — branche Enjeux (15 septembre 2026)

Les deux formulaires proposent quatre profils. Le profil technique `partenaire`
conserve sa liste et devient « Je souhaite devenir membre/partenaire ».
Le nouveau profil `enjeux` affiche « Je m’intéresse à vos enjeux ».

- Liste Brevo créée : **EUNEOS — Newsletter — Enjeux**, ID **9**.
- Variable publique versionnée : `BREVO_LIST_ENJEUX = "9"`.
- Automatisation **Bienvenue : enjeux — envoi unique**, ID **5**, active.
- Copie du scénario partenaires ID 4, même email de bienvenue pour le moment.
- Déclencheur : ajout à la liste 9 uniquement, après double confirmation (modèle 6).
- Nouvelle entrée après sortie désactivée, comme sur le scénario source.
- Aucun transfert des inscrits existants ; la liste historique Curieux (5) reste distincte.

Les tests unitaires couvrent les quatre listes et le refus de modifier un profil déjà
confirmé. La recette navigateur utilise la branche Enjeux, en local/preview sans email.
