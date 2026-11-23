/** Erzeugt ein leeres PDF (pdf-lib, rein lokal) für „Neues Dokument“. */
import { PDFDocument } from 'pdf-lib'

import { pageSize, type Orientation, type PageFormat } from '@/lib/pageFormats'

export const MAX_BLANK_PAGES = 50

export interface BlankDocumentOptions {
  format: PageFormat
  orientation: Orientation
  pages: number
}

/** Gültige Seitenzahl für ein leeres Dokument (ganzzahlig, 1 bis MAX_BLANK_PAGES)? */
export function isValidPageCount(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_BLANK_PAGES
}

export async function createBlankPdf(
  opts: BlankDocumentOptions,
  title: string,
): Promise<Uint8Array> {
  if (!isValidPageCount(opts.pages)) throw new RangeError(`Ungültige Seitenzahl: ${opts.pages}`)
  const doc = await PDFDocument.create()
  doc.setTitle(title)
  doc.setCreator('Kodini PDF-Editor')
  const size = pageSize(opts.format, opts.orientation)
  for (let i = 0; i < opts.pages; i++) doc.addPage(size)
  return doc.save()
}
