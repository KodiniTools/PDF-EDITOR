import {
  degrees,
  EncryptedPDFError,
  PDFDocument,
  rgb,
  StandardFonts,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib'

import { hexToRgb } from '@/lib/color'
import {
  displayToPdf,
  normalizeRotation,
  TEXT_BASELINE_RATIO,
  TEXT_LINE_HEIGHT,
} from '@/lib/geometry'
import type { Annotation, FontFamily, PageRef, Rotation } from '@/types/pdf'

const STANDARD_FONTS: Record<FontFamily, StandardFonts> = {
  sans: StandardFonts.Helvetica,
  serif: StandardFonts.TimesRoman,
  mono: StandardFonts.Courier,
}

/** Fehler mit nutzerfreundlicher Meldung; die technische Ursache steht in `cause`. */
export class PdfEditorError extends Error {
  readonly cause: unknown

  constructor(message: string, options?: { cause?: unknown }) {
    super(message)
    this.name = 'PdfEditorError'
    this.cause = options?.cause
  }
}

export const HIGHLIGHT_OPACITY = 0.35

/**
 * Prüft, ob pdf-lib die Datei verarbeiten kann (z. B. keine Verschlüsselung).
 * Wirft eine PdfEditorError mit nutzerfreundlicher Meldung.
 */
export async function validatePdf(bytes: Uint8Array): Promise<void> {
  try {
    await PDFDocument.load(bytes, { updateMetadata: false })
  } catch (err) {
    if (err instanceof EncryptedPDFError) {
      throw new PdfEditorError(
        'Die PDF ist verschlüsselt bzw. geschützt und kann nicht bearbeitet werden.',
        { cause: err },
      )
    }
    throw new PdfEditorError('Die Datei ist keine gültige PDF oder beschädigt.', { cause: err })
  }
}

/** Ersetzt Zeichen, die die Standardschrift (WinAnsi) nicht kodieren kann, durch „?“. */
export function sanitizeForFont(text: string, font: PDFFont): string {
  let out = ''
  for (const ch of text) {
    try {
      font.encodeText(ch)
      out += ch
    } catch {
      out += '?'
    }
  }
  return out
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; type: 'png' | 'jpg' } {
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(dataUrl)
  if (!m?.[1] || !m[2]) {
    throw new PdfEditorError('Bildformat nicht unterstützt (nur PNG oder JPEG).')
  }
  const bin = atob(m[2])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { bytes, type: m[1].toLowerCase() === 'png' ? 'png' : 'jpg' }
}

interface DrawContext {
  doc: PDFDocument
  /** Lädt eine Standardschrift bei Bedarf und bettet sie nur einmal ein. */
  font: (family: FontFamily) => Promise<PDFFont>
  images: Map<string, PDFImage>
}

async function drawAnnotation(
  page: PDFPage,
  a: Annotation,
  rotation: Rotation,
  ctx: DrawContext,
): Promise<void> {
  const box = page.getCropBox()
  const rotate = degrees(rotation)

  switch (a.kind) {
    case 'highlight': {
      // Anker = linke untere Ecke im angezeigten Raum; pdf-lib dreht um diesen Punkt.
      const anchor = displayToPdf({ x: a.x, y: a.y + a.height }, box, rotation)
      const c = hexToRgb(a.color)
      page.drawRectangle({
        x: anchor.x,
        y: anchor.y,
        width: a.width,
        height: a.height,
        rotate,
        color: rgb(c.r, c.g, c.b),
        opacity: HIGHLIGHT_OPACITY,
      })
      return
    }
    case 'cover': {
      const anchor = displayToPdf({ x: a.x, y: a.y + a.height }, box, rotation)
      const c = hexToRgb(a.color)
      page.drawRectangle({
        x: anchor.x,
        y: anchor.y,
        width: a.width,
        height: a.height,
        rotate,
        color: rgb(c.r, c.g, c.b),
        opacity: 1,
      })
      return
    }
    case 'text': {
      const c = hexToRgb(a.color)
      const lines = a.text.split(/\r?\n/)
      const lineHeight = a.fontSize * TEXT_LINE_HEIGHT
      const font = await ctx.font(a.font ?? 'sans')
      lines.forEach((line, i) => {
        if (!line) return
        const baseline = a.y + i * lineHeight + a.fontSize * TEXT_BASELINE_RATIO
        const anchor = displayToPdf({ x: a.x, y: baseline }, box, rotation)
        page.drawText(sanitizeForFont(line, font), {
          x: anchor.x,
          y: anchor.y,
          size: a.fontSize,
          font,
          color: rgb(c.r, c.g, c.b),
          rotate,
        })
      })
      return
    }
    case 'image': {
      let image = ctx.images.get(a.dataUrl)
      if (!image) {
        const { bytes, type } = dataUrlToBytes(a.dataUrl)
        image = type === 'png' ? await ctx.doc.embedPng(bytes) : await ctx.doc.embedJpg(bytes)
        ctx.images.set(a.dataUrl, image)
      }
      const anchor = displayToPdf({ x: a.x, y: a.y + a.height }, box, rotation)
      page.drawImage(image, {
        x: anchor.x,
        y: anchor.y,
        width: a.width,
        height: a.height,
        rotate,
      })
      return
    }
    default: {
      const exhaustive: never = a
      throw new PdfEditorError(`Unbekannte Annotation: ${JSON.stringify(exhaustive)}`)
    }
  }
}

/**
 * Baut aus den Seitenverweisen ein neues PDF: Reihenfolge, Drehung und
 * Annotationen werden übernommen. Quellen werden nicht verändert.
 */
export async function exportPdf(
  sources: ReadonlyMap<string, Uint8Array>,
  pages: readonly PageRef[],
): Promise<Uint8Array> {
  if (pages.length === 0) {
    throw new PdfEditorError('Es gibt keine Seiten zum Exportieren.')
  }

  const out = await PDFDocument.create()
  const fonts = new Map<FontFamily, Promise<PDFFont>>()
  const ctx: DrawContext = {
    doc: out,
    font: (family) => {
      let font = fonts.get(family)
      if (!font) {
        font = out.embedFont(STANDARD_FONTS[family])
        fonts.set(family, font)
      }
      return font
    },
    images: new Map(),
  }

  // Pro Quelle einmal laden und alle benötigten Seiten in einem Aufruf kopieren,
  // damit gemeinsame Ressourcen (Fonts, Bilder) nicht mehrfach eingebettet werden.
  const copied = new Map<PageRef, PDFPage>()
  const bySource = new Map<string, PageRef[]>()
  for (const p of pages) {
    const list = bySource.get(p.sourceId) ?? []
    list.push(p)
    bySource.set(p.sourceId, list)
  }
  for (const [sourceId, refs] of bySource) {
    const bytes = sources.get(sourceId)
    if (!bytes) throw new PdfEditorError(`Quelldatei fehlt (${sourceId}).`)
    let src: PDFDocument
    try {
      src = await PDFDocument.load(bytes, { updateMetadata: false })
    } catch (err) {
      throw new PdfEditorError('Eine Quelldatei konnte nicht gelesen werden.', { cause: err })
    }
    const result = await out.copyPages(
      src,
      refs.map((r) => r.sourceIndex),
    )
    refs.forEach((r, i) => {
      const page = result[i]
      if (page) copied.set(r, page)
    })
  }

  for (const ref of pages) {
    const page = copied.get(ref)
    if (!page) throw new PdfEditorError('Seite konnte nicht kopiert werden.')
    out.addPage(page)
    const total = normalizeRotation(ref.baseRotation + ref.rotation)
    page.setRotation(degrees(total))
    for (const a of ref.annotations) {
      await drawAnnotation(page, a, total, ctx)
    }
  }

  out.setProducer('PDF-Editor (Vue 3, pdf-lib)')
  return out.save()
}
