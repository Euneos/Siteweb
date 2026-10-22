import { lireToutes } from './nocodb'

type Ligne = Record<string, unknown> & { Id: number }
const texte = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
const normaliser = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

export function construireSuiviFormateurs(
  personnes: Ligne[],
  parcours: Ligne[],
  maintenant = new Date(),
) {
  const parId = new Map(personnes.map((personne) => [personne.Id, personne]))
  return parcours
    .filter((p) => p.fusionne_vers == null)
    .map((p) => {
      const personne = parId.get(Number(p.formateurs_id))
      const date = texte(p.date_candidature)
      const age = date
        ? Math.floor((maintenant.getTime() - Date.parse(`${date}T00:00:00Z`)) / 86400000)
        : NaN
      const statut = texte(p.statut) || 'Non renseigné'
      const aExaminer = ['Candidature recue', 'Accuse reception'].includes(statut)
      return {
        id: p.Id,
        personneId: personne?.Id,
        nom: personne
          ? [texte(personne.prenom), texte(personne.nom)].filter(Boolean).join(' ')
          : `Identité à vérifier — dossier ${p.Id}`,
        ville: texte(personne?.ville),
        email: texte(personne?.email),
        profession: texte(personne?.profession),
        statut,
        date,
        age,
        aExaminer,
        nouveau: age >= 0 && age <= 7,
        ancien: aExaminer && age >= 30,
        accord: p.accord_signe === true || p.accord_signe === 1,
        promotion: texte(p.promotion),
        priorite: texte(p.priorite),
        disponibilite: texte(p.disponible_2026_27),
        formation: texte(p.formation_instructeur),
        experience: texte(p.experience_animation),
        motivation: texte(p.motivation),
        etablissement:
          texte(p.etab_pressenti) === 'Non'
            ? 'Aucun établissement pressenti'
            : texte(p.etab_pressenti_nom),
        notes: texte(p.notes),
        telephone: texte(personne?.telephone),
        cp: texte(personne?.cp),
        region: texte(personne?.region),
        pratique: texte(p.pratique_personnelle),
        annees: texte(p.annees_experience),
        interventions: texte(p.interventions_animees),
        adresseEtablissement: [
          texte(p.etab_pressenti_adresse),
          texte(p.etab_pressenti_cp),
          texte(p.etab_pressenti_ville),
        ]
          .filter(Boolean)
          .join(' '),
        academie: texte(p.etab_pressenti_academie),
        typeEtablissement: texte(p.etab_pressenti_type),
        direction: texte(p.direction_nom),
        directionEmail: texte(p.direction_email),
        accordPrincipe: texte(p.accord_principe),
        contexte: texte(p.contexte_complement),
        consentement: p.consentement === true || p.consentement === 1,
      }
    })
    .sort((a, b) => b.date.localeCompare(a.date) || a.nom.localeCompare(b.nom, 'fr'))
}

export type SuiviFormateur = ReturnType<typeof construireSuiviFormateurs>[number]

export function filtrerFormateurs(
  lignes: SuiviFormateur[],
  nom: string,
  statut: string,
  alerte: string,
) {
  return lignes.filter(
    (l) =>
      normaliser(`${l.nom} ${l.ville}`).includes(normaliser(nom)) &&
      (!statut || l.statut === statut) &&
      (alerte === 'nouveaux'
        ? l.nouveau
        : alerte === 'anciens'
          ? l.ancien
          : alerte === 'examiner'
            ? l.aExaminer
            : true),
  )
}

export async function lireSuiviFormateurs(token: string) {
  const [personnes, parcours] = await Promise.all([
    lireToutes(token, 'formateurs', 'Id,nom,prenom,ville,email,profession,telephone,cp,region'),
    lireToutes(
      token,
      'engagements',
      'Id,statut,date_candidature,accord_signe,promotion,priorite,disponible_2026_27,formation_instructeur,experience_animation,motivation,etab_pressenti,etab_pressenti_nom,notes,pratique_personnelle,annees_experience,interventions_animees,etab_pressenti_adresse,etab_pressenti_cp,etab_pressenti_ville,etab_pressenti_academie,etab_pressenti_type,direction_nom,direction_email,accord_principe,contexte_complement,consentement',
    ),
  ])
  return construireSuiviFormateurs(personnes, parcours)
}
