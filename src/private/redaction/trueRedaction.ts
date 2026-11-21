/**
 * Echtes Schwärzen mit MuPDF (AGPL – nur im privaten Build, siehe vite.config.ts).
 *
 * Arbeitet auf einer fertig exportierten PDF (pdf-lib). Koordinaten der Flächen sind
 * die des Editors: Punkte im angezeigten (gedrehten) Seitenraum, Ursprung oben links
 * an der CropBox. Das ist exakt MuPDFs Seitenraum („fitz space“), daher ist keine
 * Umrechnung nötig (geprüft in __tests__/trueRedaction.spec.ts für 0°/90°/180°/270°
 * und verschobene CropBox).
 */
import type * as MuPDF from 'mupdf'

import { PdfEditorError } from '@/services/pdfExport'

/** Rechteck im angezeigten Seitenraum (Punkte, Ursprung oben links). */
export interface RedactionRect {
  x: number
  y: number
  width: number
  height: number
}

export interface RedactionReport {
  /** Anzahl angewendeter Schwärzungsflächen. */
  areas: number
  /** Entfernte Annotationen (Kommentare, Links, Stempel …) im Bereich. */
  removedAnnotations: number
  /** Entfernte Formularfelder (Widgets) im Bereich. */
  removedFields: number
}

/** Meldung wird dem Nutzer angezeigt (PdfEditorError → store.error). */
export class RedactionError extends PdfEditorError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'RedactionError'
  }
}

type Rect = [number, number, number, number]

let mupdfPromise: Promise<typeof MuPDF> | null = null
/** MuPDF (≈10 MB WASM) erst beim ersten Export laden. */
export function loadMupdf(): Promise<typeof MuPDF> {
  mupdfPromise ??= import('mupdf').catch((err: unknown) => {
    mupdfPromise = null
    throw new RedactionError('Die Schwärzungs-Engine (MuPDF) konnte nicht geladen werden.', {
      cause: err,
    })
  })
  return mupdfPromise
}

function toRect(r: RedactionRect): Rect {
  const x0 = Math.min(r.x, r.x + r.width)
  const y0 = Math.min(r.y, r.y + r.height)
  return [x0, y0, x0 + Math.abs(r.width), y0 + Math.abs(r.height)]
}

function intersects(a: readonly number[], b: Rect): boolean {
  const [ax0 = 0, ay0 = 0, ax1 = 0, ay1 = 0] = a
  return ax0 < b[2] && ax1 > b[0] && ay0 < b[3] && ay1 > b[1]
}

function containsPoint(r: Rect, x: number, y: number): boolean {
  return x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]
}

/**
 * Entfernt den Wert des Formularfelds eines Widgets (Feldwert liegt ggf. im
 * Eltern-Feld und würde sonst über andere Widgets oder /Fields erhalten bleiben).
 */
function clearFieldValue(widget: MuPDF.PDFWidget): void {
  let node: MuPDF.PDFObject = widget.getObject()
  for (let depth = 0; depth < 32 && node.isDictionary(); depth++) {
    for (const key of ['V', 'DV', 'RV']) node.delete(key)
    const parent = node.get('Parent')
    if (parent.isNull()) return
    node = parent
  }
}

/**
 * Entfernt Dokument-Metadaten: Info-Dictionary, XMP auf Dokument- und Seitenebene,
 * PieceInfo (Bearbeitungsdaten von Programmen).
 */
function stripMetadata(doc: MuPDF.PDFDocument): void {
  // Der Trailer ist erst änderbar, wenn MuPDF eine lokale Xref angelegt hat – das
  // passiert erst bei der ersten Änderung. Ohne Schwärzungsflächen gibt es keine,
  // daher ein (beim Speichern per garbage wieder entferntes) leeres Objekt anlegen.
  doc.createObject()
  const trailer = doc.getTrailer()
  trailer.delete('Info')
  if (!trailer.get('Info').isNull()) {
    throw new RedactionError('Metadaten konnten nicht entfernt werden.')
  }
  const root = trailer.get('Root')
  if (root.isDictionary()) {
    root.delete('Metadata')
    root.delete('PieceInfo')
  }
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.findPage(i)
    page.delete('Metadata')
    page.delete('PieceInfo')
    page.delete('Thumb') // Vorschaubild könnte geschwärzten Inhalt zeigen
  }
}

/**
 * Prüft nach dem Schwärzen, dass in keiner Fläche noch Text extrahierbar ist.
 * Wirft, wenn doch – lieber kein Export als ein scheinbar geschwärztes PDF.
 */
