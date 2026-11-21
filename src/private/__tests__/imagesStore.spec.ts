import { PDFDocument } from 'pdf-lib'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useImagesStore, type ImageItem } from '@/private/stores/images'
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
vi.mock('@/lib/image', async (orig) => ({
  ...(await orig<typeof import('@/lib/image')>()),
  readImageFile: async () => ({ dataUrl: 'data:image/png;base64,AAAA', width: 200, height: 100 }),
}))

async function open(): Promise<ReturnType<typeof useDocumentStore>> {
  const doc = useDocumentStore()
  const pdf = await PDFDocument.create()
  pdf.addPage([600, 800])
  await doc.addFiles([
    new File([(await pdf.save()) as BlobPart], 'a.pdf', { type: 'application/pdf' }),
  ])
  return doc
}

function item(source: 'pdf' | 'ai'): ImageItem {
  return {
    id: `i-${source}`,
    pageId: '',
    source,
    kind: source === 'pdf' ? 'embedded' : 'logo',
    label: 'x',
    rect: { x: 100, y: 100, width: 100, height: 100 },
    fullPage: false,
  }
}

describe('Bilder löschen/ersetzen', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('Löschen: weiße, deckende, echte Schwärzung; KI-Bereich mit Rand', async () => {
    const doc = await open()
    const page = doc.pages[0]!
    const images = useImagesStore()
    images.items = [
      { ...item('pdf'), pageId: page.id },
      { ...item('ai'), pageId: page.id },
    ]
    images.remove(page, images.items[1]!)
    // Das PDF-Bild liegt ganz unter der Löschfläche des KI-Bereichs → ebenfalls erledigt.
    expect(images.items).toEqual([])
    images.items = [{ ...item('pdf'), pageId: page.id }]
    images.remove(page, images.items[0]!)
    expect(images.items).toEqual([])
    expect(doc.pages[0]!.annotations).toMatchObject([
      { kind: 'cover', x: 97, width: 106, color: '#ffffff', redact: true, solid: true },
      { kind: 'cover', x: 100, width: 100, color: '#ffffff', redact: true, solid: true },
    ])
    doc.undo()
    expect(doc.pages[0]!.annotations).toHaveLength(1)
  })

  it('Ersetzen: Löschfläche + eingepasstes Bild in einem Undo-Schritt', async () => {
    const doc = await open()
    const page = doc.pages[0]!
    const images = useImagesStore()
    images.items = [{ ...item('pdf'), pageId: page.id }]
    const ok = await images.replace(
      page,
      images.items[0]!,
      new File(['x'], 'a.png', { type: 'image/png' }),
    )
    expect(ok).toBe(true)
    expect(doc.pages[0]!.annotations).toMatchObject([
      { kind: 'cover', solid: true },
      { kind: 'image', x: 100, y: 125, width: 100, height: 50 },
    ])
    doc.undo()
    expect(doc.pages[0]!.annotations).toHaveLength(0)
  })

  it('forget/clear verwerfen Ergebnisse', () => {
    const images = useImagesStore()
    images.items = [
      { ...item('pdf'), pageId: 'a' },
      { ...item('ai'), pageId: 'b' },
    ]
    images.scanned = ['a', 'b']
    images.forget('a')
    expect(images.items.map((i) => i.pageId)).toEqual(['b'])
    expect(images.scanned).toEqual(['b'])
    images.clear()
    expect(images.items).toEqual([])
  })
})
