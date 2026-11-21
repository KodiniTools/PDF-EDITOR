/** Beschriftung eines Formularfelds aus dem Seitentext in seiner Nähe. */
import type { TextLine } from '@/lib/textLines'

import type { DisplayRect } from './geometry'

/**
 * Sucht Text links neben dem Feld (gleiche Höhe) oder direkt darüber.
 * Liefert höchstens `max` Zeichen, leer wenn nichts in der Nähe steht.
 */
export function nearbyLabel(rect: DisplayRect, lines: readonly TextLine[], max = 200): string {
  const cy = rect.y + rect.height / 2
  let best: { line: TextLine; score: number } | null = null
  for (const line of lines) {
    if (!line.text.trim()) continue
    const lcy = line.top + line.height / 2
    const right = line.x + line.width
    // Links daneben, auf gleicher Höhe. Eine Zeile kann über das Feld hinausreichen
    // (z. B. „Anrede: Herr Frau“) – dann nur die Abschnitte links vom Feld nehmen.
    if (Math.abs(lcy - cy) <= Math.max(rect.height, line.height) * 0.75) {
      const parts =
        line.segments.length > 0
          ? line.segments
          : [{ start: 0, end: line.text.length, x: line.x, width: line.width }]
      const left = parts.filter((seg) => seg.x + seg.width <= rect.x + 4)
      const last = left[left.length - 1]
      if (last) {
        const gap = rect.x - (last.x + last.width)
        const text = line.text.slice(0, last.end).trim()
        if (gap < 250 && text && (!best || gap < best.score)) {
          best = { line: { ...line, text }, score: gap }
        }
      }
      continue
    }
    // Darüber, horizontal überlappend
    const bottom = line.top + line.height
    const gapY = rect.y - bottom
    const overlaps = line.x < rect.x + rect.width && right > rect.x - 20
    if (gapY >= -2 && gapY < 30 && overlaps) {
      const score = gapY + 50 // „Links daneben“ bevorzugen
      if (!best || score < best.score) best = { line, score }
    }
  }
  return best ? best.line.text.trim().slice(0, max) : ''
}

/**
 * Beschriftung direkt rechts neben einem Ankreuzfeld (z. B. „Herr“ neben dem
 * Radio-Button). Nutzt die Textabschnitte der Zeile, da mehrere Optionen oft in
 * einer Zeile stehen.
 */
export function rightLabel(rect: DisplayRect, lines: readonly TextLine[], max = 80): string {
  const cy = rect.y + rect.height / 2
  const right = rect.x + rect.width
  let best: { text: string; gap: number } | null = null
  for (const line of lines) {
    const lcy = line.top + line.height / 2
    if (Math.abs(lcy - cy) > Math.max(rect.height, line.height) * 0.75) continue
    const parts =
      line.segments.length > 0
        ? line.segments
        : [{ start: 0, end: line.text.length, x: line.x, width: line.width }]
    for (const seg of parts) {
      const gap = seg.x - right
      if (gap < -2 || gap > 60) continue
      const text = line.text.slice(Math.max(0, seg.start), seg.end).trim()
      if (text && (!best || gap < best.gap)) best = { text, gap }
    }
  }
  return best ? best.text.slice(0, max) : ''
}
