/**
 * Scans und Fotos (JPEG/PNG/WebP/GIF) als PDF-Seite öffnen: das Bild wird auf
 * eine A4-Seite (hoch oder quer, je nach Seitenverhältnis) eingepasst.
 */
import { PDFDocument } from 'pdf-lib'

import type { LoadedImage } from '@/lib/image'

/** A4 in Punkten. */
const A4 = { width: 595.28, height: 841.89 }
/** Längste Bildseite beim Import (≈ 300 dpi auf A4). */
export const SCAN_MAX_SIDE = 3600

/** Erkennt Bilddateien am Typ oder an den ersten Bytes (JPEG, PNG, WebP, GIF). */
export function looksLikeImage(type: string, bytes: Uint8Array): boolean {
  if (/^image\/(png|jpeg|webp|gif)$/.test(type)) return true
  const b = (i: number) => bytes[i] ?? -1
  return (
    (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) || // JPEG
    (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) || // PNG
    (b(0) === 0x47 && b(1) === 0x49 && b(2) === 0x46) || // GIF
    (b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50) // WebP
  )
}

/** Bildtyp anhand der Endung, falls der Browser keinen MIME-Typ liefert. */
export function imageTypeOf(file: File): string {
  if (file.type) return file.type
  const ext = file.name.toLowerCase().split('.').pop() ?? ''
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
  }
  return map[ext] ?? ''
}

function dataUrlBytes(dataUrl: string): { bytes: Uint8Array; jpeg: boolean } {
  const match = /^data:(image\/(?:png|jpeg));base64,(.*)$/s.exec(dataUrl)
  if (!match?.[2]) throw new Error('Unerwartetes Bildformat.')
  const bin = atob(match[2])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { bytes, jpeg: match[1] === 'image/jpeg' }
}

/** Baut eine einseitige PDF (A4) mit dem Bild, seitenverhältnistreu eingepasst. */
export async function imageToPdf(image: LoadedImage): Promise<Uint8Array> {
  const { bytes, jpeg } = dataUrlBytes(image.dataUrl)
  const doc = await PDFDocument.create()
  const embedded = jpeg ? await doc.embedJpg(bytes) : await doc.embedPng(bytes)
  const landscape = image.width > image.height
  const page = doc.addPage(landscape ? [A4.height, A4.width] : [A4.width, A4.height])
  const { width: pw, height: ph } = page.getSize()
  const scale = Math.min(pw / image.width, ph / image.height)
  const w = image.width * scale
  const h = image.height * scale
  page.drawImage(embedded, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h })
  return doc.save()
}
