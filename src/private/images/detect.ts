/**
 * Bilder auf einer Seite finden.
 * - Eingebettete Bilder (normales PDF): MuPDF, exakte Position, ohne KI.
 * - Bildbereiche auf Scans/Grafiken: Claude Vision (POST <base>api/detect-images).
 * Ergebnis-Rechtecke sind im angezeigten Seitenraum (Punkte, Ursprung oben links) –
 * dieselben Koordinaten wie Annotationen.
 */
import { exportPdf } from '@/services/pdfExport'
import type { PageRef } from '@/types/pdf'

import type { OcrImage } from '../ocr/api'
import { loadMupdf } from '../redaction/trueRedaction'
import { postJson, SuggestApiError } from '../suggestions/api'

export type ImageKind = 'embedded' | 'photo' | 'logo' | 'signature' | 'stamp' | 'graphic' | 'other'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface FoundImage {
  kind: ImageKind
  label: string
  rect: Rect
  /** Bild nimmt (fast) die ganze Seite ein – typisch für Scans. */
  fullPage: boolean
}

export const KIND_LABELS: Record<ImageKind, string> = {
  embedded: 'Bild',
  photo: 'Foto',
  logo: 'Logo',
  signature: 'Unterschrift',
  stamp: 'Stempel',
  graphic: 'Grafik',
  other: 'Bildbereich',
}

/** Kleinere Bilder (Linien, Punkte, Hintergrundkacheln) werden ignoriert. */
export const MIN_IMAGE_SIDE = 8

const FULL_PAGE_SHARE = 0.85

function isFullPage(r: Rect, page: { width: number; height: number }): boolean {
  return r.width * r.height >= page.width * page.height * FULL_PAGE_SHARE
}

/**
 * Eingebettete Bilder einer Editor-Seite. Die Seite wird ohne Annotationen mit
 * pdf-lib exportiert (Drehung/CropBox wie angezeigt); in diesem PDF ist MuPDFs
 * Seitenraum identisch mit dem Editor-Raum (siehe trueRedaction.ts).
 */
export async function findEmbeddedImages(
  sourceBytes: Uint8Array,
  page: PageRef,
  display: { width: number; height: number },
): Promise<FoundImage[]> {
  const single = await exportPdf(new Map([[page.sourceId, sourceBytes]]), [
    { ...page, annotations: [] },
  ])
  const mupdf = await loadMupdf()
  const doc = new mupdf.PDFDocument(single)
  try {
    const st = doc.loadPage(0).toStructuredText('preserve-images')
    const found: FoundImage[] = []
    try {
      st.walk({
        onImageBlock(bbox, _transform, image) {
          const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = bbox
          const rect = {
            x: Math.max(0, x0),
            y: Math.max(0, y0),
            width: Math.min(display.width, x1) - Math.max(0, x0),
            height: Math.min(display.height, y1) - Math.max(0, y0),
          }
          if (rect.width < MIN_IMAGE_SIDE || rect.height < MIN_IMAGE_SIDE) return
          found.push({
            kind: 'embedded',
            label: `${image.getWidth()} × ${image.getHeight()} px`,
            rect,
            fullPage: isFullPage(rect, display),
          })
        },
      })
    } finally {
      st.destroy()
    }
    return found
  } finally {
    doc.destroy()
  }
}

/** Bildbereiche per Claude; `box` in Bildpixeln → Seitenkoordinaten. */
export async function detectImageRegions(
  image: OcrImage,
  display: { width: number; height: number },
  signal: AbortSignal,
  fetchFn: typeof fetch = fetch,
): Promise<FoundImage[]> {
  const body = await postJson('detect-images', image, signal, fetchFn)
  const list = (body as { regions?: unknown } | null)?.regions
  if (!Array.isArray(list)) throw new SuggestApiError('Unerwartete Antwort vom Server.', 502)
  const sx = display.width / image.width
  const sy = display.height / image.height
  return list.flatMap((r: unknown): FoundImage[] => {
    const { kind, label, box } = (r ?? {}) as { kind?: unknown; label?: unknown; box?: unknown }
    if (!Array.isArray(box) || box.length !== 4) return []
    if (!box.every((n) => typeof n === 'number' && Number.isFinite(n))) return []
    const [x0, y0, x1, y1] = box as number[]
    const rect = { x: x0! * sx, y: y0! * sy, width: (x1! - x0!) * sx, height: (y1! - y0!) * sy }
    if (rect.width < 1 || rect.height < 1) return []
    const k = typeof kind === 'string' && kind in KIND_LABELS && kind !== 'embedded'
    return [
      {
        kind: k ? (kind as ImageKind) : 'other',
        label: typeof label === 'string' && label.trim() ? label.trim() : 'Bildbereich',
        rect,
        fullPage: false,
      },
    ]
  })
}

/** Rechteck etwas vergrößern (KI-Rechtecke sind Schätzungen), innerhalb der Seite. */
export function padRect(r: Rect, pad: number, page: { width: number; height: number }): Rect {
  const x = Math.max(0, r.x - pad)
  const y = Math.max(0, r.y - pad)
  return {
    x,
    y,
    width: Math.min(page.width, r.x + r.width + pad) - x,
    height: Math.min(page.height, r.y + r.height + pad) - y,
  }
}

/** Neues Bild seitenverhältnistreu und zentriert in ein Rechteck einpassen. */
export function fitInto(natural: { width: number; height: number }, box: Rect): Rect {
  const scale = Math.min(box.width / natural.width, box.height / natural.height)
  const width = natural.width * scale
  const height = natural.height * scale
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  }
}
