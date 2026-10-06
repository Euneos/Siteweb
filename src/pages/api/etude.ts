import type { APIRoute } from 'astro'
import pdf from '../../assets/etude-europeenne.base64?raw'
import { brevoEnv } from '../../lib/brevo'
import { modeApercu } from '../../lib/forms'
import { studyEmail, studySubscriber } from '../../lib/study-access'

export const prerender = false
export const GET: APIRoute = async ({ request, locals }) => {
  const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' }
  const env = brevoEnv(locals)
  if (modeApercu(request) || !env.BREVO_API_KEY) return new Response('Téléchargement indisponible.', { status: 503, headers })
  const email = await studyEmail(new URL(request.url).searchParams.get('token') ?? '', env.BREVO_API_KEY)
  if (!email) return new Response('Inscrivez-vous pour recevoir l’étude. Ce lien est invalide ou a expiré.', { status: 403, headers })
  try {
    if (!await studySubscriber(email, env)) return new Response('Confirmez votre inscription avec le lien reçu par e-mail avant de télécharger l’étude.', { status: 403, headers })
  } catch {
    return new Response('La vérification est momentanément indisponible. Réessayez plus tard.', { status: 503, headers })
  }
  const bytes = Uint8Array.from(atob(pdf.trim()), char => char.charCodeAt(0))
  return new Response(bytes, { headers: { ...headers, 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="etude-europeenne-euneos.pdf"', 'X-Content-Type-Options': 'nosniff' } })
}
