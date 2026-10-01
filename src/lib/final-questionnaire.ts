import { emailValide } from './forms'
import { OperationalLinkError } from './operational-links'
import type { FinalQuestionnaireDefinition } from './final-questionnaire-definition'

export type FinalQuestionnaireAnswers = Record<string, string | string[]>
const invalid = () =>
  new OperationalLinkError(
    400,
    'champs',
    'Vérifiez les champs obligatoires et les choix du formulaire.',
  )
export function parseFinalQuestionnaire(
  def: FinalQuestionnaireDefinition,
  value: unknown,
): FinalQuestionnaireAnswers {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid()
  const fields = value as Record<string, unknown>,
    answers: FinalQuestionnaireAnswers = {}
  const allowed = def.questions.map((q) => q.key)
  if (Object.keys(fields).some((k) => !allowed.includes(k))) throw invalid()
  for (const q of def.questions) {
    const raw = fields[q.key] ?? (q.type === 'checkbox' ? [] : '')
    if (q.type === 'checkbox') {
      if (
        !Array.isArray(raw) ||
        (q.required && !raw.length) ||
        raw.length > q.choices.length ||
        raw.some((v) => typeof v !== 'string' || !q.choices.includes(v)) ||
        new Set(raw).size !== raw.length
      )
        throw invalid()
      answers[q.key] = q.choices.filter((choice) => raw.includes(choice))
      continue
    }
    if (
      typeof raw !== 'string' ||
      raw.length > q.maxLength ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw)
    )
      throw invalid()
    let text = raw.normalize('NFC').trim().replace(/\r\n?/g, '\n')
    if ((q.required && !text) || (q.type !== 'textarea' && /[\n\t]/.test(text))) throw invalid()
    if (['radio', 'select', 'scale'].includes(q.type) && text && !q.choices.includes(text))
      throw invalid()
    if (q.key === 'email') {
      text = text.toLowerCase()
      if (!emailValide(text)) throw invalid()
    }
    if (q.key === 'year') {
      text = text.replace(/[–—]/g, '-')
      if (!/^20\d{2}-20\d{2}$/.test(text) || Number(text.slice(5)) !== Number(text.slice(0, 4)) + 1)
        throw invalid()
    }
    answers[q.key] = text
  }
  return answers
}
