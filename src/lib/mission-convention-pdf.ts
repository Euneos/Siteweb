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

/** The source clauses are copied verbatim apart from blank template tables,
 * the old email exchange and the optional school visa (not a contracting party). */
export function contractText(data: MissionPayload, representative: string, case2Euros: number, fees: string = 'Aucun frais complémentaire autorisé') {
  const countCase1 = data.missions.filter(m => m.cas1 === 'oui').length
  const total = data.missions.length * 1000 + countCase1 * 200 + case2Euros
  const schools = data.missions.map(m => m.etablissement).join(', ')
  const dates = [...new Set(data.missions.flatMap(m => m.sessions.map(s => s.date)))].sort()
  const trainingDates = dates.join(', ')
  const invoicing = before(article(12), 'La présente convention complétée doit être retournée')
    .replace('[nom(s) de(s) établissement(s)]', schools).replace('[dates]', trainingDates)
  const sections: string[] = [
    'CONVENTION DE MISSION — FORMATEUR·RICE WISE-UP',
    'Wellness Integration and Smart Education for Understanding and Prevention',
    `Référence du modèle EUNEOS 2026-2027. Montant prévisionnel : ${total} € hors frais autorisés.`,
    'ARTICLE 1 — PARTIES À LA CONVENTION',
    'EUNEOS — Association loi 1901 d’intérêt général. SIREN : 105 557 425 ; SIRET : 105 557 425 00011 ; RNA : W313042230 ; APE : 94.99Z - Autres organisations fonctionnant par adhésion volontaire ; ESS : Oui. Siège social : Immeuble Le Phénix, Bâtiment B, 118 Route d’Espagne, 31100 Toulouse. Fondée en avril 2026 — active au SIRENE depuis le 19 mai 2026.',
    `Représentée par : ${representative}.`,
    `Formateur·rice : ${data.nom}. Statut / structure : ${data.structure}. SIRET / identification : ${data.identification}. Adresse professionnelle : ${data.adresse}. E-mail : ${data.email}. Téléphone : ${data.telephone}.`,
    before(article(2), 'Établissement\n'),
    ...data.missions.flatMap((m, i) => [
      `Mission ${i + 1} — Établissement : ${m.etablissement}. Adresse : ${m.adresse}. Direction : ${m.direction}. Référent : ${m.referent}. Contact professionnel : ${m.contact}.`,
    ]),
    before(article(3), '☐ 100 %').replace('2 heures(autres', '2 heures (autres'),
    'La formation entièrement à distance n’est pas autorisée.',
    ...data.missions.flatMap((m, i) => [
      `Établissement ${i + 1} : ${m.etablissement} — ${m.sessions.filter(s => s.modalite === 'presentiel').reduce((sum, s) => sum + s.duree, 0)} h sur site + ${m.sessions.filter(s => s.modalite === 'distance').reduce((sum, s) => sum + s.duree, 0)} h en visioconférence.`,
      ...m.sessions.map((s, j) => `Séance ${j + 1} : ${s.date} ; ${s.duree} h ; ${s.modalite === 'distance' ? 'visioconférence' : 'présentiel'}.`),
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
    'FICHE RÉCAPITULATIVE DE LA MISSION',
    `Formateur·rice : ${data.nom}. Établissement(s) : ${schools}.`,
    ...data.missions.map(m => `${m.etablissement} — Référent : ${m.referent} ; contact : ${m.contact}. Format : ${m.sessions.filter(s => s.modalite === 'presentiel').reduce((sum, s) => sum + s.duree, 0)} h en présentiel + ${m.sessions.filter(s => s.modalite === 'distance').reduce((sum, s) => sum + s.duree, 0)} h à distance. Cas 1 : ${m.cas1 === 'oui' ? `oui, classe ${m.classe}, ateliers 4 h : ${m.ateliers}` : 'non'}. Cas 2 : ${m.cas2 === 'non' ? 'non' : `${m.cas2} h, période ${m.periodeCas2}, autorisation ${m.accordCas2}`}.`),
    `Période des séances : du ${dates[0]} au ${dates.at(-1)}.`,
    `Montant formation(s) : ${data.missions.length} × 1 000 € = ${data.missions.length * 1000} €. Cas 1 — atelier(s) 4 h : ${countCase1} × 200 € = ${countCase1 * 200} €. Cas 2 — formation aux ateliers : ${case2Euros} € validés par EUNEOS.`,
    `Frais autorisés : ${fees}. Total prévisionnel : ${total} € hors frais autorisés.`,
    'SIGNATURES — Convention prenant effet à sa date de signature.',
    `POUR EUNEOS — ${representative}. Date : ______________. Mention : « Bon pour accord ». Signature :`,
    `LE/LA FORMATEUR·RICE — ${data.nom}. Date : ______________. Mention : « Lu et approuvé — Bon pour accord ». Signature :`,
  ]
  return sections.filter(Boolean)
}

export async function generateContractPdf(data: MissionPayload, representative: string, case2Euros: number, fontBytes: ArrayBuffer | Uint8Array, fees?: string) {
  const document = await PDFDocument.create()
  document.registerFontkit(fontkit)
  const font = await document.embedFont(fontBytes, { subset: true })
  const footerFont = await document.embedFont(StandardFonts.Helvetica)
  const ink = rgb(0, 0.22, 0.18)
  const margin = 52
  const maxWidth = 595 - margin * 2
  const bottom = 66
  let page = document.addPage([595, 842])
  const white = rgb(1, 1, 1)
  const paintPage = () => page.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: white })
  paintPage()
  let y = 786
  const newPage = () => {
    page = document.addPage([595, 842])
    paintPage()
    y = 786
  }
  const wrap = (text: string, size: number, width: number) => {
    const result: string[] = []
    let line = ''
    for (const word of text.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(candidate, size) <= width) { line = candidate; continue }
      if (line) { result.push(line); line = '' }
      // Long identifiers (e.g. email addresses) must never overflow the page.
      for (const character of word) {
        if (font.widthOfTextAtSize(line + character, size) > width && line) {
          result.push(line)
          line = ''
        }
        line += character
      }
    }
    if (line) result.push(line)
    return result
  }
  const blocks = contractText(data, representative, case2Euros, fees)
    .flatMap(text => text.split(/\n+/))
    .map(text => text.trim())
    .filter(Boolean)
    .map((text, index) => {
      const kind = index === 0 ? 'title'
        : index === 1 ? 'subtitle'
        : text.startsWith('Référence du modèle') ? 'reference'
        : /^(ARTICLE \d+ —|FICHE RÉCAPITULATIVE|SIGNATURES —)/.test(text) ? 'heading'
        : text.startsWith('* ') ? 'bullet'
        : /^(POUR EUNEOS —|LE\/LA FORMATEUR·RICE —)/.test(text) ? 'signature'
        : 'body'
      const size = kind === 'title' ? 16 : kind === 'heading' ? 12 : kind === 'reference' || kind === 'subtitle' ? 9.5 : 10.25
      const leading = kind === 'title' ? 22 : kind === 'heading' ? 17 : 15
      const indent = kind === 'bullet' ? 16 : 0
      const display = kind === 'bullet' ? `• ${text.slice(2)}` : text
      return { kind, size, leading, indent, lines: wrap(display, size, maxWidth - indent) }
    })
  blocks.forEach((block, index) => {
    const top = block.kind === 'heading' ? 17 : 0
    const after = block.kind === 'title' ? 4 : block.kind === 'subtitle' ? 15
      : block.kind === 'heading' ? 9 : block.kind === 'bullet' ? 6 : 12
    const signatureSpace = block.kind === 'signature' ? 48 : 0
    const next = blocks[index + 1]
    const keepWithNext = block.kind === 'heading' && next
      ? Math.min(next.lines.length, 2) * next.leading + (next.kind === 'signature' ? 48 : 0) + 12
      : 0
    const required = top + block.lines.length * block.leading + after + signatureSpace + keepWithNext
    if (y - required < bottom && y < 786) newPage()
    y -= top
    for (const line of block.lines) {
      if (y - block.leading < bottom) newPage()
      page.drawText(line, { x: margin + block.indent, y, font, size: block.size, color: ink })
      y -= block.leading
    }
    if (block.kind === 'heading') {
      page.drawLine({ start: { x: margin, y: y + 4 }, end: { x: margin + 70, y: y + 4 }, thickness: 1, color: ink })
    }
    y -= after + signatureSpace
  })
  const pages = document.getPages()
  pages.forEach((p, i) => p.drawText(`EUNEOS — Convention de mission WISE-UP — ${i + 1} / ${pages.length}`, {
    x: margin, y: 33, font: footerFont, size: 8, color: ink,
  }))
  return document.save()
}
