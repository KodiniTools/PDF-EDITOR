/** Seitenformate für neue Dokumente (beide Varianten). */

export const PAGE_FORMATS = ['A4', 'A5', 'A3', 'Letter', 'Legal'] as const
export type PageFormat = (typeof PAGE_FORMATS)[number]
export type Orientation = 'portrait' | 'landscape'

/** Seitengröße im Hochformat in PDF-Punkten (1 pt = 1/72 Zoll). */
export const FORMAT_SIZES: Record<PageFormat, readonly [number, number]> = {
  A4: [595.28, 841.89],
  A5: [419.53, 595.28],
  A3: [841.89, 1190.55],
  Letter: [612, 792],
  Legal: [612, 1008],
}

export function pageSize(format: PageFormat, orientation: Orientation): [number, number] {
  const [w, h] = FORMAT_SIZES[format]
  return orientation === 'landscape' ? [h, w] : [w, h]
}
