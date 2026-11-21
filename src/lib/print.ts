/**
 * Drucken: die exportierte PDF (mit allen Änderungen) wird mit pdf.js in Bilder
 * gerendert und über den Druckdialog des Browsers ausgegeben. Bilder statt einer
 * eingebetteten PDF, weil das ohne iframe/Plugin in allen Browsern funktioniert und
 * keine CSP-Ausnahme (frame-src blob:) braucht.
 */
import { createId } from '@/lib/id'
import { closeDocument, openDocument, renderPage } from '@/services/pdfRenderer'

/** Druckauflösung: Pixel pro PDF-Punkt (2,5 ≈ 180 dpi). */
export const PRINT_PX_PER_PT = 2.5
const ROOT_ID = 'pdf-editor-print-root'

const PRINT_CSS = `
@media screen { #${ROOT_ID} { display: none !important; } }
@media print {
  @page { margin: 0; }
  html, body { margin: 0 !important; padding: 0 !important; height: auto !important; overflow: visible !important; }
  body > *:not(#${ROOT_ID}) { display: none !important; }
  #${ROOT_ID} { display: block !important; }
  #${ROOT_ID} img {
    display: block; width: 100vw; height: 100vh; object-fit: contain;
    break-after: page; page-break-after: always;
  }
  #${ROOT_ID} img:last-child { break-after: auto; page-break-after: auto; }
}`

function canvasToUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(URL.createObjectURL(blob)) : reject(new Error('Leeres Bild'))),
      'image/png',
    )
  })
}

/** Rendert alle Seiten der PDF als Bild-URLs (Aufrufer gibt sie mit revokeObjectURL frei). */
export async function renderForPrint(bytes: Uint8Array, signal?: AbortSignal): Promise<string[]> {
  const id = createId('print')
  const infos = await openDocument(id, bytes)
  const urls: string[] = []
  try {
    const dpr = window.devicePixelRatio || 1
    for (let i = 0; i < infos.length; i++) {
      if (signal?.aborted) break
      const canvas = document.createElement('canvas')
      await renderPage(canvas, {
        sourceId: id,
        pageIndex: i,
        rotation: infos[i]!.rotation,
        scale: PRINT_PX_PER_PT / dpr,
        signal,
      })
      urls.push(await canvasToUrl(canvas))
      canvas.width = 0 // Speicher sofort freigeben
    }
  } catch (err) {
    urls.forEach((u) => URL.revokeObjectURL(u))
    throw err
  } finally {
    await closeDocument(id)
  }
  return urls
}

/**
 * Zeigt die Seitenbilder nur im Druck an und öffnet den Druckdialog.
 * Aufräumen nach `afterprint` (bzw. spätestens nach 60 s).
 */
export async function printImages(urls: readonly string[]): Promise<void> {
  document.getElementById(ROOT_ID)?.remove()
  const root = document.createElement('div')
  root.id = ROOT_ID
  const style = document.createElement('style')
  style.textContent = PRINT_CSS
  root.appendChild(style)
  const imgs = urls.map((url, i) => {
    const img = document.createElement('img')
    img.src = url
    img.alt = `Seite ${i + 1}`
    root.appendChild(img)
    return img
  })
  document.body.appendChild(root)
  await Promise.all(imgs.map((img) => img.decode().catch(() => undefined)))

  let done = false
  const cleanup = () => {
    if (done) return
    done = true
    window.removeEventListener('afterprint', cleanup)
    root.remove()
    urls.forEach((u) => URL.revokeObjectURL(u))
  }
  window.addEventListener('afterprint', cleanup)
  // Manche Browser feuern kein afterprint; Bilder dann später freigeben.
  setTimeout(cleanup, 60_000)
  window.print()
}