function assertNoTextLeft(page: MuPDF.PDFPage, rects: readonly Rect[], pageNo: number): void {
  const st = page.toStructuredText('preserve-whitespace')
  let leaked = ''
  try {
    st.walk({
      onChar(c: string, _origin: MuPDF.Point, _font: MuPDF.Font, _size: number, quad: MuPDF.Quad) {
        if (c.trim() === '') return
        const cx = (quad[0] + quad[2] + quad[4] + quad[6]) / 4
        const cy = (quad[1] + quad[3] + quad[5] + quad[7]) / 4
        if (rects.some((r) => containsPoint(r, cx, cy))) leaked += c
      },
    })
  } finally {
    st.destroy()
  }
  if (leaked) {
    throw new RedactionError(`Schwärzung auf Seite ${pageNo} unvollständig – Export abgebrochen.`, {
      cause: leaked,
    })
  }
}

/**
 * Schwärzt die angegebenen Bereiche dauerhaft:
 * - Text, Vektorgrafik und Bildpixel unter den Flächen werden aus dem Inhalt entfernt,
 * - Annotationen, Links und Formularfelder, die eine Fläche berühren, werden gelöscht
 *   (bei Feldern auch der gespeicherte Wert),
 * - Metadaten (Info, XMP, PieceInfo, Vorschaubilder) werden entfernt,
 * - die Datei wird komplett neu geschrieben (keine inkrementellen Reste, unbenutzte
 *   Objekte wie alte Inhaltsströme fliegen raus).
 *
 * @param rectsByPage Flächen je Seite (Index = Seitenindex in `pdf`)
 * @param options.blackBoxes schwarze Flächen einzeichnen (Standard true); false, wenn
 *   der Aufrufer die Flächen selbst zeichnet
 */
export async function applyTrueRedactions(
  pdf: Uint8Array,
  rectsByPage: ReadonlyArray<readonly RedactionRect[] | undefined>,
  options: { blackBoxes?: boolean } = {},
): Promise<{ bytes: Uint8Array; report: RedactionReport }> {
  const blackBoxes = options.blackBoxes ?? true
  const mupdf = await loadMupdf()
  const report: RedactionReport = { areas: 0, removedAnnotations: 0, removedFields: 0 }

  let doc: MuPDF.PDFDocument
  try {
    doc = new mupdf.PDFDocument(pdf)
  } catch (err) {
    throw new RedactionError('Die PDF konnte für das Schwärzen nicht geöffnet werden.', {
      cause: err,
    })
  }

  try {
    const pageCount = doc.countPages()
    if (rectsByPage.length > pageCount) {
      throw new RedactionError('Schwärzungen verweisen auf nicht vorhandene Seiten.')
    }

    for (let i = 0; i < pageCount; i++) {
      const rects = (rectsByPage[i] ?? [])
        .filter((r) => Number.isFinite(r.x + r.y + r.width + r.height))
        .map(toRect)
        .filter((r) => r[2] - r[0] > 0 && r[3] - r[1] > 0)
      if (rects.length === 0) continue

      const page = doc.loadPage(i)
      try {
        // 1. Annotationen/Widgets/Links im Bereich entfernen (deren Darstellungen
        //    liegen außerhalb des Seiteninhalts und würden sonst überleben).
        for (const annot of page.getAnnotations()) {
          if (annot.getType() === 'Redact') continue
          if (rects.some((r) => intersects(annot.getBounds(), r))) {
            page.deleteAnnotation(annot)
            report.removedAnnotations++
          }
        }
        for (const widget of page.getWidgets()) {
          if (rects.some((r) => intersects(widget.getBounds(), r))) {
            clearFieldValue(widget)
            page.deleteAnnotation(widget)
            report.removedFields++
          }
        }
        for (const link of page.getLinks()) {
          if (rects.some((r) => intersects(link.getBounds(), r))) {
            page.deleteLink(link)
            report.removedAnnotations++
          }
        }

        // 2. Schwärzungsannotationen anlegen und anwenden.
        for (const r of rects) {
          const annot = page.createAnnotation('Redact')
          annot.setRect(r)
        }
        page.applyRedactions(
          blackBoxes,
          mupdf.PDFPage.REDACT_IMAGE_PIXELS,
          mupdf.PDFPage.REDACT_LINE_ART_REMOVE_IF_COVERED,
          mupdf.PDFPage.REDACT_TEXT_REMOVE,
        )
        report.areas += rects.length

        assertNoTextLeft(page, rects, i + 1)
      } finally {
        page.destroy()
      }
    }

    stripMetadata(doc)

    // Komplett neu schreiben: unbenutzte Objekte entfernen, nichts inkrementell anhängen.
    const buffer = doc.saveToBuffer('garbage=deduplicate,compress,clean')
    try {
      // Kopie: der Speicher gehört dem WASM-Heap.
      return { bytes: buffer.asUint8Array().slice(), report }
    } finally {
      buffer.destroy()
    }
  } catch (err) {
    if (err instanceof RedactionError) throw err
    throw new RedactionError('Schwärzen fehlgeschlagen.', { cause: err })
  } finally {
    doc.destroy()
  }
}
