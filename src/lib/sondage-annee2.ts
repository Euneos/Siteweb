export const surveyTitle = 'Poursuivre WISE-UP dans votre établissement'
export const surveyThanks =
  'Merci d’avoir pris le temps de répondre à ce questionnaire. Vos retours nous aideront à construire avec vous les suites de WISE-UP, au plus près des besoins de votre établissement.'
export type SurveyQuestion = {
  key: string
  label: string
  description?: string
  section: string
  type: 'text' | 'email' | 'textarea' | 'radio' | 'checkbox' | 'ranking'
  choices?: string[]
  required?: boolean
  when?: string
  other?: boolean
  maxChoices?: number
  exclusive?: string[]
}
const yesMaybe = ['Oui.', 'Peut-être.', 'Non.', 'À vérifier avec l’équipe.']
export const surveyQuestions: SurveyQuestion[] = [
  ...[
    ['school', 'Nom de l’établissement'],
    ['city', 'Ville'],
    ['name', 'Votre nom et votre fonction'],
    ['email', 'Adresse e-mail de contact'],
  ].map(([key, label]): SurveyQuestion => ({
    key,
    label,
    section: '1. Votre établissement',
    type: key === 'email' ? 'email' : 'text',
    required: true,
  })),
  {
    key: 'needs',
    section: '2. Les besoins à approfondir',
    label:
      'Après cette première année, quels besoins ou sujets souhaiteriez-vous approfondir avec votre équipe ou vos élèves ?',
    type: 'textarea',
  },
  {
    key: 'activities',
    section: '3. Les activités que vous aimeriez mettre en place',
    label:
      'Classez les propositions de 1 à 7 dans votre ordre décroissant d’intérêt : 1 correspond à celle qui vous intéresse le plus.',
    type: 'ranking',
    other: true,
    choices: [
      'Permettre à des membres du personnel déjà formés d’animer les huit ateliers de 50 minutes avec les élèves.',
      'Former de nouveaux membres du personnel au programme WISE-UP.',
      'Organiser une projection-débat avec les familles.',
      'Organiser une conférence-rencontre avec un artiste ou un expert.',
      'Accompagner un projet porté par les élèves.',
      'Organiser un atelier réunissant élèves et familles.',
      'Autre',
    ],
  },
  {
    key: 'activityStatus',
    section: '3. Les activités que vous aimeriez mettre en place',
    label: 'Si vous ne souhaitez pas classer les activités pour le moment :',
    type: 'radio',
    choices: [
      'Nous n’envisageons pas de suite pour le moment.',
      'Nous souhaitons en discuter avant de nous prononcer.',
    ],
  },
  {
    key: 'training',
    section: '4. Permettre à l’équipe déjà formée d’animer les ateliers',
    label:
      'Des membres de votre équipe ayant suivi les 16 heures de formation seraient-ils intéressés par une formation complémentaire de quatre heures pour animer eux-mêmes les huit ateliers de 50 minutes avec les élèves ?',
    type: 'radio',
    choices: [
      'Oui.',
      'Peut-être, nous avons besoin d’informations.',
      'Non.',
      'À vérifier avec l’équipe.',
    ],
  },
  {
    key: 'trainingCount',
    section: '4. Permettre à l’équipe déjà formée d’animer les ateliers',
    label: 'Combien de personnes pourraient être intéressées ? (Nombre approximatif / À préciser)',
    type: 'text',
    when: 'training',
  },
  {
    key: 'format',
    section: '4. Permettre à l’équipe déjà formée d’animer les ateliers',
    label: 'Quel format conviendrait le mieux ?',
    type: 'radio',
    choices: ['À distance.', 'Dans l’établissement.', 'Pas de préférence.', 'À discuter.'],
    when: 'training',
  },
  {
    key: 'newTraining',
    section: '5. Élargir la formation à d’autres membres du personnel',
    label:
      'Au-delà de l’équipe déjà formée, souhaiteriez-vous que d’autres membres du personnel bénéficient de la formation WISE-UP ?',
    type: 'radio',
    choices: yesMaybe,
  },
  {
    key: 'newCount',
    section: '5. Élargir la formation à d’autres membres du personnel',
    label: 'Combien de personnes pourraient être concernées ? (Nombre approximatif / À préciser)',
    type: 'text',
    when: 'newTraining',
  },
  {
    key: 'students',
    section: '6. Impliquer davantage les élèves',
    label: 'Comment aimeriez-vous impliquer davantage les élèves ?',
    type: 'checkbox',
    other: true,
    choices: [
      'Élèves ambassadeurs.',
      'Création d’un podcast.',
      'Réalisation d’une exposition.',
      'Organisation d’un débat.',
      'Campagne de sensibilisation.',
      'Élaboration d’une charte des usages numériques.',
      'Autre',
    ],
  },
  {
    key: 'families',
    section: '7. Mobiliser les familles',
    label: 'Quelle proposition vous semblerait la plus adaptée pour mobiliser les familles ?',
    type: 'radio',
    other: true,
    choices: [
      'Une projection-débat.',
      'Une conférence avec un temps d’échange.',
      'Un atelier parents-enfants.',
      'Une présentation des projets des élèves.',
      'Autre',
      'Nous souhaitons être accompagnés pour identifier une proposition.',
      'Ce n’est pas une priorité actuellement.',
    ],
  },
  {
    key: 'priority',
    section: '8. Votre priorité et le soutien nécessaire',
    label: 'Parmi les pistes évoquées pour mobiliser les élèves et leurs familles, quelle serait votre priorité ?',
    description: '(Élèves ambassadeurs, podcast, exposition, débat, campagne de sensibilisation, charte des usages numériques, projection-débat, conférence, atelier parents-enfants, présentation des projets des élèves ou autre proposition.)',
    type: 'textarea',
  },
  {
    key: 'support',
    section: '8. Votre priorité et le soutien nécessaire',
    label: 'De quel soutien auriez-vous besoin pour avancer ?',
    type: 'checkbox',
    other: true,
    choices: [
      'Un échange pour préciser le projet.',
      'Des outils et supports prêts à utiliser.',
      'Une formation complémentaire.',
      'L’intervention d’un formateur ou d’un intervenant.',
      'Une aide à l’organisation et au calendrier.',
      'Un appui pour mobiliser l’équipe ou la direction.',
      'Des précisions sur les moyens nécessaires et les conditions de prise en charge.',
      'Autre',
      'Nous ne savons pas encore.',
    ],
    exclusive: ['Nous ne savons pas encore.'],
  },
  {
    key: 'contact',
    section: '9. Garder le contact',
    label: 'Souhaitez-vous être recontacté pour échanger sur les suites possibles ?',
    type: 'radio',
    choices: ['Oui.', 'Pas pour le moment.'],
  },
  {
    key: 'remarks',
    section: '9. Garder le contact',
    label: 'Avez-vous une autre remarque ou une question ?',
    type: 'textarea',
  },
]
export const interested = (value: unknown) =>
  typeof value === 'string' && (value === 'Oui.' || value.startsWith('Peut-être'))
