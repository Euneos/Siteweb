import { expect, test } from 'bun:test'
import { runInNewContext } from 'node:vm'
import { CONTACT_HELPERS, patchContactScript } from '../scripts/prepare-contact-patch.mjs'

const helpers = () => {
  const context = { _normaliser: value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim() }
  runInNewContext(CONTACT_HELPERS, context)
  return context
}
test('contact school name is independent of the order of similarly named questions', () => {
  const h = helpers()
  const wrong = [
    ["D'autres établissements seront-ils regroupés avec le vôtre pour cette formation ?", ['Non']],
    ["Type d'établissement", ['Collège']],
    ["Je confirme les informations de l'établissement", ['Oui, je confirme']],
  ]
  for (let position = 0; position <= wrong.length; position++) {
    const entries = [...wrong]
    entries.splice(position, 0, ["Nom de l'établissement", ['Collège Test']])
    expect(h._ficheChamp({ namedValues: Object.fromEntries(entries) }, "Nom de l'établissement", true)).toBe('Collège Test')
  }
})
test('missing or duplicate school labels cannot fall back to another answer or a position', () => {
  const h = helpers()
  expect(() => h._ficheChamp({ values: ['', '', 'Wrong'], namedValues: { "Type d'établissement": ['Collège'] } }, "Nom de l'établissement", true)).toThrow()
  expect(() => h._ficheChamp({ values: ['', '', 'Wrong'] }, "Nom de l'établissement", true)).toThrow()
  expect(() => h._ficheChamp({ namedValues: { "Nom de l'établissement": ['First'], "Nom de l’établissement ": ['Second'] } }, "Nom de l'établissement", true)).toThrow()
})
test('optional empty fields stay empty and accents, apostrophes and trailing spaces are normalized', () => {
  const h = helpers()
  expect(h._ficheChamp({ namedValues: { ' NOM DE L’ÉTABLISSEMENT  ': ['École Test'] } }, "Nom de l'établissement", true)).toBe('École Test')
  expect(h._ficheChamp({ namedValues: {}, values: Array(30).fill('Wrong') }, 'Date prévisionnelle de début de la formation')).toBe('')
})
test('contact matching refuses duplicate exact names, ambiguous partial names and empty names', () => {
  const h = helpers()
  const sheet = names => ({ getLastRow: () => names.length + 1, getRange: () => ({ getValues: () => names.map(name => [name]) }) })
  expect(h._ficheLigneParNom(sheet(['Collège Test', 'Collège Test']), 1, 'Collège Test')).toBe(-1)
  expect(h._ficheLigneParNom(sheet(['Collège Test Nord', 'Collège Test Sud']), 1, 'Collège Test')).toBe(-1)
  expect(h._ficheLigneParNom(sheet(['', 'Collège Test']), 1, 'Collège Test')).toBe(3)
  expect(h._ficheLigneParNom(sheet(['Collège Test']), 1, '')).toBe(-1)
  expect(h._ficheLigneParNom(sheet(['Collège Test', 'Collège Test Nord']), 1, 'Collège Test')).toBe(2)
})
test('patch preparation refuses an unreviewed or already patched export', () => {
  expect(() => patchContactScript('function onFicheContactEtab(e) {}')).toThrow('Source changed')
})
