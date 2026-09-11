import { afterEach, expect, spyOn, test } from 'bun:test'
import { POST } from '../src/pages/api/newsletter'

const env = {
  BREVO_API_KEY: 'test-only',
  BREVO_LIST_ETABLISSEMENT: '3',
  BREVO_LIST_PARTENAIRE: '4',
  BREVO_LIST_FORMATEUR: '6',
  BREVO_DOI_TEMPLATE_ID: '6',
}
const fetchMock = spyOn(globalThis, 'fetch')
afterEach(() => fetchMock.mockReset())

async function submit(profil, config = env, options = {}) {
  const form = new FormData()
  Object.entries({ nom: 'Test', email: 'test@example.com', profil, retour: '/newsletter' })
    .forEach(([key, value]) => form.set(key, value))
  return POST({
    request: new Request(options.url ?? 'https://euneos.fr/api/newsletter', {
      method: 'POST', body: form, headers: { origin: options.origin ?? 'https://euneos.fr', ...(options.json ? { accept: 'application/json' } : {}) },
    }),
    locals: { runtime: { env: config } },
    redirect: (url, status = 302) => new Response(null, { status, headers: { Location: url } }),
  })
}

for (const [profil, id] of [['etablissement', 3], ['partenaire', 4], ['formateur', 6]]) {
  test(`newsletter ${profil} : bonne liste et confirmation`, async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const response = await submit(profil)
    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toBe('/newsletter?nl=confirmation#inscription')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url, options] = fetchMock.mock.calls[1]
    expect(url).toBe('https://api.brevo.com/v3/contacts/doubleOptinConfirmation')
    const body = JSON.parse(String(options?.body))
    expect(body.includeListIds).toEqual([id])
    expect(body.excludeListIds).toBeUndefined()
    expect(body.templateId).toBe(6)
    expect(body.redirectionUrl).toBe('https://euneos.fr/newsletter?nl=confirme#inscription')
  })
}

test('liste formateurs manquante : pas de faux succès ni de requête Brevo', async () => {
  const response = await submit('formateur', { ...env, BREVO_LIST_FORMATEUR: '' })
  expect(response.headers.get('Location')).toContain('nl=indisponible')
  expect(fetchMock).not.toHaveBeenCalled()
})

test('ancien profil curieux : refusé sans requête Brevo', async () => {
  const response = await submit('curieux')
  expect(response.headers.get('Location')).toContain('nl=profil')
  expect(fetchMock).not.toHaveBeenCalled()
})

for (const current of [3, 4, 6]) {
  for (const requested of ['etablissement', 'formateur', 'partenaire']) {
    test(`profil confirmé ${current} : inscription ${requested} bloquée sans envoi ni modification`, async () => {
      fetchMock.mockResolvedValueOnce(Response.json({ listIds: [2, current] }))
      const response = await submit(requested)
      expect(response.headers.get('Location')).toContain('nl=deja-inscrit')
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0][0]).toBe('https://api.brevo.com/v3/contacts/test%40example.com')
      expect(fetchMock.mock.calls[0][1]?.body).toBeUndefined()
    })
  }
}

test('contact CRM hors des trois listes : inscription autorisée', async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ listIds: [2, 5] }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
  const response = await submit('etablissement')
  expect(response.headers.get('Location')).toContain('nl=confirmation')
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

for (const status of [401, 429, 500]) {
  test(`lecture Brevo ${status} : aucun envoi et aucune modification`, async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status }))
    const response = await submit('partenaire')
    expect(response.headers.get('Location')).toContain('nl=technique')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
}

test('réponse contact invalide : aucun envoi', async () => {
  fetchMock.mockResolvedValueOnce(Response.json({}))
  const response = await submit('formateur')
  expect(response.headers.get('Location')).toContain('nl=technique')
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

for (const [profil, list] of [['etablissement', 3], ['partenaire', 4], ['formateur', 6]]) {
  test(`envoi JSON ${profil} : confirmation sans redirection et liste correcte`, async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const response = await submit(profil, env, { json: true })
    expect(response.status).toBe(200)
    expect(response.headers.get('Location')).toBeNull()
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ state: 'confirmation' })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).includeListIds).toEqual([list])
  })
}

test('JSON : profil déjà confirmé préservé sans renvoi du mail', async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ listIds: [4] }))
  const response = await submit('formateur', env, { json: true })
  expect(await response.json()).toEqual({ state: 'deja-inscrit' })
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

test('JSON : erreur de profil exploitable sur place', async () => {
  const response = await submit('inconnu', env, { json: true })
  expect(response.status).toBe(400)
  expect(await response.json()).toEqual({ state: 'profil' })
  expect(fetchMock).not.toHaveBeenCalled()
})

test('JSON : configuration absente sans faux succès', async () => {
  const response = await submit('partenaire', {}, { json: true })
  expect(response.status).toBe(503)
  expect(await response.json()).toEqual({ state: 'indisponible' })
  expect(fetchMock).not.toHaveBeenCalled()
})

test('JSON : panne Brevo signalée sans nouvelle tentative', async () => {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }))
  const response = await submit('partenaire', env, { json: true })
  expect(response.status).toBe(503)
  expect(await response.json()).toEqual({ state: 'technique' })
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

test('JSON : preview sans aucun envoi Brevo', async () => {
  const response = await submit('partenaire', env, {
    json: true, url: 'https://pr-test.euneos-site.pages.dev/api/newsletter',
    origin: 'https://pr-test.euneos-site.pages.dev',
  })
  expect(await response.json()).toEqual({ state: 'confirmation', preview: true })
  expect(fetchMock).not.toHaveBeenCalled()
})

test('JSON : origine tierce toujours refusée', async () => {
  const response = await submit('partenaire', env, { json: true, origin: 'https://example.com' })
  expect(response.status).toBe(403)
  expect(fetchMock).not.toHaveBeenCalled()
})
