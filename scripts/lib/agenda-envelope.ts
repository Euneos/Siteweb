import {
  constants,
  createCipheriv,
  createDecipheriv,
  publicEncrypt,
  privateDecrypt,
  randomBytes,
} from 'node:crypto'
export function sealAgenda(value: unknown, publicKey: string) {
  const key = randomBytes(32),
    iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv),
    data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return {
    v: 1,
    key: publicEncrypt(
      { key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      key,
    ).toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  }
}
export function openAgenda(envelope: unknown, privateKey: string): unknown {
  if (!envelope || typeof envelope !== 'object') throw new Error('Enveloppe invalide')
  const e = envelope as Record<string, unknown>
  if (e.v !== 1 || ['key', 'iv', 'tag', 'data'].some((k) => typeof e[k] !== 'string'))
    throw new Error('Enveloppe invalide')
  const key = privateDecrypt(
      { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      Buffer.from(e.key as string, 'base64'),
    ),
    decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(e.iv as string, 'base64'))
  decipher.setAuthTag(Buffer.from(e.tag as string, 'base64'))
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(e.data as string, 'base64')),
      decipher.final(),
    ]).toString('utf8'),
  )
}
