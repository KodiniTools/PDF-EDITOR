import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { PDFDocument } from 'pdf-lib'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

import { useDocumentStore } from '@/stores/document'
import EditorView from '@/views/EditorView.vue'

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

const toolbarApi = vi.hoisted(() => ({
  openFile: vi.fn<() => void>(),
  openScan: vi.fn<() => void>(),
  openImage: vi.fn<() => void>(),
  newDocument: vi.fn<() => void>(),
}))

/** Werkzeugleiste ohne Dateidialoge; nur die von EditorView genutzte Schnittstelle. */
const ToolbarStub = defineComponent({
  setup(_p, { expose }) {
    expose(toolbarApi)
    return () => h('div')
  },
})

let wrapper: VueWrapper | null = null

function mountView(): VueWrapper {
  wrapper = mount(EditorView, {
    attachTo: document.body,
    global: {
      stubs: {
        AppToolbar: ToolbarStub,
        PageEditor: true,
        PageSidebar: true,
        SignatureDialog: true,
        ExportDialog: true,
        RouterLink: true,
      },
    },
  })
  return wrapper
}

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  window.dispatchEvent(e)
  return e
}

async function withPages(n: number) {
  const store = useDocumentStore()
  const pdf = await PDFDocument.create()
  for (let i = 0; i < n; i++) pdf.addPage([200, 300])
  await store.addFiles([
    new File([(await pdf.save()) as BlobPart], 'a.pdf', { type: 'application/pdf' }),
  ])
  return store
}

describe('EditorView – Tastenkürzel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    for (const f of Object.values(toolbarApi)) f.mockClear()
  })
  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  it('öffnet Dateien (Strg+O, O) und Scan (F) auch ohne Dokument', () => {
    mountView()
    const e = press('o', { ctrlKey: true })
    expect(e.defaultPrevented).toBe(true)
    press('o')
    press('f')
    expect(toolbarApi.openFile).toHaveBeenCalledTimes(2)
    expect(toolbarApi.openScan).toHaveBeenCalledTimes(1)
  })

  it('öffnet „Neues Dokument“ mit N, auch ohne Dokument, aber nicht mit Strg+N', () => {
    mountView()
    const e = press('n')
    expect(e.defaultPrevented).toBe(true)
    expect(toolbarApi.newDocument).toHaveBeenCalledTimes(1)
    // Strg+N (neues Browserfenster) bleibt unberührt.
    expect(press('n', { ctrlKey: true }).defaultPrevented).toBe(false)
    expect(toolbarApi.newDocument).toHaveBeenCalledTimes(1)
  })

  it('ignoriert Kürzel beim Tippen in Eingabefeldern', async () => {
    const store = await withPages(2)
    mountView()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true }))
    expect(toolbarApi.openFile).not.toHaveBeenCalled()
    expect(store.tool).toBe('select')
    input.remove()
  })

  it('zeigt und schließt die Übersicht (? / Esc)', async () => {
    mountView()
    press('?', { shiftKey: true })
    await flushPromises()
    expect(document.querySelector('[data-testid="shortcut-help"]')).not.toBeNull()
    // Bei offener Übersicht wirken andere Kürzel nicht.
    press('o')
    expect(toolbarApi.openFile).not.toHaveBeenCalled()
    press('Escape')
    await flushPromises()
    expect(document.querySelector('[data-testid="shortcut-help"]')).toBeNull()
  })

  it('blättert, verschiebt, dreht und markiert Seiten', async () => {
    const store = await withPages(3)
    mountView()
    const [p1, p2, p3] = store.pages.map((p) => p.id)
    press('ArrowDown')
    expect(store.selectedPageId).toBe(p2)
    press('End')
    expect(store.selectedPageId).toBe(p3)
    press('Home')
    expect(store.selectedPageId).toBe(p1)

    press('ArrowDown', { altKey: true })
    expect(store.pages.map((p) => p.id)).toEqual([p2, p1, p3])

    press('R', { shiftKey: true })
    expect(store.pages[1]!.rotation).toBe(90)

    press('m')
    expect(store.markedPages.map((p) => p.id)).toEqual([p1])
    press('a', { ctrlKey: true })
    expect(store.markedPages).toHaveLength(3)
    press('A', { ctrlKey: true, shiftKey: true })
    expect(store.markedPages).toHaveLength(0)

    press('Delete', { shiftKey: true })
    expect(store.pages).toHaveLength(2)
    press('z', { ctrlKey: true })
    expect(store.pages).toHaveLength(3)
  })

  it('verschiebt, dupliziert und löscht das ausgewählte Element', async () => {
    const store = await withPages(1)
    mountView()
    const page = store.pages[0]!
    const id = store.addAnnotation(page.id, {
      kind: 'highlight',
      color: '#ff0',
      x: 5,
      y: 5,
      width: 20,
      height: 10,
    })!
    const arrow = press('ArrowRight')
    expect(arrow.defaultPrevented).toBe(true)
    press('ArrowDown', { shiftKey: true })
    expect(store.pages[0]!.annotations[0]).toMatchObject({ x: 6, y: 15 })
    // Nicht über den Seitenrand hinaus.
    press('ArrowLeft', { shiftKey: true })
    expect(store.pages[0]!.annotations[0]!.x).toBe(0)

    press('d', { ctrlKey: true })
    expect(store.pages[0]!.annotations).toHaveLength(2)
    expect(store.selectedAnnotationId).not.toBe(id)

    press('Delete')
    expect(store.pages[0]!.annotations.map((a) => a.id)).toEqual([id])
    press('Escape')
    expect(store.selectedAnnotationId).toBeNull()
  })

  it('wählt Werkzeuge und Zoom per Taste', async () => {
    const store = await withPages(1)
    mountView()
    press('t')
    expect(store.tool).toBe('text')
    press('h')
    expect(store.tool).toBe('highlight')
    press('v')
    expect(store.tool).toBe('select')
    press('+')
    expect(store.zoom).toBe(1.25)
    press('0')
    expect(store.zoom).toBe(1)
    press('b')
    expect(toolbarApi.openImage).toHaveBeenCalledTimes(1)
  })

  it('Strg+S / Strg+P öffnen den Dialog statt des Browser-Dialogs', async () => {
    await withPages(1)
    const w = mountView()
    const e = press('s', { ctrlKey: true })
    expect(e.defaultPrevented).toBe(true)
    await flushPromises()
    expect(w.findComponent({ name: 'ExportDialog' }).exists()).toBe(true)
  })
})
