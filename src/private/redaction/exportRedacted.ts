/**
 * Export mit echtem Schwärzen (nur privater Build).
 *
 * Ablauf in zwei Durchgängen, damit Annotationen des Nutzers (z. B. ein Text
 * „[geschwärzt]“ auf der Fläche) nicht mit entfernt werden:
 *  1. pdf-lib: Seiten in Reihenfolge/Drehung ohne Annotationen exportieren,
 *     MuPDF: Inhalt unter allen Schwärzungsflächen entfernen, Metadaten löschen.
 *     Danach ggf. Formularfelder ausfüllen und einbetten (MuPDF, forms/fill.ts) –
 *     nach dem Schwärzen, damit Felder in geschwärzten Bereichen schon entfernt sind.
 *  2. pdf-lib: das bereinigte PDF als einzige Quelle nehmen und alle Annotationen
 *     einzeichnen – die Schwärzungsflächen selbst als deckende Rechtecke in ihrer Farbe
 *     (Standard schwarz; weiß bei ersetzten Textzeilen aus „Text bearbeiten“).
 */
import { normalizeRotation } from '@/lib/geometry'
import { exportPdf, type ExportOptions } from '@/services/pdfExport'
import type { Annotation, CoverAnnotation, PageRef } from '@/types/pdf'

import { fillFormFields, type FieldValues } from '../forms/fill'
import { applyTrueRedactions, type RedactionRect, type RedactionReport } from './trueRedaction'

/** Quell-ID des Zwischenergebnisses im zweiten Durchgang. */
const REDACTED_SOURCE = '__redacted__'

export function isRedaction(a: Annotation): a is CoverAnnotation & { redact: true } {
  return a.kind === 'cover' && a.redact === true
}

export function hasRedactions(pages: readonly PageRef[]): boolean {
  return pages.some((p) => p.annotations.some(isRedaction))
}

export interface PrivateExportOptions {
  /** Formularwerte je Seite (Index = Position in `pages`); leer = nichts ausfüllen. */
  formValues?: ReadonlyArray<FieldValues | undefined>
}

/** Textfelder mit č, ć, đ usw. erhalten eine eingebettete Unicode-Schrift. */
const EXPORT_OPTIONS: ExportOptions = {
  unicodeFont: async (doc, family) =>
    (await import('../fonts/unicode')).embedUnicodeFont(doc, family),
}

export async function exportWithRedactions(
  sources: ReadonlyMap<string, Uint8Array>,
  pages: readonly PageRef[],
  options: PrivateExportOptions = {},
): Promise<{ bytes: Uint8Array; report: RedactionReport | null }> {
  const formValues = options.formValues ?? []
  const fillForms = formValues.some((v) => v !== undefined && v.size > 0)
  if (!hasRedactions(pages) && !fillForms) {
    return { bytes: await exportPdf(sources, pages, EXPORT_OPTIONS), report: null }
  }

  // 1. Nur Seiten (Reihenfolge, Drehung), dann schwärzen und Formulare ausfüllen.
  let intermediate = await exportPdf(
    sources,
    pages.map((p) => ({ ...p, annotations: [] })),
  )
  let report: RedactionReport | null = null
  if (hasRedactions(pages)) {
    const rects: RedactionRect[][] = pages.map((p) =>
      p.annotations.filter(isRedaction).map(({ x, y, width, height }) => ({ x, y, width, height })),
    )
    const result = await applyTrueRedactions(intermediate, rects, { blackBoxes: false })
    intermediate = result.bytes
    report = result.report
  }
  if (fillForms) {
    intermediate = (await fillFormFields(intermediate, formValues)).bytes
  }
  const redacted = intermediate

  // 2. Annotationen auf das bereinigte PDF zeichnen. Die Drehung steckt bereits im
  //    Zwischenergebnis, daher baseRotation = Gesamtdrehung, rotation = 0.
  const second: PageRef[] = pages.map((p, index) => ({
    ...p,
    sourceId: REDACTED_SOURCE,
    sourceIndex: index,
    baseRotation: normalizeRotation(p.baseRotation + p.rotation),
    rotation: 0,
    annotations: p.annotations.map((a) =>
      isRedaction(a) ? { ...a, color: a.color || '#000000' } : a,
    ),
  }))
  const bytes = await exportPdf(new Map([[REDACTED_SOURCE, redacted]]), second, EXPORT_OPTIONS)
  return { bytes, report }
}
