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
})
