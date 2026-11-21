/**
 * Werkzeug „Bilder“ (privater Build): Bilder einer Seite finden, löschen, ersetzen.
 * Löschen legt eine weiße, echte Schwärzung über das Bild (deckend angezeigt); beim
 * Export entfernt MuPDF die Bildpixel darunter. Ersetzen = löschen + neues Bild
 * einpassen, beides ein Undo-Schritt.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

import { displaySize, normalizeRotation } from '@/lib/geometry'
import { readImageFile } from '@/lib/image'
import { useDocumentStore } from '@/stores/document'
import type { PageRef } from '@/types/pdf'

import {
  detectImageRegions,
  findEmbeddedImages,
  fitInto,
  padRect,
  type FoundImage,
} from '../images/detect'
import { renderPageImage } from '../ocr/render'

export interface ImageItem extends FoundImage {
  id: string
  pageId: string
  /** Herkunft: eingebettetes PDF-Bild oder von Claude erkannter Bereich. */
  source: 'pdf' | 'ai'
}

/** Farbe der Löschfläche (Papierweiß). */
export const ERASE_COLOR = '#ffffff'
/** KI-Rechtecke sind Schätzungen: etwas Rand dazugeben. */
const AI_PAD = 3

let seq = 0

function displayOf(page: PageRef): { width: number; height: number } {
  return displaySize(page.box, normalizeRotation(page.baseRotation + page.rotation))
}

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && ['SuggestApiError', 'ImageError'].includes(err.name)
    ? err.message
    : fallback
}

export const useImagesStore = defineStore('privateImages', () => {
  const items = ref<ImageItem[]>([])
  /** Seiten, die schon (ohne KI) durchsucht wurden. */
  const scanned = ref<string[]>([])
  const busy = ref<'pdf' | 'ai' | null>(null)
  const error = ref<string | null>(null)
  const hoverId = ref<string | null>(null)
  let controller: AbortController | null = null

  const forPage = (pageId: string) => items.value.filter((i) => i.pageId === pageId)

  function setItems(pageId: string, source: ImageItem['source'], found: FoundImage[]): void {
    const keep = items.value.filter((i) => !(i.pageId === pageId && i.source === source))
    const added = found.map((f) => ({ ...f, id: `img-${++seq}`, pageId, source }))
    items.value = [...keep, ...added]
  }

  /** Eingebettete Bilder der Seite (ohne KI, ohne Kosten). */
  async function scan(page: PageRef): Promise<void> {
    if (busy.value) return
    const doc = useDocumentStore()
    const bytes = doc.sourceBytesFor(page.sourceId)
    if (!bytes) return
    busy.value = 'pdf'
    error.value = null
    try {
      setItems(page.id, 'pdf', await findEmbeddedImages(bytes, page, displayOf(page)))
      if (!scanned.value.includes(page.id)) scanned.value.push(page.id)
    } catch (err) {
      console.error('[pdf-editor] Bildsuche:', err)
      error.value = 'Die Bilder der Seite konnten nicht gelesen werden.'
    } finally {
      busy.value = null
    }
  }

  /** Bildbereiche per Claude (Scans, Logos, Stempel, Unterschriften). */
  async function scanWithAi(page: PageRef): Promise<void> {
    if (busy.value) return
    busy.value = 'ai'
    error.value = null
    controller = new AbortController()
    try {
      const { image, display } = await renderPageImage(page, controller.signal)
      setItems(page.id, 'ai', await detectImageRegions(image, display, controller.signal))
    } catch (err) {
      if (controller?.signal.aborted) return
      console.error('[pdf-editor] Bilderkennung:', err)
      error.value = messageOf(err, 'Die Bilderkennung ist fehlgeschlagen.')
    } finally {
      busy.value = null
      controller = null
    }
  }

  /** Ergebnisse einer Seite verwerfen (z. B. nach Drehen). */
  function forget(pageId: string): void {
    items.value = items.value.filter((i) => i.pageId !== pageId)
    scanned.value = scanned.value.filter((id) => id !== pageId)
  }

  function clear(): void {
    cancel()
    items.value = []
    scanned.value = []
    error.value = null
    hoverId.value = null
  }

  function cancel(): void {
    controller?.abort()
  }

  function eraseRect(page: PageRef, item: ImageItem) {
    return item.source === 'ai' ? padRect(item.rect, AI_PAD, displayOf(page)) : item.rect
  }

  /** Entfernt den Eintrag und alle, die die Löschfläche (fast) ganz abdeckt. */
  function drop(
    item: ImageItem,
    erased: { x: number; y: number; width: number; height: number },
  ): void {
    const covered = (r: ImageItem['rect']) => {
      const w = Math.min(r.x + r.width, erased.x + erased.width) - Math.max(r.x, erased.x)
      const h = Math.min(r.y + r.height, erased.y + erased.height) - Math.max(r.y, erased.y)
      return w > 0 && h > 0 && w * h >= r.width * r.height * 0.8
    }
    items.value = items.value.filter(
      (i) => i.id !== item.id && !(i.pageId === item.pageId && covered(i.rect)),
    )
    if (hoverId.value && !items.value.some((i) => i.id === hoverId.value)) hoverId.value = null
  }

  /** Löscht das Bild: weiße, echte Schwärzung darüber (Rückgängig möglich). */
  function remove(page: PageRef, item: ImageItem, group?: string): void {
    const doc = useDocumentStore()
    const rect = eraseRect(page, item)
    doc.addAnnotation(
      page.id,
      {
        kind: 'cover',
        ...rect,
        color: ERASE_COLOR,
        redact: true,
        solid: true,
      },
      group,
    )
    doc.selectedAnnotationId = null
    drop(item, rect)
  }

  /** Ersetzt das Bild durch eine Datei (eingepasst, Seitenverhältnis bleibt). */
  async function replace(page: PageRef, item: ImageItem, file: File): Promise<boolean> {
    error.value = null
    try {
      const img = await readImageFile(file)
      const doc = useDocumentStore()
      const group = doc.newGroup('image-replace')
      const box = eraseRect(page, item)
      remove(page, item, group)
      doc.addAnnotation(
        page.id,
        { kind: 'image', dataUrl: img.dataUrl, ...fitInto(img, box) },
        group,
      )
      doc.closeHistoryGroup()
      return true
    } catch (err) {
      console.error('[pdf-editor] Bild ersetzen:', err)
      error.value = messageOf(err, 'Das Bild konnte nicht ersetzt werden.')
      return false
    }
  }

  return {
    items,
    scanned,
    busy,
    error,
    hoverId,
    forPage,
    scan,
    scanWithAi,
    cancel,
    forget,
    clear,
    remove,
    replace,
  }
})
