/** Umrechnung PDF-Benutzerraum → angezeigter Seitenraum (Umkehrung von displayToPdf). */
import { displayToPdf } from '@/lib/geometry'
import type { PdfBox, Rotation } from '@/types/pdf'

export interface DisplayRect {
  x: number
  y: number
  width: number
  height: number
}

/** displayToPdf ist affin → aus drei Punkten invertieren. */
export function pdfToDisplay(
  p: { x: number; y: number },
  box: PdfBox,
  rotation: Rotation,
): { x: number; y: number } {
  const o = displayToPdf({ x: 0, y: 0 }, box, rotation)
  const ex = displayToPdf({ x: 1, y: 0 }, box, rotation)
  const ey = displayToPdf({ x: 0, y: 1 }, box, rotation)
  const a = ex.x - o.x
  const b = ex.y - o.y
  const c = ey.x - o.x
  const d = ey.y - o.y
  const det = a * d - b * c
  const dx = p.x - o.x
  const dy = p.y - o.y
  return { x: (d * dx - c * dy) / det, y: (-b * dx + a * dy) / det }
}

/** PDF-Rechteck [x1, y1, x2, y2] → Rechteck im angezeigten Raum. */
export function pdfRectToDisplay(
  rect: readonly [number, number, number, number],
  box: PdfBox,
  rotation: Rotation,
): DisplayRect {
  const p1 = pdfToDisplay({ x: rect[0], y: rect[1] }, box, rotation)
  const p2 = pdfToDisplay({ x: rect[2], y: rect[3] }, box, rotation)
  return {
    x: Math.min(p1.x, p2.x),
    y: Math.min(p1.y, p2.y),
    width: Math.abs(p1.x - p2.x),
    height: Math.abs(p1.y - p2.y),
  }
}
