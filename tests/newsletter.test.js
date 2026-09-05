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

async function submit(profil, config = env) {
  const form = new FormData()
  Object.entries({ nom: 'Test', email: 'test@example.com', profil, retour: '/newsletter' })
    .forEach(([key, value]) => form.set(key, value))
  return POST({
    request: new Request('https://euneos.fr/api/newsletter', {
      method: 'POST', body: form, headers: { origin: 'https://euneos.fr' },
    }),
    locals: { runtime: { env: config } },
    redirect: (url, status = 302) => new Response(null, { status, headers: { Location: url } }),
  })
}

for (const [profil, id] of [['etablissement', 3], ['partenaire', 4], ['formateur', 6]]) {
  test(`newsletter ${profil} : bonne liste et confirmation`, async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    const response = await submit(profil)
    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toBe('/newsletter?nl=confirmation#inscription')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.brevo.com/v3/contacts/doubleOptinConfirmation')
    const body = JSON.parse(String(options?.body))
    expect(body.includeListIds).toEqual([id])
    expect(body.excludeListIds).not.toContain(id)
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
