/** Umrechnung erkannter Scan-Zeilen (Bildpixel) in Textzeilen im Seitenraum. */
import type { TextLine } from '@/lib/textLines'

import type { OcrLine } from './api'

/**
 * Rechnet OCR-Zeilen in TextLines (Punkte, angezeigter Seitenraum) um. Die Rechtecke
 * aus der Bilderkennung sind ungenau, daher großzügig erweitert: Schwärzungen
 * sollen lieber etwas zu groß als zu klein sein.
 */
export function ocrToTextLines(
  lines: readonly OcrLine[],
  image: { width: number; height: number },
  page: { width: number; height: number },
): TextLine[] {
  const sx = page.width / image.width
  const sy = page.height / image.height
  return lines.map((l, i) => {
    const [x0, y0, x1, y1] = l.box
    const h = (y1 - y0) * sy
    const padY = h * 0.15
    const padX = h * 0.3
    const x = Math.max(0, x0 * sx - padX)
    const top = Math.max(0, y0 * sy - padY)
    const width = Math.min(page.width, x1 * sx + padX) - x
    const height = Math.min(page.height, y1 * sy + padY) - top
    return {
      key: `ocr:${i}`,
      text: l.text,
      x,
      top,
      width,
      height,
      baseline: top + height * 0.8,
      fontSize: h,
      font: 'sans',
      segments: [{ start: 0, end: l.text.length, x, width }],
    }
  })
}
