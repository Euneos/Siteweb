import type { Entry } from '../lib/internal-workspace'
import type { ImageSlot } from '../lib/editorial-images'
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
  prepareEditorialImage,
} from '../lib/editorial-image-format'

export function initEditorialImage() {
  const get = <T extends HTMLElement>(name: string) =>
    document.getElementById(`iw-image-${name}`) as T
  const section = document.getElementById('iw-images')!
  const status = get('status')
  const file = get<HTMLInputElement>('file')
  const stored = get<HTMLImageElement>('stored')
  const preview = get<HTMLImageElement>('preview')
  const buttons = ['refresh', 'upload', 'cancel', 'remove', 'confirm-remove', 'keep'] as const
  const button = (name: (typeof buttons)[number]) => get<HTMLButtonElement>(name)
  let entry: Entry | null = null,
    slot: ImageSlot | null = null
  let pending: Blob | null = null,
    previewUrl = '',
    busy = false,
    generation = 0
  let blocking = false
  let readController: AbortController | null = null
  const message = (text: string) => {
    status.textContent = text
  }
  const url = () => `/api/interne/images?entryId=${encodeURIComponent(entry!.id)}`
  function controls() {
    file.disabled = busy || !entry || !slot
    for (const name of buttons) button(name).disabled = busy || !entry
    button('upload').disabled = busy || !slot
    button('upload').hidden = !pending
    button('cancel').hidden = !pending
    button('remove').hidden = !slot?.image
    button('upload').textContent = slot?.image ? 'Remplacer le visuel' : 'Ajouter le visuel'
    button('refresh').hidden = !entry
  }
  function clearPending() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    previewUrl = ''
    pending = null
    file.value = ''
    preview.removeAttribute('src')
    get('pending').hidden = true
    controls()
  }
  function renderSlot() {
    get('current').hidden = !slot?.image
    if (slot?.image) {
      stored.src = `${url()}&imageId=${encodeURIComponent(slot.image.id)}`
      get('details').textContent = `${slot.image.width} × ${slot.image.height} px`
    } else stored.removeAttribute('src')
    get('confirm').hidden = true
    controls()
  }
  async function responseJson(
    response: Response,
  ): Promise<ImageSlot & { cleanupComplete?: boolean }> {
    const data = await response.json().catch(() => null)
    if (!response.ok)
      throw new Error(
        data?.error ?? 'Accès indisponible. Reconnectez-vous puis actualisez le visuel.',
      )
    if (!data || !Number.isSafeInteger(data.version) || !('image' in data))
      throw new Error('Le résultat ne peut pas être confirmé. Actualisez le visuel.')
    return data
  }
  async function refresh() {
    if (!entry || busy) return
    const current = generation
    readController?.abort()
    readController = new AbortController()
    busy = true
    controls()
    message('Chargement du visuel…')
    try {
      const result = await responseJson(
        await fetch(url(), { cache: 'no-store', signal: readController.signal }),
      )
      if (current !== generation) return
      slot = result
      renderSlot()
      message(
        result.image
          ? 'Le visuel enregistré est partagé avec l’équipe.'
          : 'Aucun visuel enregistré.',
      )
    } catch (error) {
      if (current !== generation) return
      slot = null
      message((error as Error).message)
    } finally {
      if (current === generation) {
        busy = false
        controls()
      }
    }
  }
  file.addEventListener('change', async () => {
    const selected = file.files?.[0]
    clearPending()
    if (!selected) return
    if (!['image/png', 'image/jpeg'].includes(selected.type) || selected.size > MAX_IMAGE_BYTES) {
      message('Choisissez une image PNG ou JPG de 5 Mo maximum.')
      return
    }
    busy = true
    blocking = true
    controls()
    message('Préparation de l’aperçu…')
    let bitmap: ImageBitmap | undefined
    try {
      // Reject oversized dimensions before asking the browser to allocate pixels.
      prepareEditorialImage(new Uint8Array(await selected.arrayBuffer()), selected.type)
      bitmap = await createImageBitmap(selected)
      const { width, height } = bitmap
      if (width * height > MAX_IMAGE_PIXELS || width > 12000 || height > 12000)
        throw new Error(
          'Image trop grande : 24 millions de pixels et 12 000 pixels par côté maximum.',
        )
      // Normalize orientation and remove embedded metadata before sending pixels.
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
      const normalized = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, selected.type, 0.92),
      )
      canvas.width = canvas.height = 0
      if (!normalized || normalized.size > MAX_IMAGE_BYTES)
        throw new Error('L’image préparée dépasse 5 Mo. Réduisez ses dimensions puis réessayez.')
      pending = normalized
      previewUrl = URL.createObjectURL(pending)
      preview.src = previewUrl
      get('pending').hidden = false
      get('confirm').hidden = true
      message(
        slot?.image
          ? 'Vérifiez l’aperçu puis confirmez le remplacement. Le visuel enregistré est conservé jusque-là.'
          : 'Vérifiez l’aperçu puis ajoutez le visuel.',
      )
    } catch (error) {
      message(
        error instanceof Error && error.name === 'Error'
          ? error.message
          : 'Cette image ne peut pas être lue. Choisissez un PNG ou JPG valide.',
      )
    } finally {
      bitmap?.close()
      blocking = false
      busy = false
      controls()
    }
  })
  async function mutate(method: 'PUT' | 'DELETE') {
    if (!entry || !slot || busy || (method === 'PUT' && !pending)) return
    busy = true
    blocking = true
    controls()
    get('confirm').hidden = true
    message(method === 'PUT' ? 'Enregistrement du visuel…' : 'Suppression du visuel…')
    try {
      const result = await responseJson(
        await fetch(url(), {
          method,
          headers: {
            'If-Match': `"${slot.version}"`,
            ...(pending && method === 'PUT' ? { 'Content-Type': pending.type } : {}),
          },
          ...(method === 'PUT' ? { body: pending } : {}),
        }),
      )
      slot = result
      if (method === 'PUT') clearPending()
      renderSlot()
      message(
        (method === 'PUT' ? 'Visuel enregistré.' : 'Visuel retiré de la fiche.') +
          (result.cleanupComplete === false
            ? ' Le nettoyage du stockage sera retenté lors d’une prochaine modification.'
            : ''),
      )
    } catch (error) {
      // Never retry a write automatically after a lost response or a conflict.
      slot = null
      message(
        `${(error as Error).message} Actualisez le visuel avant de réessayer. Votre sélection est conservée.`,
      )
    } finally {
      blocking = false
      busy = false
      controls()
      ;(slot ? file : button('refresh')).focus()
    }
  }
  button('upload').addEventListener('click', () => void mutate('PUT'))
  button('refresh').addEventListener('click', () => void refresh())
  button('cancel').addEventListener('click', () => {
    clearPending()
    message('Sélection annulée.')
    file.focus()
  })
  button('remove').addEventListener('click', () => {
    get('confirm').hidden = false
    button('confirm-remove').focus()
  })
  button('keep').addEventListener('click', () => {
    get('confirm').hidden = true
    button('remove').focus()
  })
  button('confirm-remove').addEventListener('click', () => void mutate('DELETE'))
  stored.addEventListener('error', () =>
    message('L’aperçu enregistré est indisponible. Reconnectez-vous puis actualisez le visuel.'),
  )
  return {
    isDirty: () => !!pending,
    isBusy: () => blocking,
    close() {
      readController?.abort()
      generation++
      entry = null
      slot = null
      busy = false
      clearPending()
      stored.removeAttribute('src')
    },
    open(value: Entry | null, kind: Entry['kind']) {
      readController?.abort()
      generation++
      busy = false
      entry = value
      slot = null
      clearPending()
      renderSlot()
      section.hidden = kind !== 'editorial'
      message('Enregistrez la fiche pour y ajouter un visuel.')
      if (value && kind === 'editorial') void refresh()
    },
    saved(value: Entry) {
      if (!entry && value.kind === 'editorial') {
        entry = value
        void refresh()
      }
    },
  }
}
