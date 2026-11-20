/**
 * Erkennt Textzeilen aus pdf.js-Textinhalten und rechnet sie in den angezeigten
 * Seitenraum (Punkte, Ursprung oben links, inkl. Drehung) um.
 * Bewusst ohne pdf.js-Import, damit die Logik in Node testbar ist.
 */

import type { FontFamily } from '@/types/pdf'

/** Affine Matrix [a, b, c, d, e, f] wie in PDF/pdf.js. */
export type Matrix = readonly [number, number, number, number, number, number]

export interface RawTextItem {
  str: string
  /** Text-Matrix im PDF-Benutzerraum (pdf.js `TextItem.transform`). */
  transform: readonly number[]
  /** Breite in Benutzerraum-Einheiten (pdf.js `TextItem.width`). */
  width: number
  /** Font-Ascent relativ zur Schriftgröße (pdf.js `TextStyle.ascent`), falls bekannt. */
  ascent?: number
  /** Font-Descent relativ zur Schriftgröße (negativ), falls bekannt. */
  descent?: number
  /** pdf.js `TextStyle.fontFamily`, z. B. 'serif', 'sans-serif', 'monospace'. */
  fontFamily?: string
}

export interface TextLine {
  /** Stabil über Drehungen hinweg (aus Benutzerraum-Koordinaten). */
  key: string
  text: string
  x: number
  top: number
  width: number
  height: number
  baseline: number
  fontSize: number
  /** Nächstliegende Standardschrift für den Ersatztext. */
  font: FontFamily
}

/** Ordnet eine pdf.js-Schriftfamilie einer PDF-Standardschrift zu. */
export function toFontFamily(family: string | undefined): FontFamily {
  const f = (family ?? '').toLowerCase()
  if (f.includes('mono') || f.includes('courier')) return 'mono'
  if ((f.includes('serif') && !f.includes('sans')) || f.includes('times')) return 'serif'
  return 'sans'
}

const DEFAULT_ASCENT = 0.8
const DEFAULT_DESCENT = 0.2

/** Matrixprodukt wie pdf.js `Util.transform(m1, m2)`. */
export function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ]
}

function toMatrix(t: readonly number[]): Matrix | null {
  if (t.length < 6 || t.some((v) => !Number.isFinite(v))) return null
  return [t[0]!, t[1]!, t[2]!, t[3]!, t[4]!, t[5]!]
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

/**
 * Baut Zeilen aus Textelementen. Nur Text, der in der aktuellen Ansicht waagrecht
 * von links nach rechts läuft, wird berücksichtigt (gedrehter Text wird übersprungen).
 * Benachbarte Elemente auf derselben Grundlinie werden zu einer Zeile zusammengefasst.
 *
 * @param viewportTransform Transform der pdf.js-Viewport mit Skalierung 1
 */
export function buildTextLines(
  items: readonly RawTextItem[],
  viewportTransform: Matrix,
): TextLine[] {
  const lines: TextLine[] = []
  let current: TextLine | null = null

  for (const item of items) {
    const raw = toMatrix(item.transform)
    if (!raw) continue
    const str = item.str
    const tx = multiply(viewportTransform, raw)
    const fontSize = Math.hypot(tx[2], tx[3])
    // Nur waagrechter Text in Leserichtung; Nichtigkeiten überspringen.
    const horizontal = tx[0] > 0 && Math.abs(tx[1]) <= fontSize * 0.01
    if (fontSize < 1 || !horizontal) {
      current = null
      continue
    }
    const x = tx[4]
    const baseline = tx[5]
    const width = Math.max(0, item.width)
    const ascent = clamp(item.ascent ?? DEFAULT_ASCENT, 0.5, 1.2)
    const descent = clamp(Math.abs(item.descent ?? DEFAULT_DESCENT), 0, 0.5)
    const top = baseline - ascent * fontSize
    const height = (ascent + descent) * fontSize

    if (current) {
      const sameLine =
        Math.abs(baseline - current.baseline) < 0.25 * Math.min(fontSize, current.fontSize) &&
        Math.abs(fontSize - current.fontSize) < 0.2 * Math.max(fontSize, current.fontSize)
      const gap = x - (current.x + current.width)
      if (sameLine && gap > -0.5 * fontSize && gap < 1.5 * fontSize) {
        const needsSpace =
          gap > 0.2 * fontSize && !current.text.endsWith(' ') && !str.startsWith(' ')
        current.text += (needsSpace ? ' ' : '') + str
        const right = Math.max(current.x + current.width, x + width)
        const bottom = Math.max(current.top + current.height, top + height)
        current.x = Math.min(current.x, x)
        current.width = right - current.x
        current.top = Math.min(current.top, top)
        current.height = bottom - current.top
        continue
      }
    }

    if (str.trim() === '') {
      // Reine Leerzeichen-Elemente beginnen keine Zeile.
      current = null
      continue
    }
    current = {
      key: `${Math.round(raw[4] * 10)}:${Math.round(raw[5] * 10)}`,
      text: str,
      x,
      top,
      width,
      height,
      baseline,
      fontSize,
      font: toFontFamily(item.fontFamily),
    }
    lines.push(current)
  }

  return lines
    .map((l) => ({ ...l, text: l.text.trim() }))
    .filter((l) => l.text !== '' && l.width > 0)
}
