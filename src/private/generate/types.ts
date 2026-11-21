/** Neues Dokument: Seitenformate und Inhaltsblöcke (müssen zu server/src/generate.ts passen). */

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

export const FORMAT_LABELS: Record<PageFormat, string> = {
  A4: 'A4 (210 × 297 mm)',
  A5: 'A5 (148 × 210 mm)',
  A3: 'A3 (297 × 420 mm)',
  Letter: 'US Letter (8,5 × 11 in)',
  Legal: 'US Legal (8,5 × 14 in)',
}

export function pageSize(format: PageFormat, orientation: Orientation): [number, number] {
  const [w, h] = FORMAT_SIZES[format]
  return orientation === 'landscape' ? [h, w] : [w, h]
}

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'bullets' | 'numbered'; items: string[] }
  | { type: 'table'; rows: string[][]; header: boolean }
  | { type: 'field'; text: string }
  | { type: 'divider' | 'spacer' | 'pagebreak' }

export interface GeneratedDocument {
  title: string
  blocks: Block[]
}
