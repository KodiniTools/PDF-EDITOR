/**
 * Eigene Schriften für den Seiteninhalt: alle `.ttf`/`.otf` aus `src/assets/fonts/editor/`
 * (Namensschema siehe README dort). Sie erscheinen in der Schriftauswahl, werden im
 * Browser bei Bedarf geladen und beim Export in das PDF eingebettet.
 */
import { ref } from 'vue'

import type { CustomFontFamily, FontFamily } from '@/types/pdf'

export type FontFaceKey = 'regular' | 'bold' | 'italic' | 'boldItalic'

export interface CustomFont {
  id: CustomFontFamily
  /** Anzeigename in der Schriftauswahl. */
  label: string
  /** Name der Schrift in CSS (eindeutig, kollidiert nicht mit installierten Schriften). */
  cssName: string
  /** Adresse der Datei je vorhandenem Schnitt; `regular` ist immer vorhanden. */
  faces: Partial<Record<FontFaceKey, string>> & { regular: string }
}

const FACE_BY_SUFFIX: Record<string, FontFaceKey> = {
  regular: 'regular',
  bold: 'bold',
  italic: 'italic',
  bolditalic: 'boldItalic',
}

export function isCustomFont(family: FontFamily | undefined): family is CustomFontFamily {
  return family !== undefined && family.startsWith('custom:')
}

/**
 * Liest die Schriftliste aus Dateipfad → Adresse. Dateien ohne gültigen Schnitt im Namen
 * und Familien ohne `Regular` werden übersprungen (mit Hinweis in der Konsole).
 */
export function parseFontFiles(files: Readonly<Record<string, string>>): CustomFont[] {
  const families = new Map<string, Partial<Record<FontFaceKey, string>>>()
  for (const path of Object.keys(files).sort()) {
    const url = files[path]
    const m = /([^/\\]+)-([A-Za-z]+)\.(?:ttf|otf)$/i.exec(path)
    const face = m?.[2] ? FACE_BY_SUFFIX[m[2].toLowerCase()] : undefined
    const name = m?.[1]
    if (!url || !name || !face) {
      console.warn(
        `[pdf-editor] Schriftdatei übersprungen (Name: <Familie>-<Schnitt>.ttf): ${path}`,
      )
      continue
    }
    const faces = families.get(name) ?? {}
    faces[face] = url
    families.set(name, faces)
  }
  const fonts: CustomFont[] = []
  for (const [name, faces] of families) {
    const { regular } = faces
    if (!regular) {
      console.warn(`[pdf-editor] Schrift „${name}“ übersprungen: ${name}-Regular fehlt.`)
      continue
    }
    fonts.push({
      id: `custom:${name}`,
      label: name.replace(/_/g, ' '),
      cssName: `pdfed-${name}`,
      faces: { ...faces, regular },
    })
  }
  return fonts.sort((a, b) => a.label.localeCompare(b.label))
}

const bundled = import.meta.glob<string>('@/assets/fonts/editor/*.{ttf,otf,TTF,OTF}', {
  query: '?url',
  import: 'default',
  eager: true,
})

let fonts: CustomFont[] = parseFontFiles(bundled)
let byId = new Map(fonts.map((f) => [f.id, f]))

/** Zähler: steigt, sobald ein Schnitt fertig geladen ist (löst neues Messen/Umbrechen aus). */
export const customFontsLoaded = ref(0)

export function customFonts(): readonly CustomFont[] {
  return fonts
}

export function customFont(family: FontFamily | undefined): CustomFont | undefined {
  return isCustomFont(family) ? byId.get(family) : undefined
}

/** Nächstliegender vorhandener Schnitt (fett-kursiv → fett → kursiv → normal). */
export function pickFace(
  font: CustomFont,
  style: { bold?: boolean; italic?: boolean },
): { key: FontFaceKey; url: string } {
  const order: FontFaceKey[] =
    style.bold && style.italic
      ? ['boldItalic', 'bold', 'italic']
      : style.bold
        ? ['bold']
        : style.italic
          ? ['italic']
          : []
  for (const key of order) {
    const url = font.faces[key]
    if (url) return { key, url }
  }
  return { key: 'regular', url: font.faces.regular }
}

const DESCRIPTORS: Record<FontFaceKey, FontFaceDescriptors> = {
  regular: { weight: '400', style: 'normal' },
  bold: { weight: '700', style: 'normal' },
  italic: { weight: '400', style: 'italic' },
  boldItalic: { weight: '700', style: 'italic' },
}

const loading = new Map<string, Promise<void>>()
const ready = new Set<string>()

/**
 * Sorgt dafür, dass der passende Schnitt im Browser geladen ist. Gibt `true` zurück, wenn
 * er schon bereitsteht; sonst startet das Laden, und `customFontsLoaded` steigt danach.
 */
export function ensureCustomFont(
  family: FontFamily | undefined,
  style: { bold?: boolean; italic?: boolean } = {},
): boolean {
  const font = customFont(family)
  if (!font) return true
  const { key, url } = pickFace(font, style)
  const id = `${font.id}:${key}`
  if (ready.has(id)) return true
  if (loading.has(id) || typeof FontFace === 'undefined') return false
  const face = new FontFace(font.cssName, `url(${JSON.stringify(url)})`, DESCRIPTORS[key])
  const done = face
    .load()
    .then(() => {
      document.fonts.add(face)
      ready.add(id)
    })
    .catch((err: unknown) => {
      // Die Systemschrift bleibt als Ersatz stehen; der Editor ist weiter nutzbar.
      console.error(`[pdf-editor] Schrift „${font.label}“ konnte nicht geladen werden`, err)
    })
    .finally(() => {
      loading.delete(id)
      customFontsLoaded.value += 1
    })
  loading.set(id, done)
  return false
}

const bytesCache = new Map<string, Promise<Uint8Array>>()

/** Schriftdatei für den Export (je Datei nur einmal geladen). */
export function customFontBytes(
  family: CustomFontFamily,
  style: { bold: boolean; italic: boolean },
): Promise<Uint8Array> | null {
  const font = byId.get(family)
  if (!font) return null
  const { url } = pickFace(font, style)
  let bytes = bytesCache.get(url)
  if (!bytes) {
    bytes = fetch(url).then(async (res) => {
      if (!res.ok) throw new Error(`Schriftdatei ${url}: HTTP ${res.status}`)
      return new Uint8Array(await res.arrayBuffer())
    })
    // Fehlgeschlagene Abrufe nicht merken, damit ein neuer Export es erneut versucht.
    bytes.catch(() => bytesCache.delete(url))
    bytesCache.set(url, bytes)
  }
  return bytes
}

/** Nur für Tests: Schriftliste ersetzen. */
export function setCustomFontsForTest(files: Readonly<Record<string, string>>): void {
  fonts = parseFontFiles(files)
  byId = new Map(fonts.map((f) => [f.id, f]))
  ready.clear()
  loading.clear()
  bytesCache.clear()
}