export function parseSurvey(value: unknown): Record<string, string | string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Vérifiez vos réponses.')
  const input = value as Record<string, unknown>,
    answers: Record<string, string | string[]> = {}
  const keys = surveyQuestions.flatMap((q) => (q.other ? [q.key, `${q.key}Other`] : [q.key]))
  if (Object.keys(input).some((key) => !keys.includes(key)))
    throw new Error('Champ inconnu. Rechargez le formulaire.')
  for (const q of surveyQuestions) {
    if (q.when && !interested(input[q.when])) continue
    const raw = input[q.key] ?? (q.type === 'checkbox' || q.type === 'ranking' ? [] : '')
    if (q.type === 'checkbox' || q.type === 'ranking') {
      if (
        !Array.isArray(raw) ||
        raw.some((v) => typeof v !== 'string' || !q.choices!.includes(v)) ||
        new Set(raw).size !== raw.length
      )
        throw new Error(`Vérifiez : ${q.label}`)
      if (q.maxChoices && raw.length > q.maxChoices)
        throw new Error('Choisissez au maximum trois activités.')
      if (raw.length > 1 && q.exclusive?.some((v) => raw.includes(v)))
        throw new Error('Les réponses sans choix d’activité doivent être sélectionnées seules.')
      answers[q.key] = raw
    } else {
      if (
        typeof raw !== 'string' ||
        raw.length > (q.type === 'textarea' ? 5000 : 300) ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw)
      )
        throw new Error(`Vérifiez : ${q.label}`)
      const text = raw.trim()
      if (
        (q.required && !text) ||
        (text && q.choices && !q.choices.includes(text)) ||
        (q.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text))
      )
        throw new Error(`Vérifiez : ${q.label}`)
      answers[q.key] = text
    }
    if (q.other && (Array.isArray(raw) ? raw.includes('Autre') : raw === 'Autre')) {
      const other = input[`${q.key}Other`]
      if (typeof other !== 'string' || !other.trim() || other.length > 2000)
        throw new Error('Précisez votre réponse « Autre ».')
      answers[`${q.key}Other`] = other.trim()
    }
  }
  if (answers.activityStatus && (answers.activities as string[]).length)
    throw new Error('Choisissez un classement ou une réponse sans classement, pas les deux.')
  return answers
}
