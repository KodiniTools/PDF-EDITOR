/** Bilddateien einlesen (Bild einfügen): PNG/JPEG direkt, andere Formate und sehr große Bilder per Canvas. */
import { t } from '@/i18n'

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
/** Längste Seite in Pixeln; größere Fotos werden verkleinert (Speicher, Exportgröße). */
export const MAX_IMAGE_SIDE = 2400
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'

export interface LoadedImage {
  /** PNG- oder JPEG-Data-URL (pdf-lib bettet nur diese ein). */
  dataUrl: string
  width: number
  height: number
}

export class ImageError extends Error {
  override name = 'ImageError'
}

/** Skaliert (w, h) so, dass die längste Seite höchstens `max` ist. */
export function fitWithin(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/**
 * Platzierung auf der Seite (Anzeige-Koordinaten in pt): höchstens 40 % der
 * Seitenbreite bzw. 50 % der Höhe, Seitenverhältnis bleibt, zentriert.
 */
export function placeOnPage(
  natural: { width: number; height: number },
  page: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const ratio = natural.height / natural.width
  let width = Math.min(page.width * 0.4, natural.width)
  let height = width * ratio
  if (height > page.height * 0.5) {
    height = page.height * 0.5
    width = height / ratio
  }
  return { x: (page.width - width) / 2, y: (page.height - height) / 2, width, height }
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Lesefehler'))
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new ImageError(t('error.imageUnreadable')))
    img.src = src
  })
}

/** @param maxSide längste Seite in Pixeln, größere Bilder werden verkleinert. */
export async function readImageFile(
  file: File,
  maxSide: number = MAX_IMAGE_SIDE,
): Promise<LoadedImage> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
    throw new ImageError(t('error.imageTypeUnsupported'))
  }
  if (file.size > MAX_IMAGE_BYTES) throw new ImageError(t('error.imageTooLarge'))
  const source = await readAsDataUrl(file)
  const img = await loadImage(source)
  const natural = { width: img.naturalWidth || 1, height: img.naturalHeight || 1 }
  const direct = file.type === 'image/png' || file.type === 'image/jpeg'
  if (direct && Math.max(natural.width, natural.height) <= maxSide) {
    return { dataUrl: source, ...natural }
  }
  // Umwandeln bzw. verkleinern; JPEG bleibt JPEG, sonst PNG (Transparenz).
  const size = fitWithin(natural.width, natural.height, maxSide)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new ImageError(t('error.imageProcessFailed'))
  ctx.drawImage(img, 0, 0, size.width, size.height)
  const dataUrl =
    file.type === 'image/jpeg' ? canvas.toDataURL('image/jpeg', 0.9) : canvas.toDataURL('image/png')
  return { dataUrl, ...size }
}
