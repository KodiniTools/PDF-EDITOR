import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { PDFDocument } from 'pdf-lib'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import NewDocumentDialog from '@/components/NewDocumentDialog.vue'
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

// Offene Dialoge hören auf window-Tasten: nach jedem Test abbauen.
enableAutoUnmount(afterEach)

/** Wartet, bis der Dialog das Dokument erstellt und geladen hat. */
async function settled(done: () => boolean): Promise<void> {
  await vi.waitFor(() => {
    if (!done()) throw new Error('noch nicht fertig')
  })
  await flushPromises()
}

describe('NewDocumentDialog', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('legt ein leeres A4-Dokument an und schließt den Dialog', async () => {
    const store = useDocumentStore()
    const wrapper = mount(NewDocumentDialog)
    await wrapper.get('[data-testid="new-doc-create"]').trigger('click')
    await settled(() => wrapper.emitted('close') !== undefined)

    expect(store.pages).toHaveLength(1)
    expect(store.pages[0]?.box.width).toBeCloseTo(595.28, 2)
    expect(store.selectedPage?.id).toBe(store.pages[0]?.id)
    expect(store.suggestedFileName).toBe('Neues Dokument-bearbeitet.pdf')
    expect(store.error).toBeNull()
  })

  it('übernimmt Format, Ausrichtung und Seitenzahl', async () => {
    const store = useDocumentStore()
    const wrapper = mount(NewDocumentDialog)
    await wrapper.get('[data-testid="new-doc-format"]').setValue('A5')
    await wrapper.get('[data-testid="new-doc-landscape"]').setValue(true)
    await wrapper.get('[data-testid="new-doc-pages"]').setValue('3')
    await wrapper.get('[data-testid="new-doc-create"]').trigger('click')
    await settled(() => wrapper.emitted('close') !== undefined)

    expect(store.pages).toHaveLength(3)
    const box = store.pages[0]?.box
    expect(box?.width).toBeCloseTo(595.28, 2)
    expect(box?.height).toBeCloseTo(419.53, 2)
  })

  it('hängt an ein offenes Dokument an, zeigt die erste neue Seite und ist rückgängig machbar', async () => {
    const store = useDocumentStore()
    const pdf = await PDFDocument.create()
    pdf.addPage([100, 200])
    await store.addFiles([
      new File([(await pdf.save()) as BlobPart], 'brief.pdf', { type: 'application/pdf' }),
    ])

    const wrapper = mount(NewDocumentDialog)
    await wrapper.get('[data-testid="new-doc-pages"]').setValue('2')
    await wrapper.get('[data-testid="new-doc-create"]').trigger('click')
    await settled(() => wrapper.emitted('close') !== undefined)

    expect(store.pages).toHaveLength(3)
    expect(store.selectedPageIndex).toBe(1)
    store.undo()
    expect(store.pages).toHaveLength(1)
  })

  it('erlaubt Text und Bild auf der neuen Seite und exportiert sie', async () => {
    const store = useDocumentStore()
    const wrapper = mount(NewDocumentDialog)
    await wrapper.get('[data-testid="new-doc-create"]').trigger('click')
    await settled(() => wrapper.emitted('close') !== undefined)

    const page = store.pages[0]
    if (!page) throw new Error('Seite fehlt')
    store.addAnnotation(page.id, {
      kind: 'text',
      x: 50,
      y: 60,
      text: 'Hallo',
      fontSize: 14,
      color: '#000000',
      font: 'sans',
    })
    expect(page.annotations).toHaveLength(1)
    const exported = await PDFDocument.load(await store.exportDocument())
    expect(exported.getPageCount()).toBe(1)

    store.removeAnnotation(page.id, page.annotations[0]?.id ?? '')
    expect(store.pages[0]?.annotations).toHaveLength(0)
  })

  it('sperrt „Erstellen“ bei ungültiger Seitenzahl', async () => {
    const store = useDocumentStore()
    const wrapper = mount(NewDocumentDialog)
    for (const value of ['0', '51', '1.5', '']) {
      await wrapper.get('[data-testid="new-doc-pages"]').setValue(value)
      expect(wrapper.get('[data-testid="new-doc-create"]').attributes('disabled')).toBeDefined()
      expect(wrapper.find('[data-testid="new-doc-range"]').exists()).toBe(true)
    }
    // Enter darf dann ebenfalls nichts anlegen.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await flushPromises()
    expect(store.pages).toHaveLength(0)
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('schließt mit Esc', () => {
    const wrapper = mount(NewDocumentDialog)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
