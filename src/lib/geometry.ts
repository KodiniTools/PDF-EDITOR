import type { Annotation, PdfBox, Rotation, Size } from '@/types/pdf'

/** Zeilenhöhe von Textannotationen relativ zur Schriftgröße (UI und Export identisch). */
export const TEXT_LINE_HEIGHT = 1.2
/**
 * Abstand Zeilenoberkante → Grundlinie relativ zur Schriftgröße.
 * Näherung für Helvetica/Arial bei line-height 1.2; Abweichung UI ↔ Export < 1 pt bei 12 pt.
 */
export const TEXT_BASELINE_RATIO = 0.9

/** Bringt beliebige Gradzahlen auf 0/90/180/270. Wirft bei Nicht-Vielfachen von 90. */
export function normalizeRotation(deg: number): Rotation {
  if (!Number.isFinite(deg) || deg % 90 !== 0) {
    throw new RangeError(`Ungültige Drehung: ${deg}`)
  }
  const r = ((deg % 360) + 360) % 360
  return r as Rotation
}

/** Größe der Seite, wie sie nach Drehung angezeigt wird. */
export function displaySize(box: Pick<PdfBox, 'width' | 'height'>, rotation: Rotation): Size {
  return rotation === 90 || rotation === 270
    ? { width: box.height, height: box.width }
    : { width: box.width, height: box.height }
}

/**
 * Rechnet einen Punkt aus dem angezeigten Seitenraum (Punkte, Ursprung oben links,
 * Seite um `rotation` im Uhrzeigersinn gedreht) in PDF-Benutzerkoordinaten um
 * (Ursprung unten links, ungedreht).
 */
export function displayToPdf(
  point: { x: number; y: number },
  box: PdfBox,
  rotation: Rotation,
): { x: number; y: number } {
  const d = displaySize(box, rotation)
  const u = point.x / d.width
  const v = point.y / d.height
  // (bx, by): normierte Position in der ungedrehten Seite, Ursprung oben links.
  let bx: number
  let by: number
  switch (rotation) {
    case 0:
      bx = u
      by = v
      break
    case 90:
      bx = v
      by = 1 - u
      break
    case 180:
      bx = 1 - u
      by = 1 - v
      break
    case 270:
      bx = 1 - v
      by = u
      break
    default: {
      const exhaustive: never = rotation
      throw new RangeError(`Ungültige Drehung: ${String(exhaustive)}`)
    }
  }
  return { x: box.x + bx * box.width, y: box.y + (1 - by) * box.height }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/**
 * Passt eine Annotation an, wenn die Seite um 90° gedreht wird.
 * Markierungen drehen mit (Rechteck wird transponiert), Text und Bilder bleiben
 * aufrecht und wandern nur mit ihrem Mittelpunkt bzw. Ankerpunkt mit.
 *
 * @param oldSize angezeigte Seitengröße *vor* der Drehung
 */
export function rotateAnnotation<T extends Annotation>(
  a: T,
  oldSize: Size,
  direction: 'cw' | 'ccw',
): T {
  const newSize: Size = { width: oldSize.height, height: oldSize.width }
  // Punktabbildung: cw (x,y) → (H − y, x); ccw (x,y) → (y, W − x)
  const map = (x: number, y: number) =>
    direction === 'cw' ? { x: oldSize.height - y, y: x } : { x: y, y: oldSize.width - x }

  switch (a.kind) {
    case 'highlight': {
      const p = direction === 'cw' ? map(a.x, a.y + a.height) : map(a.x + a.width, a.y)
      return { ...a, x: p.x, y: p.y, width: a.height, height: a.width }
    }
    case 'image': {
      const c = map(a.x + a.width / 2, a.y + a.height / 2)
      return {
        ...a,
        x: clamp(c.x - a.width / 2, 0, newSize.width - a.width),
        y: clamp(c.y - a.height / 2, 0, newSize.height - a.height),
      }
    }
    case 'text': {
      const p = map(a.x, a.y)
      const lineHeight = a.fontSize * TEXT_LINE_HEIGHT
      return {
        ...a,
        x: clamp(direction === 'cw' ? p.x - lineHeight : p.x, 0, newSize.width - a.fontSize),
        y: clamp(p.y, 0, newSize.height - lineHeight),
      }
    }
    default: {
      const exhaustive: never = a
      throw new Error(`Unbekannte Annotation: ${JSON.stringify(exhaustive)}`)
    }
  }
}
