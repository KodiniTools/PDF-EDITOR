import {
  getDocument,
  GlobalWorkerOptions,
  RenderingCancelledException,
  type PDFDocumentProxy,
} from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

import { normalizeRotation } from '@/lib/geometry'
import { buildTextLines, type Matrix, type RawTextItem, type TextLine } from '@/lib/textLines'
import { PdfEditorError } from '@/services/pdfExport'
import type { PdfBox, Rotation } from '@/types/pdf'

GlobalWorkerOptions.workerSrc = workerUrl

/** Geöffnete pdf.js-Dokumente; bewusst außerhalb des reaktiven States. */
const documents = new Map<string, PDFDocumentProxy>()

export interface PageInfo {
  box: PdfBox
  rotation: Rotation
}

/** Öffnet ein Dokument für die Anzeige und liefert Seitengrößen/-drehungen. */
export async function openDocument(id: string, bytes: Uint8Array): Promise<PageInfo[]> {
  // pdf.js überträgt den Buffer an den Worker (detached) → Kopie übergeben.
  const task = getDocument({ data: bytes.slice() })
  let doc: PDFDocumentProxy
  try {
    doc = await task.promise
  } catch (err) {
    const name = err instanceof Error ? err.name : ''
    if (name === 'PasswordException') {
      throw new PdfEditorError('Die PDF ist passwortgeschützt.', { cause: err })
    }
    throw new PdfEditorError('Die PDF konnte nicht geöffnet werden.', { cause: err })
  }
  documents.set(id, doc)

  const infos: PageInfo[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = page.view
    infos.push({
      box: { x: x1, y: y1, width: x2 - x1, height: y2 - y1 },
      rotation: normalizeRotation(page.rotate),
    })
  }
  return infos
}

export async function closeDocument(id: string): Promise<void> {
  const doc = documents.get(id)
  documents.delete(id)
  for (const key of textLineCache.keys()) {
    if (key.startsWith(`${id}|`)) textLineCache.delete(key)
  }
  await doc?.destroy()
}

export interface RenderOptions {
  sourceId: string
  pageIndex: number
  /** Gesamtdrehung (Original + Nutzer). */
  rotation: Rotation
  /** CSS-Pixel pro PDF-Punkt. */
  scale: number
  signal?: AbortSignal
}

/**
 * Rendert eine Seite in ein Canvas (HiDPI-scharf). Bei Abbruch über `signal`
 * wird still beendet; andere Fehler werden geworfen.
 */
export async function renderPage(canvas: HTMLCanvasElement, opts: RenderOptions): Promise<void> {
  const doc = documents.get(opts.sourceId)
  if (!doc) throw new PdfEditorError('Dokument ist nicht geöffnet.')
  if (opts.signal?.aborted) return

  const page = await doc.getPage(opts.pageIndex + 1)
  if (opts.signal?.aborted) return

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  const viewport = page.getViewport({ scale: opts.scale * dpr, rotation: opts.rotation })
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  canvas.style.width = `${Math.floor(viewport.width / dpr)}px`
  canvas.style.height = `${Math.floor(viewport.height / dpr)}px`

  const task = page.render({ canvas, viewport })
  const onAbort = () => task.cancel()
  opts.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    await task.promise
  } catch (err) {
    if (err instanceof RenderingCancelledException) return
    throw err
  } finally {
    opts.signal?.removeEventListener('abort', onAbort)
  }
}

/** Cache je Quelle/Seite/Drehung; Textinhalte ändern sich nie. */
const textLineCache = new Map<string, Promise<TextLine[]>>()

/**
 * Liefert die erkannten Textzeilen einer Seite im angezeigten Raum
 * (Punkte, Ursprung oben links, inkl. Drehung).
 */
export function getTextLines(
  sourceId: string,
  pageIndex: number,
  rotation: Rotation,
): Promise<TextLine[]> {
  const cacheKey = `${sourceId}|${pageIndex}|${rotation}`
  const cached = textLineCache.get(cacheKey)
  if (cached) return cached

  const promise = (async () => {
    const doc = documents.get(sourceId)
    if (!doc) throw new PdfEditorError('Dokument ist nicht geöffnet.')
    const page = await doc.getPage(pageIndex + 1)
    const viewport = page.getViewport({ scale: 1, rotation })
    const content = await page.getTextContent()
    const items: RawTextItem[] = []
    for (const item of content.items) {
      if (!('str' in item)) continue
      const style = content.styles[item.fontName]
      items.push({
        str: item.str,
        transform: item.transform as number[],
        width: item.width,
        ascent: style?.ascent || undefined,
        descent: style?.descent || undefined,
        fontFamily: style?.fontFamily,
      })
    }
    return buildTextLines(items, viewport.transform as unknown as Matrix)
  })()
  // Fehlgeschlagene Abfragen nicht cachen, damit ein erneuter Versuch möglich ist.
  promise.catch(() => textLineCache.delete(cacheKey))
  textLineCache.set(cacheKey, promise)
  return promise
}
