import { WorkspaceError } from './internal-workspace'

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_IMAGE_PIXELS = 24_000_000
const invalid = (): never => {
  throw new WorkspaceError(415, 'Choisissez une image PNG ou JPG valide, non animée.')
}
function dimensions(width: number, height: number) {
  if (!width || !height || width > 12000 || height > 12000 || width * height > MAX_IMAGE_PIXELS)
    throw new WorkspaceError(
      413,
      'Image trop grande : 24 millions de pixels et 12 000 pixels par côté maximum.',
    )
  return { width, height }
}
function join(parts: Uint8Array[]) {
  const bytes = new Uint8Array(parts.reduce((n, part) => n + part.length, 0))
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return bytes
}
const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  let value = byte
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  return value >>> 0
})
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]
  return (crc ^ 0xffffffff) >>> 0
}
/** Structural validation, pixel limits and metadata removal at the origin.
 * Browser decoding is also required before upload. Never trust file names/MIME alone. */
export function prepareEditorialImage(bytes: Uint8Array, contentType: string) {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES)
    throw new WorkspaceError(413, 'Choisissez une image de 5 Mo maximum.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (contentType === 'image/png') {
    if (![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) invalid()
    const parts = [bytes.subarray(0, 8)]
    let offset = 8,
      width = 0,
      height = 0,
      data = false,
      ended = false
    while (offset + 12 <= bytes.length) {
      const size = view.getUint32(offset),
        end = offset + 12 + size
      if (end > bytes.length) invalid()
      const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
      if (crc32(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4)) invalid()
      if (offset === 8 && type !== 'IHDR') invalid()
      if (type === 'IHDR') {
        if (offset !== 8 || size !== 13) invalid()
        width = view.getUint32(offset + 8)
        height = view.getUint32(offset + 12)
        dimensions(width, height)
      }
      if (type === 'acTL') invalid()
      if (type === 'IDAT' && size > 0) data = true
      if (type === 'IEND') {
        if (size !== 0 || !data || end !== bytes.length) invalid()
        ended = true
      }
      // Discard text, EXIF, timestamps and arbitrary ancillary metadata.
      if (['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'sRGB', 'gAMA', 'cHRM'].includes(type))
        parts.push(bytes.subarray(offset, end))
      else if (!/^[a-z][A-Za-z]{3}$/.test(type)) invalid()
      offset = end
    }
    if (!ended) invalid()
    return { bytes: join(parts), contentType, width, height }
  }
  if (contentType !== 'image/jpeg' || bytes[0] !== 255 || bytes[1] !== 216) invalid()
  const parts = [bytes.subarray(0, 2)]
  let offset = 2,
    width = 0,
    height = 0,
    scan = false
  while (offset < bytes.length) {
    const start = offset
    if (bytes[offset++] !== 255) invalid()
    while (bytes[offset] === 255) offset++
    const marker = bytes[offset++]
    if (marker === 217) {
      if (!width || !scan || offset !== bytes.length) invalid()
      parts.push(bytes.subarray(start, offset))
      return { bytes: join(parts), contentType, width, height }
    }
    if (offset + 2 > bytes.length) invalid()
    const length = view.getUint16(offset),
      end = offset + length
    if (length < 2 || end > bytes.length) invalid()
    // Baseline/extended/progressive DCT JPEG only.
    if ([192, 193, 194].includes(marker)) {
      if (length < 8 || width) invalid()
      height = view.getUint16(offset + 3)
      width = view.getUint16(offset + 5)
      dimensions(width, height)
    }
    // APPn and COM may carry names, GPS, EXIF, XMP or embedded thumbnails.
    if (!(marker >= 224 && marker <= 239) && marker !== 254) parts.push(bytes.subarray(start, end))
    offset = end
    if (marker === 218) {
      if (!width) invalid()
      scan = true
      const scanStart = offset
      while (offset < bytes.length) {
        if (bytes[offset] !== 255) {
          offset++
          continue
        }
        const next = bytes[offset + 1]
        if (next === 0 || (next >= 208 && next <= 215)) {
          offset += 2
          continue
        }
        if (next === 255) {
          offset++
          continue
        }
        break
      }
      if (offset === scanStart) invalid()
      parts.push(bytes.subarray(scanStart, offset))
    }
  }
  return invalid()
}
