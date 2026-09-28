import { afterAll, describe, expect, test } from 'bun:test'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { imageFixture, sample, syntheticEntry } from './helpers/editorial-images'
import { saveEntry, getEntry } from '../src/lib/internal-workspace'
import { prepareEditorialImage, MAX_IMAGE_BYTES } from '../src/lib/editorial-image-format'
import {
  readImageBytes,
  readImageSlot,
  saveEditorialImage,
  cleanRetiredImages,
  imageKey,
} from '../src/lib/editorial-images'
import { GET, PUT, DELETE } from '../src/pages/api/interne/images'

const actor = { email: 'member@example.test', admin: false }
const { privateKey, publicKey } = await generateKeyPair('RS256')
const jwk = { ...(await exportJWK(publicKey)), kid: 'images-test', alg: 'RS256', use: 'sig' }
const access = {
  INTERNAL_ACCESS_DOMAIN: 'images-test.cloudflareaccess.com',
  INTERNAL_ACCESS_AUD: 'team',
}
const token = async (aud = 'team', exp = '5m') =>
  new SignJWT({ email: actor.email })
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
    .setIssuer(`https://${access.INTERNAL_ACCESS_DOMAIN}`)
    .setSubject('fixture')
    .setAudience(aud)
    .setExpirationTime(exp)
    .sign(privateKey)
const jwt = await token()
const fetchOriginal = globalThis.fetch
globalThis.fetch = async (input, init) =>
  String(input) === `https://${access.INTERNAL_ACCESS_DOMAIN}/cdn-cgi/access/certs`
    ? Response.json({ keys: [jwk] })
    : fetchOriginal(input, init)
afterAll(() => {
  globalThis.fetch = fetchOriginal
})
async function fixture(extra) {
  const data = imageFixture()
  const id = await saveEntry(data.db, actor, syntheticEntry(extra))
  const env = { ...access, TEAM_WORKSPACE: data.db, EDITORIAL_IMAGES: data.bucket }
  async function call(method = 'GET', { headers = {}, body, query = '', environment = env } = {}) {
    const request = new Request(
      `https://preview.example.test/api/interne/images?entryId=${id}${query}`,
      {
        method,
        headers: {
          'Cf-Access-Jwt-Assertion': jwt,
          ...(method !== 'GET'
            ? {
                Origin: 'https://preview.example.test',
                'If-Match': '"0"',
                'Content-Type': 'image/png',
              }
            : {}),
          ...headers,
        },
        ...(body ? { body } : {}),
      },
    )
    return { GET, PUT, DELETE }[method]({ request, locals: { runtime: { env: environment } } })
  }
  return { ...data, id, env, call }
}

