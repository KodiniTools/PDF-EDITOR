import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AppToolbar from '@/components/AppToolbar.vue'
import { useDocumentStore } from '@/stores/document'

vi.mock('@/services/pdfRenderer', () => ({
  openDocument: async () => [],
  closeDocument: async () => undefined,
  renderPage: async () => undefined,
  getTextLines: async () => [],
}))

describe('AppToolbar', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('zeigt ohne Dokument nur „PDF öffnen“', () => {
    const wrapper = mount(AppToolbar)
    expect(wrapper.text()).toContain('PDF öffnen')
    expect(wrapper.text()).not.toContain('Exportieren')
  })

  it('gibt ausgewählte Dateien weiter', async () => {
    const wrapper = mount(AppToolbar)
    const input = wrapper.get('[data-testid="file-input"]')
    const file = new File(['%PDF-'], 'a.pdf', { type: 'application/pdf' })
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    expect(wrapper.emitted('openFiles')?.[0]).toEqual([[file]])
  })

  it('fordert beim Signatur-Werkzeug ohne Signatur den Dialog an', async () => {
    const store = useDocumentStore()
    store.pages.push({
      id: 'p',
      sourceId: 's',
      sourceIndex: 0,
      box: { x: 0, y: 0, width: 100, height: 100 },
      baseRotation: 0,
      rotation: 0,
      annotations: [],
    })
    const wrapper = mount(AppToolbar)
    const btn = wrapper.findAll('button').find((b) => b.text() === 'Signatur')
    await btn!.trigger('click')
    expect(store.tool).toBe('signature')
    expect(wrapper.emitted('editSignature')).toHaveLength(1)
  })

  it('zeigt im öffentlichen Build kein Schwärzen-Werkzeug', () => {
    const store = useDocumentStore()
    store.pages.push({
      id: 'p',
      sourceId: 's',
      sourceIndex: 0,
      box: { x: 0, y: 0, width: 100, height: 100 },
      baseRotation: 0,
      rotation: 0,
      annotations: [],
    })
    const wrapper = mount(AppToolbar)
    expect(wrapper.text()).toContain('Abdecken')
    expect(wrapper.text()).not.toContain('Schwärzen')
    expect(wrapper.text()).not.toContain('privat')
  })

  it('ändert die Farbe der ausgewählten Markierung sofort', async () => {
    const store = useDocumentStore()
    store.pages.push({
      id: 'p',
      sourceId: 's',
      sourceIndex: 0,
      box: { x: 0, y: 0, width: 100, height: 100 },
      baseRotation: 0,
      rotation: 0,
      annotations: [],
    })
    store.selectedPageId = 'p'
    const id = store.addAnnotation('p', {
      kind: 'highlight',
      color: '#facc15',
      x: 1,
      y: 1,
      width: 10,
      height: 10,
    })
    const wrapper = mount(AppToolbar)
    // Ohne Auswahl und ohne Markier-Werkzeug gibt es keinen Farbwähler.
    store.selectedAnnotationId = null
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="highlight-color"]').exists()).toBe(false)

    store.selectedAnnotationId = id
    await wrapper.vm.$nextTick()
    const input = wrapper.get('[data-testid="highlight-color"]')
    expect((input.element as HTMLInputElement).value).toBe('#facc15')

    // `input` feuert schon während der Auswahl im Farbfenster.
    await input.setValue('#00ff00')
    expect(store.pages[0]!.annotations[0]).toMatchObject({ kind: 'highlight', color: '#00ff00' })
    expect(store.highlightColor).toBe('#00ff00')

    // Mehrere Farbwechsel sind ein einziger Undo-Schritt.
    await input.setValue('#0000ff')
    store.undo()
    expect(store.pages[0]!.annotations[0]).toMatchObject({ color: '#facc15' })
  })
})
