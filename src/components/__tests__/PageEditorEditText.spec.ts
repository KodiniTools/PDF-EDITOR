import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PageEditor from '@/components/PageEditor.vue'
import type { TextLine } from '@/lib/textLines'
import { useDocumentStore } from '@/stores/document'

const LINE: TextLine = {
  key: '500:7000',
  text: 'Rechnung Nr. 42',
  x: 50,
  top: 91,
  width: 90,
  height: 12,
  baseline: 100,
  fontSize: 12,
  font: 'sans',
}

vi.mock('@/services/pdfRenderer', () => ({
  openDocument: async () => [],
  closeDocument: async () => undefined,
  renderPage: async () => undefined,
  getTextLines: async () => [LINE],
}))

describe('PageEditor – Text bearbeiten', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('ersetzt eine angeklickte Zeile durch Abdeckung + editierbaren Text', async () => {
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
    store.setTool('edit-text')
    const wrapper = mount(PageEditor, { props: { page: store.pages[0]! }, attachTo: document.body })
    await flushPromises()

    const lines = wrapper.findAll('[data-testid="text-line"]')
    expect(lines).toHaveLength(1)
    await lines[0]!.trigger('pointerdown', { button: 0 })
    await flushPromises()

    const anns = store.pages[0]!.annotations
    expect(anns.map((a) => a.kind)).toEqual(['cover', 'text'])
    expect(anns[1]).toMatchObject({ text: 'Rechnung Nr. 42', fontSize: 12, replacesKey: LINE.key })
    // Ersetzte Zeile wird nicht mehr als anklickbar angeboten, Textfeld ist offen.
    expect(wrapper.findAll('[data-testid="text-line"]')).toHaveLength(0)
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('Rechnung Nr. 42')

    await wrapper.get('textarea').setValue('Rechnung Nr. 43')
    expect(store.pages[0]!.annotations[1]).toMatchObject({ text: 'Rechnung Nr. 43' })
    wrapper.unmount()
  })
})
