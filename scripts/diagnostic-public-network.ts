import { lireReseauEtablissements } from '../src/lib/reseau-etablissements'
import { lireCartePubliqueFormateurs } from '../src/lib/reseau-formateurs'
import { readMapData } from '../src/lib/map'
const token = process.env.NOCODB_TOKEN
if (!token) throw new Error('Jeton absent')
for (const [name, read] of Object.entries({etablissements:lireReseauEtablissements, formateurs:lireCartePubliqueFormateurs, candidatures:readMapData})) {
  try {
    await read(token)
    console.log(name, 'OK')
  } catch (error) {
    // Only the error category: no NocoDB response body, token or personal rows.
    const message = error instanceof Error ? error.message : 'Erreur inconnue'
    console.log(name, message.startsWith('NocoDB ') ? message.match(/^NocoDB \d+/)?.[0] : message.replace(/#\d+/g, '#…'))
    process.exitCode = 1
  }
}
