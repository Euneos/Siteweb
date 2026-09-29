import { expect, test } from 'bun:test'
import { mapGoogleSheetRowVerified as map } from '../src/lib/google-form-sheet'
import { digest, validateGoogleFormPayload } from '../src/lib/google-form-sync'
import { futureSheet } from './fixtures/google-future'

test('current contact has no dates or adults; raw retired columns remain present', async () => {
  const f = await futureSheet(),
    e = await map(f)
  expect(e.version).toBe(2)
  expect(e.formation.start).toBe('')
  expect(e.formation.end).toBe('')
  expect(e.participants).toBe('')
  expect(e.declaration).toEqual({ evaluationInterest: { answer: 'Non', level: '' } })
  expect(e.sheetSnapshot.values).toEqual(f.values)
  expect(validateGoogleFormPayload({ event: e }).unmapped).toBe(false)
})
test('removed question filled again and unknown columns cannot be silently projected', async () => {
  const f = await futureSheet()
  f.values[8] = '01/10/2026'
  let e = await map(f)
  expect(e.sheetSnapshot.unmappedColumns).toEqual([9])
  expect(validateGoogleFormPayload({ event: e }).unmapped).toBe(true)
  f.values[8] = ''
  f.headers.push('Question inconnue')
  f.values.push('Réponse conservée')
  await expect(map(f)).rejects.toThrow('sheet_headers_changed')
  f.policy.headerDigest = await digest(JSON.stringify(f.headers))
  e = await map(f)
  expect(e.sheetSnapshot.unmappedColumns).toEqual([16])
})
test('audited source-only answers remain explicit deferred declarations with full content', async () => {
  const f = await futureSheet()
  f.values[14] = ' Déclaration\nconservée intégralement '
  const e = await map(f)
  expect(e.sheetSnapshot.deferredColumns).toEqual([15])
  expect(e.sheetSnapshot.values[14]).toBe(f.values[14])
  expect(validateGoogleFormPayload({ event: e })).toMatchObject({ unmapped: false, deferred: true })
})
test('duplicate confirmation requires occurrence AND absolute column under pinned headers', async () => {
  const f = await futureSheet('deploiement')
  expect((await map(f)).declaration).toEqual({ preformation: 'Je vais le faire' })
  const selector = f.policy.confirmations[0].header as {
    label: string
    occurrence: number
    column?: number
  }
  delete selector.column
  await expect(map(f)).rejects.toThrow('sheet_header_position_required')
  selector.column = 12
  await expect(map(f)).rejects.toThrow('sheet_header_position_invalid')
  selector.column = 16
  f.values[11] = 'Non'
  await expect(map(f)).rejects.toThrow('sheet_confirmation_conflict')
})
test('all nine duplicated labels need explicit positions, with no first/last fallback', async () => {
  const f = await futureSheet('deploiement')
  for (let i = 0; i < 8; i++) {
    const label = `Question dupliquée ${i}`,
      first = f.headers.length + 1
    f.headers.push(label, label)
    f.values.push('', 'Valeur déclarée')
    f.policy.emptyOnly!.push({ label, occurrence: 1, column: first })
    f.policy.captureOnly!.push({ label, occurrence: 2, column: first + 1 })
  }
  f.policy.headerDigest = await digest(JSON.stringify(f.headers))
  const e = await map(f)
  expect(e.sheetSnapshot.unmappedColumns).toEqual([])
  expect(e.sheetSnapshot.deferredColumns).toHaveLength(8)
  f.headers.reverse()
  f.values.reverse()
  await expect(map(f)).rejects.toThrow('sheet_headers_changed')
})
test('uncertain confirmations, choices and partial dates require review, never fabricated defaults', async () => {
  const f = await futureSheet('deploiement')
  f.values[15] = 'Une chaîne non vide'
  await expect(map(f)).rejects.toThrow('sheet_confirmation_missing')
  f.values[15] = 'Oui, je confirme'
  f.values[8] = '06/10/2026'
  await expect(map(f)).rejects.toThrow('dates_invalid')
  f.values[9] = '07/10/2026'
  expect((await map(f)).formation).toMatchObject({ start: '2026-10-06', end: '2026-10-07' })
  f.values[12] = 'Peut-être'
  await expect(map(f)).rejects.toThrow('preformation_invalid')
})
test('scientific level required on Oui only; Google non-conditional extra answer retained for review', async () => {
  const f = await futureSheet()
  f.values[12] = 'Oui'
  await expect(map(f)).rejects.toThrow('evaluation_level_required')
  f.values[13] = '6e'
  expect((await map(f)).declaration?.evaluationInterest?.level).toBe('6e')
  f.values[12] = 'Non'
  const e = await map(f)
  expect(e.declaration?.evaluationInterest?.level).toBe('6e')
  expect(validateGoogleFormPayload({ event: e }).deferred).toBe(true)
})

test('published ASCII apostrophe choice is canonized explicitly, raw source unchanged', async () => {
  const f = await futureSheet()
  const googleChoice = "Je ne sais pas, j'ai besoin de plus d'information"
  f.values[12] = googleChoice
  const e = await map(f)
  expect(e.declaration?.evaluationInterest?.answer).toBe(
    'Je ne sais pas, j’ai besoin de plus d’information',
  )
  expect(e.sheetSnapshot.values[12]).toBe(googleChoice)
  expect(validateGoogleFormPayload({ event: e }).unmapped).toBe(false)
  f.values[12] = 'Besoin de plus d’informations peut-être'
  await expect(map(f)).rejects.toThrow('evaluation_invalid')
})

test('multiple preformation choices and a populated retired deployment question require review', async () => {
  const f = await futureSheet('deploiement')
  f.values[12] = 'Oui, Non'
  await expect(map(f)).rejects.toThrow('preformation_invalid')
  f.values[12] = 'Oui'
  delete f.mapping.participants
  f.policy.emptyOnly!.push('Participants')
  f.values[10] = 'Contenu sous une ancienne question retirée'
  const e = await map(f)
  expect(e.participants).toBe('')
  expect(e.sheetSnapshot.unmappedColumns).toEqual([11])
  expect(e.sheetSnapshot.values[10]).toBe(f.values[10])
  expect(validateGoogleFormPayload({ event: e }).unmapped).toBe(true)
})
