/**
 * Unicode-Schriften für Text außerhalb von WinAnsi (z. B. Kroatisch/Bosnisch:
 * č, ć, đ). DejaVu-Teilmengen (Latein inkl. Latin Extended-A), lizenziert siehe
 * LICENSE.txt. Nur im privaten Build; das Modul wird bei Bedarf geladen.
 */
import fontkit from '@pdf-lib/fontkit'
import type { PDFDocument, PDFFont } from 'pdf-lib'

import type { StandardFontFamily } from '@/types/pdf'

import sansBoldUrl from './DejaVuSansBold.ttf?inline'
import monoUrl from './DejaVuSansMono.ttf?inline'
import sansUrl from './DejaVuSans.ttf?inline'
import serifUrl from './DejaVuSerif.ttf?inline'

export type UnicodeFace = StandardFontFamily | 'sans-bold'

const DATA_URLS: Record<UnicodeFace, string> = {
  sans: sansUrl,
  'sans-bold': sansBoldUrl,
  serif: serifUrl,
  mono: monoUrl,
}

const bytesCache = new Map<UnicodeFace, Uint8Array>()

function fontBytes(face: UnicodeFace): Uint8Array {
  let bytes = bytesCache.get(face)
  if (!bytes) {
    const b64 = DATA_URLS[face].slice(DATA_URLS[face].indexOf(',') + 1)
    const bin = atob(b64)
    bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    bytesCache.set(face, bytes)
  }
  return bytes
}

/** Bettet die Schrift ein (nur tatsächlich verwendete Zeichen). */
export async function embedUnicodeFont(doc: PDFDocument, face: UnicodeFace): Promise<PDFFont> {
  doc.registerFontkit(fontkit)
  return doc.embedFont(fontBytes(face), { subset: true })
}
