/**
 * Export mit echtem Schwärzen (nur privater Build).
 *
 * Ablauf in zwei Durchgängen, damit Annotationen des Nutzers (z. B. ein Text
 * „[geschwärzt]“ auf der Fläche) nicht mit entfernt werden:
 *  1. pdf-lib: Seiten in Reihenfolge/Drehung ohne Annotationen exportieren,
 *     MuPDF: Inhalt unter allen Schwärzungsflächen entfernen, Metadaten löschen.
 *  2. pdf-lib: das bereinigte PDF als einzige Quelle nehmen und alle Annotationen
 *     einzeichnen – die Schwärzungsflächen selbst als schwarze Rechtecke.
 */
import { normalizeRotation } from '@/lib/geometry'
import { exportPdf } from '@/services/pdfExport'
import type { Annotation, CoverAnnotation, PageRef } from '@/types/pdf'

import { applyTrueRedactions, type RedactionRect, type RedactionReport } from './trueRedaction'

/** Quell-ID des Zwischenergebnisses im zweiten Durchgang. */
const REDACTED_SOURCE = '__redacted__'

export function isRedaction(a: Annotation): a is CoverAnnotation & { redact: true } {
  return a.kind === 'cover' && a.redact === true
}

export function hasRedactions(pages: readonly PageRef[]): boolean {
  return pages.some((p) => p.annotations.some(isRedaction))
}

export async function exportWithRedactions(
  sources: ReadonlyMap<string, Uint8Array>,
  pages: readonly PageRef[],
): Promise<{ bytes: Uint8Array; report: RedactionReport | null }> {
  if (!hasRedactions(pages)) {
    return { bytes: await exportPdf(sources, pages), report: null }
  }

  // 1. Nur Seiten (Reihenfolge, Drehung), dann schwärzen.
  const bare = await exportPdf(
    sources,
    pages.map((p) => ({ ...p, annotations: [] })),
  )
  const rects: RedactionRect[][] = pages.map((p) =>
    p.annotations.filter(isRedaction).map(({ x, y, width, height }) => ({ x, y, width, height })),
  )
  const { bytes: redacted, report } = await applyTrueRedactions(bare, rects, {
    blackBoxes: false,
  })

  // 2. Annotationen auf das bereinigte PDF zeichnen. Die Drehung steckt bereits im
  //    Zwischenergebnis, daher baseRotation = Gesamtdrehung, rotation = 0.
  const second: PageRef[] = pages.map((p, index) => ({
    ...p,
    sourceId: REDACTED_SOURCE,
    sourceIndex: index,
    baseRotation: normalizeRotation(p.baseRotation + p.rotation),
    rotation: 0,
    annotations: p.annotations.map((a) => (isRedaction(a) ? { ...a, color: '#000000' } : a)),
  }))
  const bytes = await exportPdf(new Map([[REDACTED_SOURCE, redacted]]), second)
  return { bytes, report }
}
