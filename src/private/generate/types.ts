/** Neues Dokument: Seitenformate und Inhaltsblöcke (müssen zu server/src/generate.ts passen). */

import type { PageFormat } from '@/lib/pageFormats'

export {
  FORMAT_SIZES,
  PAGE_FORMATS,
  pageSize,
  type Orientation,
  type PageFormat,
} from '@/lib/pageFormats'

export const FORMAT_LABELS: Record<PageFormat, string> = {
  A4: 'A4 (210 × 297 mm)',
  A5: 'A5 (148 × 210 mm)',
  A3: 'A3 (297 × 420 mm)',
  Letter: 'US Letter (8,5 × 11 in)',
  Legal: 'US Legal (8,5 × 14 in)',
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
