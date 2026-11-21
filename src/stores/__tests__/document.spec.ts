import { PDFDocument } from 'pdf-lib'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useDocumentStore } from '@/stores/document'

// pdf.js (Worker, Canvas) wird im Test durch eine schlanke Attrappe ersetzt.
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

async function pdfFile(name: string, pageCount: number): Promise<File> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pageCount; i++) doc.addPage([100 + i, 200])
  const bytes = await doc.save()
  return new File([bytes as BlobPart], name, { type: 'application/pdf' })
}

describe('document store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('lädt mehrere PDFs und hängt die Seiten an', async () => {
    const store = useDocumentStore()
    const res = await store.addFiles([await pdfFile('a.pdf', 2), await pdfFile('b.pdf', 1)])
    expect(res).toEqual({ added: 3, errors: [] })
    expect(store.pages).toHaveLength(3)
    expect(store.sources.map((s) => s.name)).toEqual(['a.pdf', 'b.pdf'])
    expect(store.selectedPageId).toBe(store.pages[0]?.id)
    expect(store.suggestedFileName).toBe('a-zusammengefuehrt.pdf')
  })

  it('meldet ungültige Dateien, ohne gültige zu verwerfen', async () => {
    const store = useDocumentStore()
    const bad = new File(['hallo'], 'x.pdf', { type: 'application/pdf' })
    const res = await store.addFiles([bad, await pdfFile('ok.pdf', 1)])
    expect(res.added).toBe(1)
    expect(res.errors).toEqual(['x.pdf: Keine PDF-Datei.'])
    expect(store.error).toContain('x.pdf')
    expect(store.busy).toBe(false)
  })

  it('verschiebt, dreht und löscht Seiten', async () => {
    const store = useDocumentStore()
    await store.addFiles([await pdfFile('a.pdf', 3)])
    const [p0, p1, p2] = store.pages.map((p) => p.id)

    store.movePage(0, 2)
    expect(store.pages.map((p) => p.id)).toEqual([p1, p2, p0])
    store.movePage(0, 99) // ungültig → keine Änderung
    expect(store.pages.map((p) => p.id)).toEqual([p1, p2, p0])

    store.rotatePage(p1!, 'ccw')
    expect(store.pages[0]?.rotation).toBe(270)

    store.selectPage(p2!)
    store.removePage(p2!)
    expect(store.pages.map((p) => p.id)).toEqual([p1, p0])
    expect(store.selectedPageId).toBe(p0) // Nachfolger wird ausgewählt
  })

  it('hält Quellen gelöschter Seiten für Undo bereit und gibt sie danach frei', async () => {
    const store = useDocumentStore()
    await store.addFiles([await pdfFile('a.pdf', 1)])
    store.removePage(store.pages[0]!.id)
    expect(store.pages).toHaveLength(0)
    expect(store.sources).toHaveLength(1) // noch im Verlauf

    await store.reset()
    expect(store.sources).toHaveLength(0)
    expect(store.canUndo).toBe(false)
  })

  it('macht Seitenoperationen rückgängig und wiederholt sie', async () => {
    const store = useDocumentStore()
    await store.addFiles([await pdfFile('a.pdf', 3)])
    const order = store.pages.map((p) => p.id)

    store.movePage(0, 2)
    store.rotatePage(store.pages[0]!.id, 'cw')
    store.removePage(store.pages[1]!.id)
    expect(store.undoCount).toBe(4) // Laden + 3 Änderungen

    store.undo()
    store.undo()
    store.undo()
    expect(store.pages.map((p) => p.id)).toEqual(order)
    expect(store.pages.every((p) => p.rotation === 0)).toBe(true)

    store.redo()
    expect(store.pages.map((p) => p.id)).toEqual([order[1], order[2], order[0]])

    // Undo des Ladens entfernt die Seiten, Redo bringt sie zurück
    store.undo()
    store.undo()
    expect(store.pages).toHaveLength(0)
    store.redo()
    expect(store.pages).toHaveLength(3)
  })

  it('bündelt Ziehen und Tippen zu je einem Schritt', async () => {
    const store = useDocumentStore()
    await store.addFiles([await pdfFile('a.pdf', 1)])
    const pageId = store.pages[0]!.id
    const before = store.undoCount

    const edit = store.newGroup('edit')
    const id = store.addAnnotation(
      pageId,
      { kind: 'text', text: '', fontSize: 12, color: '#000', x: 0, y: 0 },
      edit,
    )!
    for (const text of ['H', 'Ha', 'Hal', 'Hallo']) {
      store.updateAnnotation(pageId, id, { text }, edit)
    }
    const drag = store.newGroup('drag')
    for (let x = 1; x <= 10; x++) store.updateAnnotation(pageId, id, { x }, drag)
    store.closeHistoryGroup()

    expect(store.undoCount).toBe(before + 2)
    store.undo()
    expect(store.pages[0]!.annotations[0]).toMatchObject({ text: 'Hallo', x: 0 })
    store.undo()
    expect(store.pages[0]!.annotations).toHaveLength(0)
  })

  it('verwirft leere Schritte (Klick ohne Bewegung, Text ohne Eingabe)', async () => {
    const store = useDocumentStore()
    await store.addFiles([await pdfFile('a.pdf', 1)])
    const pageId = store.pages[0]!.id
    const before = store.undoCount

    const edit = store.newGroup('edit')
    const id = store.addAnnotation(
      pageId,
      { kind: 'text', text: '', fontSize: 12, color: '#000', x: 0, y: 0 },
      edit,
    )!
    store.removeAnnotation(pageId, id, edit)
    store.closeHistoryGroup()
    expect(store.undoCount).toBe(before)
  })

  it('begrenzt den Verlauf auf 50 Schritte', async () => {
    const store = useDocumentStore()
    await store.addFiles([await pdfFile('a.pdf', 1)])
    const pageId = store.pages[0]!.id
    for (let i = 0; i < 60; i++) store.rotatePage(pageId, 'cw')
    expect(store.undoCount).toBe(50)
    let n = 0
    while (store.undo()) n++
    expect(n).toBe(50)
    expect(store.canRedo).toBe(true)
  })

  it('verwaltet Annotationen und dreht sie mit', async () => {
    const store = useDocumentStore()
    await store.addFiles([await pdfFile('a.pdf', 1)])
    const page = store.pages[0]!
    const id = store.addAnnotation(page.id, {
      kind: 'highlight',
      color: '#ff0',
      x: 0,
      y: 0,
      width: 10,
      height: 20,
    })
    expect(id).not.toBeNull()
    expect(store.selectedAnnotationId).toBe(id)

    store.updateAnnotation(page.id, id!, { x: 5 })
    store.rotatePage(page.id, 'cw')
    expect(store.pages[0]!.annotations[0]).toMatchObject({ width: 20, height: 10, y: 5 })

    store.removeAnnotation(page.id, id!)
    expect(store.pages[0]!.annotations).toHaveLength(0)
    expect(store.selectedAnnotationId).toBeNull()
  })

  it('ersetzt Textzeilen genau einmal und löscht die Abdeckung mit', async () => {
    const store = useDocumentStore()
    await store.addFiles([await pdfFile('a.pdf', 1)])
    const page = store.pages[0]!
    const line = {
      key: 'k1',
      text: 'Alt',
      x: 10,
      top: 20,
      width: 30,
      height: 12,
      baseline: 29,
      fontSize: 12.2,
      font: 'serif' as const,
      segments: [],
    }
    const id = store.replaceTextLine(page.id, line)
    expect(store.replaceTextLine(page.id, line)).toBe(id) // kein Duplikat
    const anns = store.pages[0]!.annotations
    expect(anns.map((a) => a.kind)).toEqual(['cover', 'text'])
    const text = anns[1]!
    expect(text).toMatchObject({
      kind: 'text',
      fontSize: 12,
      color: '#000000',
      x: 10,
      font: 'serif',
    })
    expect(text.kind === 'text' && text.coverId).toBe(anns[0]!.id)
    // Abdeckung umschließt die Zeile
    const cover = anns[0]!
    expect(cover.kind === 'cover' && cover.x < 10 && cover.x + cover.width > 40).toBe(true)
    expect(store.selectedAnnotation?.id).toBe(id)

    store.removeAnnotation(page.id, id!)
    expect(store.pages[0]!.annotations).toHaveLength(0)
  })

  it('begrenzt den Zoom', () => {
    const store = useDocumentStore()
    store.setZoom(100)
    expect(store.zoom).toBe(4)
    store.setZoom(0)
    expect(store.zoom).toBe(0.25)
    store.setZoom(Number.NaN)
    expect(store.zoom).toBe(0.25)
  })

  it('exportiert in der aktuellen Reihenfolge', async () => {
    const store = useDocumentStore()
    await store.addFiles([await pdfFile('a.pdf', 2)])
    store.movePage(1, 0)
    const out = await PDFDocument.load(await store.exportDocument())
    expect(out.getPages().map((p) => p.getWidth())).toEqual([101, 100])
  })

  it('setzt Fehlermeldung, wenn der Export ohne Seiten scheitert', async () => {
    const store = useDocumentStore()
    await expect(store.exportDocument()).rejects.toThrow(/keine Seiten/)
    expect(store.error).toMatch(/keine Seiten/)
  })

  it('markiert Seiten und exportiert nur die Auswahl (Dokumentreihenfolge)', async () => {
    const store = useDocumentStore()
    await store.addFiles([await pdfFile('a.pdf', 4)])
    const [p0, p1, p2, p3] = store.pages.map((p) => p.id)
    store.toggleMarked(p3!)
    store.toggleMarked(p1!)
    store.toggleMarked('gibt-es-nicht')
    expect(store.markedPages.map((p) => p.id)).toEqual([p1, p3])
    const out = await PDFDocument.load(await store.exportDocument([p3!, p1!]))
    expect(out.getPages().map((p) => p.getWidth())).toEqual([101, 103])
    expect(store.pages).toHaveLength(4) // Editor-Dokument unverändert

    store.removePage(p1!)
    expect(store.markedPages.map((p) => p.id)).toEqual([p3])
    store.undo()
    expect(store.markedPages.map((p) => p.id)).toEqual([p1, p3])
    store.toggleMarked(p1!)
    expect(store.markedPages.map((p) => p.id)).toEqual([p3])
    store.setAllMarked(true)
    expect(store.markedPages.map((p) => p.id)).toEqual([p0, p1, p2, p3])
    await expect(store.exportDocument([])).rejects.toThrow(/keine Seiten/)
    await store.reset()
    expect(store.markedPageIds).toEqual([])
  })
})
