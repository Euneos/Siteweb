import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// Reviewed export of SyncFormulaires.gs. A changed source requires a new review.
export const SOURCE_SHA256 = 'c596cd7f6c875e71b4662fa8ddac6da7db0ebcba1087f83fadac16e08ebad062'
export const sha256 = text => createHash('sha256').update(text).digest('hex')

export const CONTACT_HELPERS = `
// Contact form only: exact question labels, never object order or positions.
function _ficheLabel(value) {
  return String(value || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')
    .toLowerCase().replace(/[’']/g, ' ').replace(/\\*/g, '').replace(/\\s+/g, ' ').trim();
}
function _ficheChamp(e, label, required) {
  if (!e || !e.namedValues || Array.isArray(e.namedValues)) throw new Error('Fiche contact : namedValues requis.');
  var target = _ficheLabel(label);
  var keys = Object.keys(e.namedValues).filter(function (key) { return _ficheLabel(key) === target; });
  if (keys.length > 1) throw new Error('Fiche contact : question ambigue : ' + label);
  var raw = keys.length ? e.namedValues[keys[0]] : '';
  var value = String(Array.isArray(raw) ? raw.join(', ') : raw || '').trim();
  if (required && !value) throw new Error('Fiche contact : question manquante : ' + label);
  return value;
}
function _ficheLigneParNom(sh, colNom, nom) {
  if (!nom || sh.getLastRow() < 2) return -1;
  var target = _normaliser(nom);
  if (!target) return -1;
  var exact = [], partial = [];
  var values = sh.getRange(2, colNom, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    var name = _normaliser(values[i][0]);
    if (!name) continue;
    if (name === target) exact.push(i + 2);
    else if (name.indexOf(target) >= 0 || target.indexOf(name) >= 0) partial.push(i + 2);
  }
  // In the old helper, the first exact match won even when two rows matched.
  if (exact.length) return exact.length === 1 ? exact[0] : -1;
  return partial.length === 1 ? partial[0] : -1;
}
`

const oldFields = `    var nomEtab   = _champ(e, ['etablissement', 'établissement'], 2);
    var dateDebut = _champ(e, ['date de debut', 'date de début'], 12);
    var dateFin   = _champ(e, ['date de fin'], 13);
    var nbClasses = _champ(e, ['nombre de classes', 'nb classes'], 16);
    var nbEleves  = _champ(e, ['nombre d eleves', "nombre d'élèves", 'nb eleves'], 17);
    var formateur = _champ(e, ['formateur'], 20);`
const newFields = `    var nomEtab   = _ficheChamp(e, "Nom de l'établissement", true);
    var dateDebut = _ficheChamp(e, 'Date prévisionnelle de début de la formation');
    var dateFin   = _ficheChamp(e, 'Date prévisionnelle de fin de la formation');
    var nbClasses = _ficheChamp(e, "Combien de classes vont bénéficier des activités à l' issu de la formation?");
    var nbEleves  = _ficheChamp(e, "Nombre d'élèves concernés total*");
    var formateur = _ficheChamp(e, 'Formateur formation adultes (nom + email)');`

export function patchContactScript(source) {
  if (sha256(source) !== SOURCE_SHA256) throw new Error('Source changed: compare the current export before preparing this patch')
  const start = source.indexOf('function onFicheContactEtab(e) {')
  const end = source.indexOf('\nfunction ', start + 1)
  if (start < 0 || end < 0) throw new Error('Contact handler boundary missing')
  let handler = source.slice(start, end)
  const replacements = [
    [oldFields, newFields],
    ['    var lE   = cNom ? _ligneParNom(shE, cNom, nomEtab) : -1;', '    var lE   = cNom ? _ficheLigneParNom(shE, cNom, nomEtab) : -1;'],
  ]
  for (const [before, after] of replacements) {
    if (handler.split(before).length !== 2) throw new Error('Expected one contact handler fragment')
    handler = handler.replace(before, after)
  }
  return source.slice(0, start) + CONTACT_HELPERS + '\n' + handler + source.slice(end)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output] = process.argv.slice(2)
  if (!input || !output) throw new Error('Usage: bun scripts/prepare-contact-patch.mjs <current-export.gs> <new-output.gs>')
  const result = patchContactScript(readFileSync(input, 'utf8'))
  // Local artifact only. Never upload, run Apps Script, or overwrite a file.
  writeFileSync(output, result, { mode: 0o600, flag: 'wx' })
  console.log(JSON.stringify({ sourceSha256: SOURCE_SHA256, outputSha256: sha256(result), remoteWrites: 0 }))
}
