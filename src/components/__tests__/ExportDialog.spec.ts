import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { PDFDocument } from 'pdf-lib'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ExportDialog from '@/components/ExportDialog.vue'
import { downloadBytes } from '@/lib/file'
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
vi.mock('@/lib/file', async (orig) => ({
  ...(await orig<typeof import('@/lib/file')>()),
  downloadBytes: vi.fn<(b: Uint8Array, n: string) => void>(),
}))

const printMock = vi.hoisted(() => ({
  render: vi.fn<(bytes: Uint8Array) => Promise<string[]>>(async () => ['blob:1']),
  print: vi.fn<(urls: readonly string[]) => Promise<void>>(async () => undefined),
}))
vi.mock('@/lib/print', () => ({
  renderForPrint: printMock.render,
  printImages: printMock.print,
}))

async function open(pages: number) {
  const store = useDocumentStore()
  const pdf = await PDFDocument.create()
  for (let i = 0; i < pages; i++) pdf.addPage([100 + i, 200])
  await store.addFiles([
    new File([(await pdf.save()) as BlobPart], 'brief.pdf', { type: 'application/pdf' }),
  ])
  return store
}

// Offene Dialoge hören auf window-Tasten: nach jedem Test abbauen.
enableAutoUnmount(afterEach)

describe('ExportDialog', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(downloadBytes).mockClear()
  })

  it('ohne Markierung: „Alle“ vorausgewählt, „markierte“ gesperrt', async () => {
    await open(3)
    const w = mount(ExportDialog)
    expect((w.get('[data-testid="export-all"]').element as HTMLInputElement).checked).toBe(true)
    expect(w.get('[data-testid="export-marked"]').attributes('disabled')).toBeDefined()
    expect(w.get('[data-testid="export-confirm"]').text()).toBe('3 Seiten exportieren')
    await w.get('[data-testid="export-confirm"]').trigger('click')
    await flushPromises()
    expect(vi.mocked(downloadBytes).mock.calls[0]![1]).toBe('brief-bearbeitet.pdf')
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('mit Markierung: exportiert nur markierte Seiten', async () => {
    const store = await open(4)
    store.toggleMarked(store.pages[2]!.id)
    store.toggleMarked(store.pages[0]!.id)
    store.toggleMarked(store.pages[1]!.id)
    const w = mount(ExportDialog)
    expect((w.get('[data-testid="export-marked"]').element as HTMLInputElement).checked).toBe(true)
    expect(w.text()).toContain('(Seite 1–3)')
    await w.get('[data-testid="export-confirm"]').trigger('click')
    await flushPromises()
    const [bytes, name] = vi.mocked(downloadBytes).mock.calls[0]!
    expect(name).toBe('brief-bearbeitet-seite-1-3.pdf')
    const out = await PDFDocument.load(bytes)
    expect(out.getPages().map((p) => p.getWidth())).toEqual([100, 101, 102])
  })

  it('aktuelle Seite', async () => {
    const store = await open(3)
    store.selectPage(store.pages[1]!.id)
    const w = mount(ExportDialog)
    await w.get('[data-testid="export-current"]').setValue(true)
    expect(w.get('[data-testid="export-confirm"]').text()).toBe('1 Seite exportieren')
    await w.get('[data-testid="export-confirm"]').trigger('click')
    await flushPromises()
    const [bytes, name] = vi.mocked(downloadBytes).mock.calls[0]!
    expect(name).toBe('brief-bearbeitet-seite-2.pdf')
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1)
  })

  it('Druckmodus: druckt die gewählten Seiten mit Änderungen, ohne Download', async () => {
    const store = await open(3)
    store.toggleMarked(store.pages[2]!.id)
    const w = mount(ExportDialog, { props: { mode: 'print' } })
    expect(w.text()).toContain('Drucken')
    expect(w.get('[data-testid="export-confirm"]').text()).toBe('1 Seite drucken')
    await w.get('[data-testid="export-confirm"]').trigger('click')
    await flushPromises()
    const bytes = printMock.render.mock.calls[0]![0]
    expect((await PDFDocument.load(bytes)).getPages().map((p) => p.getWidth())).toEqual([102])
    expect(printMock.print).toHaveBeenCalledWith(['blob:1'])
    expect(downloadBytes).not.toHaveBeenCalled()
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('Tasten: 1/2/3 wählen den Umfang, Enter startet, Esc schließt', async () => {
    await open(3)
    const w = mount(ExportDialog, { attachTo: document.body })
    const key = (k: string) =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key: k, cancelable: true }))
    // „2“ ohne markierte Seiten bleibt wirkungslos.
    key('2')
    await flushPromises()
    expect((w.get('[data-testid="export-all"]').element as HTMLInputElement).checked).toBe(true)
    key('3')
    await flushPromises()
    expect((w.get('[data-testid="export-current"]').element as HTMLInputElement).checked).toBe(true)
    key('Enter')
    await flushPromises()
    expect(vi.mocked(downloadBytes)).toHaveBeenCalledTimes(1)
    key('Escape')
    expect(w.emitted('close')?.length).toBeGreaterThanOrEqual(1)
  })

  describe('Teilen', () => {
    afterEach(() => vi.unstubAllGlobals())

    function stubShare(share?: (data: ShareData) => Promise<void>) {
      const fn = vi.fn<(data: ShareData) => Promise<void>>(share ?? (async () => undefined))
      vi.stubGlobal('navigator', {
        ...navigator,
        share: share ? fn : undefined,
        canShare: share ? () => true : undefined,
      })
      return fn
    }

    it('öffnet das Teilen-Menü mit der PDF der gewählten Seiten, ohne Download', async () => {
      const share = stubShare(async () => undefined)
      const store = await open(3)
      store.toggleMarked(store.pages[1]!.id)
      const w = mount(ExportDialog, { props: { mode: 'share' } })
      expect(w.get('#export-title').text()).toBe('Teilen')
      expect(w.get('[data-testid="share-note"]').text()).toContain('nicht hochgeladen')
      expect(w.get('[data-testid="export-confirm"]').text()).toBe('1 Seite teilen')
      await w.get('[data-testid="export-confirm"]').trigger('click')
      await flushPromises()
      const file = share.mock.calls[0]![0].files![0]!
      expect(file.name).toBe('brief-bearbeitet-seite-2.pdf')
      const out = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()))
      expect(out.getPages().map((p) => p.getWidth())).toEqual([101])
      expect(downloadBytes).not.toHaveBeenCalled()
      expect(w.emitted('close')).toHaveLength(1)
    })

    it('ohne Unterstützung: Hinweis und Download', async () => {
      stubShare()
      await open(2)
      const w = mount(ExportDialog, { props: { mode: 'share' } })
      expect(w.get('[data-testid="share-note"]').text()).toContain('heruntergeladen')
      expect(w.get('[data-testid="export-confirm"]').text()).toBe('2 Seiten herunterladen')
      await w.get('[data-testid="export-confirm"]').trigger('click')
      await flushPromises()
      expect(vi.mocked(downloadBytes).mock.calls[0]![1]).toBe('brief-bearbeitet.pdf')
      expect(w.emitted('close')).toHaveLength(1)
    })

    it('Aktivierung abgelaufen: bleibt offen und teilt beim zweiten Klick dieselbe PDF', async () => {
      let calls = 0
      const share = stubShare(async () => {
        calls++
        if (calls === 1) throw new DOMException('keine Aktivierung', 'NotAllowedError')
      })
      const store = await open(2)
      const exportSpy = vi.spyOn(store, 'exportDocument')
      const w = mount(ExportDialog, { props: { mode: 'share' } })
      await w.get('[data-testid="export-confirm"]').trigger('click')
      await flushPromises()
      expect(w.emitted('close')).toBeUndefined()
      expect(w.get('[data-testid="export-confirm"]').text()).toBe('Jetzt teilen')
      await w.get('[data-testid="export-confirm"]').trigger('click')
      await flushPromises()
      expect(share).toHaveBeenCalledTimes(2)
      expect(exportSpy).toHaveBeenCalledTimes(1)
      expect(share.mock.calls[1]![0].files![0]!.name).toBe('brief-bearbeitet.pdf')
      expect(w.emitted('close')).toHaveLength(1)
    })

    it('Abbruch im Teilen-Menü schließt den Dialog ohne Fehlermeldung', async () => {
      stubShare(async () => {
        throw new DOMException('abgebrochen', 'AbortError')
      })
      const store = await open(1)
      const w = mount(ExportDialog, { props: { mode: 'share' } })
      await w.get('[data-testid="export-confirm"]').trigger('click')
      await flushPromises()
      expect(store.error).toBeNull()
      expect(downloadBytes).not.toHaveBeenCalled()
      expect(w.emitted('close')).toHaveLength(1)
    })
  })
})
