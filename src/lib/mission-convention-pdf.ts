import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import source from '../content/convention-mission-modele.txt?raw'
import type { MissionPayload } from './mission-convention'

const model = source.replace(/\r\n/g, '\n')
const article = (n: number) => {
  const start = model.indexOf(`ARTICLE ${n} —`)
  const end = n === 14 ? model.indexOf('FICHE RÉCAPITULATIVE', start) : model.indexOf(`ARTICLE ${n + 1} —`, start)
  if (start < 0 || end < 0) throw new Error(`Article ${n} absent du modèle`)
  return model.slice(start, end).trim()
}
const before = (text: string, marker: string) => {
  const index = text.indexOf(marker)
  if (index < 0) throw new Error(`Marqueur absent du modèle : ${marker}`)
  return text.slice(0, index).trim()
}
const after = (text: string, marker: string) => {
  const index = text.indexOf(marker)
  if (index < 0) throw new Error(`Marqueur absent du modèle : ${marker}`)
  return text.slice(index).trim()
}
const lines = (text: string) => text.replace(/\r/g, '').split('\n').map(s => s.trim()).filter(Boolean)

/** The source clauses are copied verbatim, with only blank template tables and the
 * old email/PDF exchange instructions replaced by the verified mission details. */
export function contractText(data: MissionPayload, representative: string, case2Euros: number, fees: string = 'Aucun frais complémentaire autorisé') {
  const countCase1 = data.missions.filter(m => m.cas1 === 'oui').length
  const total = data.missions.length * 1000 + countCase1 * 200 + case2Euros
  const schools = data.missions.map(m => m.etablissement).join(', ')
  const trainingDates = [...new Set(data.missions.flatMap(m => m.sessions.map(s => s.date)))].sort().join(', ')
  const invoicing = before(article(12), 'La présente convention complétée doit être retournée')
    .replace('[nom(s) de(s) établissement(s)]', schools).replace('[dates]', trainingDates)
  const sections: string[] = [
    'CONVENTION DE MISSION — FORMATEUR·RICE WISE-UP',
    `Référence du modèle EUNEOS 2026-2027. Montant prévisionnel : ${total} € hors frais autorisés.`,
    'ARTICLE 1 — PARTIES À LA CONVENTION',
    'EUNEOS — Association loi 1901 d’intérêt général. SIREN 105 557 425 ; SIRET 105 557 425 00011 ; RNA W313042230 ; APE 94.99Z. Siège social : Immeuble Le Phénix, Bâtiment B, 118 Route d’Espagne, 31100 Toulouse.',
    `Représentée par : ${representative}.`,
    `Formateur·rice : ${data.nom}. Statut / structure : ${data.structure}. SIRET / identification : ${data.identification}. Adresse professionnelle : ${data.adresse}. E-mail : ${data.email}. Téléphone : ${data.telephone}.`,
    before(article(2), 'Établissement\n'),
    ...data.missions.flatMap((m, i) => [
      `Mission ${i + 1} — Établissement : ${m.etablissement}. Adresse : ${m.adresse}. Direction : ${m.direction}. Référent : ${m.referent}. Contact professionnel : ${m.contact}.`,
    ]),
    before(article(3), '☐ 100 %'),
    'La formation entièrement à distance n’est pas autorisée.',
    ...data.missions.flatMap((m, i) => [
      `Établissement ${i + 1} : ${m.etablissement} — ${m.format === 'hybride' ? '8 h sur site + 8 h en visioconférence' : '16 h sur site'}.`,
      ...m.sessions.map((s, j) => `Session ${j + 1} : ${s.date}, ${s.heure}–${String((Number(s.heure.slice(0, 2)) + 2) % 24).padStart(2, '0')}${s.heure.slice(2)} ; 2 h ; ${s.modalite === 'distance' ? 'visioconférence' : 'présentiel'}.`),
    ]),
    ...[4, 5, 6].flatMap(n => lines(article(n))),
    before(article(7), 'Situation(s) applicable(s)'),
    ...data.missions.map(m => `${m.etablissement} — Cas 1 : ${m.cas1 === 'oui' ? `oui, classe ${m.classe}, ateliers 4 h : ${m.ateliers}` : 'non'}. Cas 2 : ${m.cas2 === 'non' ? 'non' : `${m.cas2} h, période ${m.periodeCas2}, autorisation ${m.accordCas2}`}.`),
    after(article(7), 'Le cas 2 intervient notamment'),
    ...[8, 9].flatMap(n => lines(article(n))),
    before(article(10), 'Formation WISE-UP 16 h'),
    `${data.missions.length} formation(s) × 1 000 € = ${data.missions.length * 1000} €. Cas 1 : ${countCase1} × 200 € = ${countCase1 * 200} €. Cas 2 : ${case2Euros} € validés par EUNEOS. TOTAL PRÉVISIONNEL : ${total} € hors frais autorisés.`,
    before(article(11), 'Frais remboursables autorisés'),
    `Frais remboursables autorisés par EUNEOS : ${fees}.`,
    ...lines(invoicing),
    ...[13, 14].flatMap(n => lines(article(n))),
    'SIGNATURES — Convention prenant effet à sa date de signature.',
    `POUR EUNEOS — ${representative}. Date : ______________. Mention : « Bon pour accord ». Signature :`,
    `LE/LA FORMATEUR·RICE — ${data.nom}. Date : ______________. Mention : « Lu et approuvé — Bon pour accord ». Signature :`,
    'VISA DE L’ÉTABLISSEMENT — FACULTATIF. Ce visa atteste uniquement de la prise de connaissance du calendrier et des conditions pratiques de la mission. Il ne crée pas de relation financière directe entre l’établissement et le/la Formateur·rice.',
    'Établissement : ______________. Nom / fonction : ______________. Date / cachet : ______________.',
  ]
  return sections.filter(Boolean)
}

export async function generateContractPdf(data: MissionPayload, representative: string, case2Euros: number, fontBytes: ArrayBuffer | Uint8Array, fees?: string) {
  const document = await PDFDocument.create()
  document.registerFontkit(fontkit)
  const font = await document.embedFont(fontBytes, { subset: true })
  const regular = await document.embedFont(StandardFonts.Helvetica)
  const ink = rgb(0, 0.22, 0.18)
  const maxWidth = 505
  let page = document.addPage([595, 842])
  let y = 800
  for (const [index, paragraph] of contractText(data, representative, case2Euros, fees).entries()) {
    const size = index === 0 ? 15 : paragraph.startsWith('ARTICLE ') || paragraph.startsWith('SIGNATURES') ? 11 : 9
    const words = paragraph.split(/\s+/)
    let line = ''
    const draw = (value: string) => {
      if (y < 55) { page = document.addPage([595, 842]); y = 800 }
      page.drawText(value, { x: 45, y, font, size, color: ink, maxWidth })
      y -= size + 4
    }
    for (const word of words) {
      const next = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(next, size) > maxWidth && line) { draw(line); line = word }
      else line = next
    }
    if (line) draw(line)
    y -= paragraph.startsWith('ARTICLE ') ? 9 : 5
    if (paragraph.startsWith('POUR EUNEOS') || paragraph.startsWith('LE/LA FORMATEUR')) y -= 48
  }
  const pages = document.getPages()
  pages.forEach((p, i) => p.drawText(`EUNEOS — Convention de mission WISE-UP — ${i + 1} / ${pages.length}`, {
    x: 45, y: 28, font: regular, size: 8, color: ink,
  }))
  return document.save()
}