describe('Images éditoriales privées', () => {
  test('migration non destructive, PNG/JPG persistants, URLs privées et anciennes URLs révoquées', async () => {
    const f = await fixture()
    const before = await getEntry(f.db, f.id)
    expect(await (await f.call()).json()).toEqual({ version: 0, image: null })
    const added = await (await f.call('PUT', { body: sample('png') })).json()
    expect(added.image.content_type).toBe('image/png')
    expect(added.image.width).toBe(640)
    const image = await f.call('GET', { query: `&imageId=${added.image.id}` })
    expect(image.status).toBe(200)
    expect(image.headers.get('Cache-Control')).toContain('no-store')
    expect(image.headers.get('Content-Disposition')).toBe('inline; filename="visuel.png"')
    expect(image.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(
      prepareEditorialImage(sample('png'), 'image/png').bytes,
    )
    const replaced = await (
      await f.call('PUT', {
        body: sample('jpg'),
        headers: { 'If-Match': '"1"', 'Content-Type': 'image/jpeg' },
      })
    ).json()
    expect(replaced.version).toBe(2)
    expect(f.objects.size).toBe(1)
    expect((await f.call('GET', { query: `&imageId=${added.image.id}` })).status).toBe(404)
    expect(
      (await f.call('GET', { query: `&imageId=${replaced.image.id}` })).headers.get('Content-Type'),
    ).toBe('image/jpeg')
    expect((await f.call('DELETE', { headers: { 'If-Match': '"2"' } })).status).toBe(200)
    expect(f.objects.size).toBe(0)
    expect((await f.call('GET', { query: `&imageId=${replaced.image.id}` })).status).toBe(404)
    expect((await f.call('PUT', { body: sample('png') })).status).toBe(409)
    expect(await getEntry(f.db, f.id)).toEqual(before)
    expect(f.sql.query('PRAGMA foreign_key_check').all()).toEqual([])
    f.sql.close()
  })
  test('anonyme, jeton expiré, mauvaise audience et formateur sont refusés avant D1/R2', async () => {
    const f = await fixture()
    const environment = {
      ...f.env,
      TEAM_WORKSPACE: {
        prepare() {
          throw new Error('Must not read')
        },
      },
      EDITORIAL_IMAGES: {
        get() {
          throw new Error('Must not read')
        },
      },
    }
    for (const bad of [
      '',
      'not-a-jwt',
      await token('trainers'),
      await token('another-team'),
      await token('team', 1),
    ])
      for (const method of ['GET', 'PUT', 'DELETE']) {
        const res = await f.call(method, {
          environment,
          headers: { 'Cf-Access-Jwt-Assertion': bad },
          query: `&imageId=${crypto.randomUUID()}`,
        })
        expect(res.status).toBe(403)
        expect(res.headers.get('Cache-Control')).toContain('no-store')
      }
    f.sql.close()
  })
  test('CSRF, précondition, fiche absente/équipe, absence de bucket ou migration', async () => {
    const f = await fixture()
    for (const headers of [
      { Origin: 'https://other.example.test' },
      { Origin: '' },
      { 'Sec-Fetch-Site': 'cross-site' },
    ])
      expect((await f.call('PUT', { headers, body: sample('png') })).status).toBe(403)
    expect((await f.call('PUT', { headers: { 'If-Match': '' }, body: sample('png') })).status).toBe(
      428,
    )
    expect(
      (await f.call('GET', { environment: { ...f.env, EDITORIAL_IMAGES: undefined } })).status,
    ).toBe(503)
    const team = await fixture({ kind: 'equipe', status: 'brouillon' })
    expect((await team.call()).status).toBe(403)
    expect((await team.call('PUT', { body: sample('png') })).status).toBe(403)
    f.sql.exec('DROP TABLE workspace_entry_images')
    expect((await f.call()).status).toBe(503)
    f.sql.exec('DELETE FROM workspace_entries')
    expect((await f.call()).status).toBe(404)
    f.sql.close()
    team.sql.close()
  })
  test('MIME trompeur, SVG, données tronquées, CRC, fichier vide ou trop gros refusés sans écriture', async () => {
    const f = await fixture()
    for (const [body, contentType] of [
      [new TextEncoder().encode('<svg/>'), 'image/png'],
      [sample('png'), 'image/jpeg'],
      [sample('jpg').subarray(0, 20), 'image/jpeg'],
      [sample('png'), 'image/svg+xml'],
      [new Uint8Array(), 'image/png'],
      [new Uint8Array(MAX_IMAGE_BYTES + 1), 'image/png'],
    ]) {
      expect(
        (await f.call('PUT', { body, headers: { 'Content-Type': contentType } })).status,
      ).toBeGreaterThanOrEqual(400)
    }
    const corrupt = sample('png')
    corrupt[30] ^= 1
    expect(() => prepareEditorialImage(corrupt, 'image/png')).toThrow()
    expect(f.objects.size).toBe(0)
    expect(f.sql.query('SELECT * FROM workspace_images').all()).toEqual([])
    // Body bounded even without Content-Length (chunked transfer).
    let cancelled = false
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024))
      },
      cancel() {
        cancelled = true
      },
    })
    await expect(
      readImageBytes(
        new Request('https://example.test', {
          method: 'PUT',
          body: stream,
          duplex: 'half',
          headers: { 'Content-Type': 'image/png' },
        }),
      ),
    ).rejects.toThrow('5 Mo')
    expect(cancelled).toBe(true)
    f.sql.close()
  })
  test('métadonnées JPEG retirées, pixels préservés', () => {
    const jpeg = sample('jpg')
    const metadata = new TextEncoder().encode('EXIF synthetic GPS fixture')
    const bytes = new Uint8Array(jpeg.length + metadata.length + 4)
    bytes.set(jpeg.subarray(0, 2))
    bytes.set([255, 225, 0, metadata.length + 2], 2)
    bytes.set(metadata, 6)
    bytes.set(jpeg.subarray(2), 6 + metadata.length)
    const normalized = prepareEditorialImage(bytes, 'image/jpeg')
    expect(new TextDecoder().decode(normalized.bytes)).not.toContain('synthetic GPS')
    expect(normalized.bytes).toEqual(prepareEditorialImage(jpeg, 'image/jpeg').bytes)
  })
  test('PNG : texte retiré, animation et dimensions excessives refusées', () => {
    const png = sample('png')
    const chunk = (type, data) => {
      const bytes = Buffer.alloc(data.length + 12)
      bytes.writeUInt32BE(data.length, 0)
      bytes.write(type, 4)
      bytes.set(data, 8)
      let crc = 0xffffffff
      for (const b of bytes.subarray(4, -4)) {
        crc ^= b
        for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
      }
      bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, bytes.length - 4)
      return bytes
    }
    const inject = (type, data) =>
      Buffer.concat([png.subarray(0, 33), chunk(type, data), png.subarray(33)])
    const withText = inject('tEXt', Buffer.from('Comment\0Synthetic private metadata'))
    expect(prepareEditorialImage(withText, 'image/png').bytes).toEqual(
      prepareEditorialImage(png, 'image/png').bytes,
    )
    expect(() => prepareEditorialImage(inject('acTL', Buffer.alloc(8)), 'image/png')).toThrow(
      'non animée',
    )
    const ihdr = Buffer.from(png.subarray(16, 29))
    ihdr.writeUInt32BE(12001, 0)
    expect(() =>
      prepareEditorialImage(
        Buffer.concat([png.subarray(0, 8), chunk('IHDR', ihdr), png.subarray(33)]),
        'image/png',
      ),
    ).toThrow('trop grande')
    ihdr.writeUInt32BE(6000, 0)
    ihdr.writeUInt32BE(6000, 4)
    expect(() =>
      prepareEditorialImage(
        Buffer.concat([png.subarray(0, 8), chunk('IHDR', ihdr), png.subarray(33)]),
        'image/png',
      ),
    ).toThrow('trop grande')
  })
  test('concurrence : une seule écriture gagne et aucune image active n’est effacée', async () => {
    const f = await fixture()
    const prepared = prepareEditorialImage(sample('png'), 'image/png')
    const results = await Promise.allSettled([
      saveEditorialImage(f.db, f.bucket, f.id, 0, prepared),
      saveEditorialImage(f.db, f.bucket, f.id, 0, prepared),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.find((r) => r.status === 'rejected').reason.status).toBe(409)
    const current = await readImageSlot(f.db, f.id)
    expect(f.objects.has(imageKey(current.image.id))).toBe(true)
    expect(f.objects.size).toBe(1)
    expect((await f.call('DELETE', { headers: { 'If-Match': '"0"' } })).status).toBe(409)
    f.sql.close()
  })
  test('pannes R2 et D1 ambiguës conservent l’ancien ou le nouveau visuel confirmé', async () => {
    const f = await fixture()
    await f.call('PUT', { body: sample('png') })
    const old = await readImageSlot(f.db, f.id)
    f.bucket.failPut = true
    expect(
      (
        await f.call('PUT', {
          body: sample('jpg'),
          headers: { 'If-Match': '"1"', 'Content-Type': 'image/jpeg' },
        })
      ).status,
    ).toBe(503)
    expect(await readImageSlot(f.db, f.id)).toEqual(old)
    f.bucket.failPut = false
    const ambiguous = {
      prepare(query) {
        const statement = f.db.prepare(query)
        return {
          bind(...values) {
            const bound = statement.bind(...values)
            if (!query.startsWith('UPDATE workspace_entry_images')) return bound
            return {
              ...bound,
              async first() {
                await bound.first()
                throw new Error('Lost D1 response after commit')
              },
            }
          },
        }
      },
    }
    await expect(
      saveEditorialImage(
        ambiguous,
        f.bucket,
        f.id,
        1,
        prepareEditorialImage(sample('jpg'), 'image/jpeg'),
      ),
    ).rejects.toThrow()
    const latest = await readImageSlot(f.db, f.id)
    expect(latest.version).toBe(2)
    expect(f.objects.has(imageKey(latest.image.id))).toBe(true)
    f.bucket.failDelete = true
    const removed = await (await f.call('DELETE', { headers: { 'If-Match': '"2"' } })).json()
    expect(removed.cleanupComplete).toBe(false)
    expect((await f.call('GET', { query: `&imageId=${latest.image.id}` })).status).toBe(404)
    f.bucket.failDelete = false
    expect(await cleanRetiredImages(f.db, f.bucket)).toBe(true)
    expect(f.objects.size).toBe(0)
    expect(f.sql.query("SELECT * FROM workspace_images WHERE state='pending'").all()).toHaveLength(
      1,
    )
    f.sql.close()
  })
})
