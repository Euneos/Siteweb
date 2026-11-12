import { lireCartePublique } from '../src/lib/public-network'
const token = process.env.NOCODB_TOKEN
if (!token) throw new Error('Jeton absent')
try {
  const data = await lireCartePublique(token)
  console.log('Lecture publique OK :', data.locations.length, 'établissements,', data.trainerLocations.length, 'formateurs et personnes en formation')
} catch (error) {
  const message = error instanceof Error ? error.message : 'Erreur inconnue'
  console.log(message.startsWith('NocoDB ') ? message.match(/^NocoDB \d+/)?.[0] : message.replace(/#\d+/g, '#…'))
  process.exitCode = 1
}
