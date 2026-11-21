/**
 * Texterkennung für Seiten ohne Textebene (nur privater Build). Ergebnisse werden je
 * Quelle/Seite/Drehung zwischengespeichert, damit Schwärzen und Fragen dieselbe
 * Erkennung nutzen und Scans nur einmal an Claude gehen.
 */
import { defineStore } from 'pinia'
import { watch } from 'vue'

import { normalizeRotation } from '@/lib/geometry'
import type { TextLine } from '@/lib/textLines'
import { getTextLines } from '@/services/pdfRenderer'
import { useDocumentStore } from '@/stores/document'
import type { PageRef } from '@/types/pdf'

import { requestOcr } from '../ocr/api'
import { ocrToTextLines } from '../ocr/lines'
import { renderPageImage } from '../ocr/render'

export interface PageLines {
  lines: TextLine[]
  /** 'text' = Textebene der PDF, 'ocr' = Bilderkennung, 'none' = nichts gefunden. */
  source: 'text' | 'ocr' | 'none'
}

export const useOcrStore = defineStore('ocr', () => {
  const doc = useDocumentStore()
  /** Nicht reaktiv: nur Cache. */
  const cache = new Map<string, TextLine[]>()

  function keyOf(page: PageRef): string {
    return `${page.sourceId}|${page.sourceIndex}|${normalizeRotation(page.baseRotation + page.rotation)}`
  }

  function isCached(page: PageRef): boolean {
    return cache.has(keyOf(page))
  }

  /** Bilderkennung einer Seite (gecacht). Fehler und Abbruch werden geworfen. */
  async function recognize(page: PageRef, signal: AbortSignal): Promise<TextLine[]> {
    const key = keyOf(page)
    const hit = cache.get(key)
    if (hit) return hit
    const { image, display } = await renderPageImage(page, signal)
    const lines = ocrToTextLines(await requestOcr(image, signal), image, display)
    signal.throwIfAborted()
    cache.set(key, lines)
    return lines
  }

  /**
   * Zeilen einer Seite: Textebene, sonst (wenn `ocr`) Bilderkennung.
   * Positionen im angezeigten Seitenraum der aktuellen Drehung.
   */
  async function linesFor(
    page: PageRef,
    signal: AbortSignal,
    options: { ocr: boolean },
  ): Promise<PageLines> {
    const rotation = normalizeRotation(page.baseRotation + page.rotation)
    const text = await getTextLines(page.sourceId, page.sourceIndex, rotation)
    if (text.some((l) => l.text.trim() !== '')) return { lines: text, source: 'text' }
    if (!options.ocr) return { lines: [], source: 'none' }
    const lines = await recognize(page, signal)
    return { lines, source: lines.length > 0 ? 'ocr' : 'none' }
  }

  function clear(): void {
    cache.clear()
  }

  watch(
    () => doc.hasDocument,
    (has) => {
      if (!has) clear()
    },
  )

  return { linesFor, recognize, isCached, clear }
})
