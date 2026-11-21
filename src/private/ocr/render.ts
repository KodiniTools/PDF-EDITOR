/** Rendert eine Seite als JPEG für die Bilderkennung (Browser, Canvas). */
import { displaySize, normalizeRotation } from '@/lib/geometry'
import { renderPage } from '@/services/pdfRenderer'
import type { PageRef } from '@/types/pdf'

import type { OcrImage } from './api'

/** Längste Bildseite: Claude verkleinert größere Bilder ohnehin auf diese Größe. */
export const OCR_MAX_SIDE = 1568
/** Base64-Größe deutlich unter dem 1-MB-Limit von nginx/Backend. */
export const OCR_MAX_BASE64 = 700_000

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result)
      resolve(url.slice(url.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('FileReader'))
    reader.readAsDataURL(blob)
  })
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/jpeg', quality)
  })
}

export async function renderPageImage(
  page: PageRef,
  signal: AbortSignal,
): Promise<{ image: OcrImage; display: { width: number; height: number } }> {
  const rotation = normalizeRotation(page.baseRotation + page.rotation)
  const display = displaySize(page.box, rotation)
  const dpr = window.devicePixelRatio || 1
  // renderPage multipliziert mit devicePixelRatio → herausrechnen.
  const scale = OCR_MAX_SIDE / Math.max(display.width, display.height) / dpr
  const canvas = document.createElement('canvas')
  try {
    await renderPage(canvas, {
      sourceId: page.sourceId,
      pageIndex: page.sourceIndex,
      rotation,
      scale,
      signal,
    })
    signal.throwIfAborted()
    // Weißer Hintergrund statt transparent (JPEG).
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.globalCompositeOperation = 'destination-over'
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    let image = ''
    for (const quality of [0.85, 0.7, 0.55, 0.4]) {
      image = await toBase64(await toJpeg(canvas, quality))
      if (image.length <= OCR_MAX_BASE64) break
    }
    return {
      image: { image, mediaType: 'image/jpeg', width: canvas.width, height: canvas.height },
      display,
    }
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}
