/**
 * Ordnet von Claude gefundene Textstellen den Positionen auf der Seite zu.
 * Grundlage sind die Zeilen aus pdf.js (siehe lib/textLines.ts) inkl. Segmenten
 * je Textelement; innerhalb eines Segments wird proportional zur Zeichenzahl
 * interpoliert. Ergebnis sind Rechtecke im angezeigten Seitenraum.
 */
import type { TextLine } from '@/lib/textLines'
import type { StandardFontFamily } from '@/types/pdf'

/**
 * Misst die Breite eines Texts in beliebigen Einheiten (nur Verhältnisse zählen).
 * Im Browser: Canvas mit ähnlicher Schrift (measure.ts); Standard: Zeichenzahl.
 */
export type MeasureFn = (text: string, font: StandardFontFamily) => number

export const measureByCharCount: MeasureFn = (text) => text.length

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Buchstabe oder Ziffer (Unicode), für Wortgrenzen. */
const WORD_CHAR = /[\p{L}\p{N}]/u

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD_CHAR.test(ch)
}

/** Fundstellen [start, end) von `needle` in `haystack`, nur an Wortgrenzen. */
export function findRanges(haystack: string, needle: string): [number, number][] {
  const query = needle.trim()
  if (!query) return []
  const ranges: [number, number][] = []
  const search = (h: string, n: string) => {
    let from = 0
    for (;;) {
      const i = h.indexOf(n, from)
      if (i < 0) break
      const end = i + n.length
      const startOk = !isWordChar(query[0]) || !isWordChar(haystack[i - 1])
      const endOk = !isWordChar(query[query.length - 1]) || !isWordChar(haystack[end])
      if (startOk && endOk) ranges.push([i, end])
      from = i + 1
    }
  }
  search(haystack, query)
  // Fallback: Groß-/Kleinschreibung ignorieren (gleiche Länge in toLowerCase vorausgesetzt).
  if (ranges.length === 0) {
    const lowerH = haystack.toLowerCase()
    const lowerN = query.toLowerCase()
    if (lowerH.length === haystack.length && lowerN.length === query.length) {
      search(lowerH, lowerN)
    }
  }
  return ranges
}

/**
 * Text eines Segments inkl. beim Trimmen entfernter Leerzeichen
 * (Segmente dürfen über die Zeile hinausreichen, siehe TextSegment).
 */
function segmentText(line: TextLine, seg: TextLine['segments'][number]): string {
  const len = line.text.length
  return (
    ' '.repeat(Math.max(0, -seg.start)) +
    line.text.slice(Math.max(0, seg.start), Math.min(len, seg.end)) +
    ' '.repeat(Math.max(0, seg.end - len))
  )
}

/** Rechteck für den Zeichenbereich [start, end) einer Zeile. */
export function rangeToRect(
  line: TextLine,
  start: number,
  end: number,
  measure: MeasureFn = measureByCharCount,
): Rect | null {
  if (end <= start) return null
  let x0 = Infinity
  let x1 = -Infinity
  const segments =
    line.segments.length > 0
      ? line.segments
      : [{ start: 0, end: line.text.length, x: line.x, width: line.width }]
  for (const seg of segments) {
    const len = seg.end - seg.start
    if (len <= 0) continue
    const a = Math.max(start, seg.start)
    const b = Math.min(end, seg.end)
    if (b <= a) continue
    // Position innerhalb des Segments über das Breitenverhältnis der Zeichen davor.
    const text = segmentText(line, seg)
    const total = measure(text, line.font)
    const offset = (i: number) =>
      total > 0
        ? (measure(text.slice(0, i - seg.start), line.font) / total) * seg.width
        : ((i - seg.start) / len) * seg.width
    x0 = Math.min(x0, seg.x + offset(a))
    x1 = Math.max(x1, seg.x + offset(b))
  }
  if (!Number.isFinite(x0) || !Number.isFinite(x1) || x1 <= x0) return null
  // Etwas Luft links/rechts (Breitenschätzung), knapp nach
  // oben/unten (Nachbarzeilen nicht anschneiden).
  const padX = Math.max(0.5, line.fontSize * 0.06)
  const padY = Math.max(0.5, line.fontSize * 0.05)
  return {
    x: x0 - padX,
    y: line.top - padY,
    width: x1 - x0 + 2 * padX,
    height: line.height + 2 * padY,
  }
}

/** Alle Rechtecke, an denen `text` auf der Seite vorkommt. */
export function locateText(
  lines: readonly TextLine[],
  text: string,
  measure: MeasureFn = measureByCharCount,
): Rect[] {
  const rects: Rect[] = []
  for (const line of lines) {
    for (const [s, e] of findRanges(line.text, text)) {
      const r = rangeToRect(line, s, e, measure)
      if (r) rects.push(r)
    }
  }
  return rects
}

/** Anteil von `a`, der von `b` überdeckt wird (0–1). */
export function coverage(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  if (w <= 0 || h <= 0 || a.width <= 0 || a.height <= 0) return 0
  return (w * h) / (a.width * a.height)
}
