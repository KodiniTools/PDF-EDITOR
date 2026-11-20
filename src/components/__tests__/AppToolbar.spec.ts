import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AppToolbar from '@/components/AppToolbar.vue'
import { useDocumentStore } from '@/stores/document'

vi.mock('@/services/pdfRenderer', () => ({
  openDocument: async () => [],
  closeDocument: async () => undefined,
  renderPage: async () => undefined,
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
})
