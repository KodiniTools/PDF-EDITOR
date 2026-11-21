import { PDFDocument } from 'pdf-lib'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fitWithin, placeOnPage, readImageFile } from '@/lib/image'
import { useDocumentStore } from '@/stores/document'

vi.mock('@/services/pdfRenderer', () => ({
  openDocument: async (_id: string, bytes: Uint8Array) => {
    const doc = await PDFDocument.load(bytes)
    return doc.getPages().map((p) => ({
      box: { x: 0, y: 0, width: p.getWidth(), height: p.getHeight() },
      rotation: 0,
    }))
  },
  closeDocument: async () => undefined,
  renderPage: async () => undefined,
  getTextLines: async () => [],
}))

const PNG = 'data:image/png;base64,iVBORw0KGgo='

async function openA4(store: ReturnType<typeof useDocumentStore>): Promise<void> {
  const doc = await PDFDocument.create()
  doc.addPage([600, 800])
  const file = new File([(await doc.save()) as BlobPart], 'a.pdf', { type: 'application/pdf' })
  await store.addFiles([file])
}

describe('Bild-Hilfen', () => {
  it('fitWithin verkleinert nur zu große Bilder', () => {
    expect(fitWithin(4800, 1200, 2400)).toEqual({ width: 2400, height: 600 })
    expect(fitWithin(300, 200, 2400)).toEqual({ width: 300, height: 200 })
  })
  it('placeOnPage: max. 40 % Breite / 50 % Höhe, zentriert, Seitenverhältnis', () => {
    expect(placeOnPage({ width: 1000, height: 500 }, { width: 600, height: 800 })).toEqual({
      x: 180,
      y: 340,
      width: 240,
      height: 120,
    })
    const tall = placeOnPage({ width: 100, height: 2000 }, { width: 600, height: 800 })
    expect(tall.height).toBe(400)
    expect(tall.width).toBe(20)
    const small = placeOnPage({ width: 50, height: 50 }, { width: 600, height: 800 })
    expect(small.width).toBe(50)
  })
  it('readImageFile lehnt falsche Typen und zu große Dateien ab', async () => {
    await expect(
      readImageFile(new File(['x'], 'a.svg', { type: 'image/svg+xml' })),
    ).rejects.toThrow(/Nur PNG/)
    const big = new File(['x'], 'a.png', { type: 'image/png' })
    Object.defineProperty(big, 'size', { value: 30 * 1024 * 1024 })
    await expect(readImageFile(big)).rejects.toThrow(/zu groß/)
  })
})

describe('Bild einfügen und löschen (Store)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('fügt das Bild zentriert ein, wählt es aus; Löschen und Rückgängig', async () => {
    const store = useDocumentStore()
    await openA4(store)
    store.setTool('text')
    const id = store.addImage({ dataUrl: PNG, width: 1000, height: 500 })
    const page = store.pages[0]!
    expect(page.annotations).toHaveLength(1)
    expect(page.annotations[0]).toMatchObject({ id, kind: 'image', x: 180, width: 240 })
    expect(store.selectedAnnotationId).toBe(id)
    expect(store.tool).toBe('select')

    expect(store.removeSelectedAnnotation()).toBe(true)
    expect(store.pages[0]!.annotations).toHaveLength(0)
    expect(store.selectedAnnotationId).toBeNull()
    expect(store.removeSelectedAnnotation()).toBe(false)

    store.undo()
    expect(store.pages[0]!.annotations).toHaveLength(1)
    store.undo()
    expect(store.pages[0]!.annotations).toHaveLength(0)
  })

  it('ohne Dokument passiert nichts', () => {
    const store = useDocumentStore()
    expect(store.addImage({ dataUrl: PNG, width: 10, height: 10 })).toBeNull()
  })
})
