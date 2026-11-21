import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PageEditor from '@/components/PageEditor.vue'
import { useDocumentStore } from '@/stores/document'

vi.mock('@/services/pdfRenderer', () => ({
  openDocument: async () => [],
  closeDocument: async () => undefined,
  renderPage: async () => undefined,
  getTextLines: async () => [],
}))

function setup() {
  const store = useDocumentStore()
  store.pages.push({
    id: 'p1',
    sourceId: 's',
    sourceIndex: 0,
    box: { x: 0, y: 0, width: 600, height: 800 },
    baseRotation: 0,
    rotation: 0,
    annotations: [],
  })
  store.selectedPageId = 'p1'
  const wrapper = mount(PageEditor, { props: { page: store.pages[0]! }, attachTo: document.body })
  return { store, wrapper }
}

describe('PageEditor', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('legt mit dem Text-Werkzeug eine Annotation an und verwirft sie leer', async () => {
    const { store, wrapper } = setup()
    store.setTool('text')
    const overlay = wrapper.get('[data-testid="overlay"]')

    await overlay.trigger('pointerdown', { button: 0, clientX: 10, clientY: 10 })
    await flushPromises()
    expect(store.pages[0]!.annotations).toHaveLength(1)
    expect(wrapper.find('textarea').exists()).toBe(true)

    // Klick an anderer Stelle: leere Annotation wird entfernt, neue entsteht.
    await overlay.trigger('pointerdown', { button: 0, clientX: 50, clientY: 50 })
    await flushPromises()
    expect(store.pages[0]!.annotations).toHaveLength(1)

    await wrapper.get('textarea').setValue('Hallo')
    expect(store.pages[0]!.annotations[0]).toMatchObject({ kind: 'text', text: 'Hallo' })
    wrapper.unmount()
  })

  it('ignoriert Klicks im Auswahl-Werkzeug', async () => {
    const { store, wrapper } = setup()
    await wrapper.get('[data-testid="overlay"]').trigger('pointerdown', { button: 0 })
    expect(store.pages[0]!.annotations).toHaveLength(0)
    wrapper.unmount()
  })

  it('legt mit dem Schwärzen-Werkzeug eine echte Schwärzung an', async () => {
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>
    proto.setPointerCapture ??= () => undefined
    proto.releasePointerCapture ??= () => undefined
    proto.hasPointerCapture ??= () => false
    const { store, wrapper } = setup()
    store.setTool('redact')
    const overlay = wrapper.get('[data-testid="overlay"]')

    await overlay.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 10, clientY: 20 })
    await overlay.trigger('pointermove', { pointerId: 1, clientX: 110, clientY: 40 })
    await overlay.trigger('pointerup', { pointerId: 1, clientX: 110, clientY: 40 })

    expect(store.pages[0]!.annotations).toHaveLength(1)
    expect(store.pages[0]!.annotations[0]).toMatchObject({
      kind: 'cover',
      redact: true,
      color: '#000000',
      x: 10,
      y: 20,
      width: 100,
      height: 20,
    })
    expect(wrapper.find('[data-testid="redaction"]').exists()).toBe(true)
    wrapper.unmount()
  })
})
