import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AskPanel from '@/private/components/AskPanel.vue'
import { useDocumentStore } from '@/stores/document'

const { answer } = vi.hoisted(() => ({
  answer: vi.fn<typeof import('@/private/ask/api').requestAnswer>(),
}))

vi.mock('@/services/pdfRenderer', () => ({
  openDocument: async () => [],
  closeDocument: async () => undefined,
  renderPage: async () => undefined,
  getTextLines: async () => [
    {
      key: 'a',
      text: 'Zahlbar bis 31.12.',
      x: 0,
      top: 0,
      width: 10,
      height: 10,
      baseline: 8,
      fontSize: 10,
      font: 'sans',
      segments: [],
    },
  ],
}))

vi.mock('@/private/ask/api', async (orig) => ({
  ...(await orig<typeof import('@/private/ask/api')>()),
  requestAnswer: answer,
}))

describe('AskPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    answer.mockReset()
  })

  it('stellt Fragen und springt über Seitenverweise zur Seite', async () => {
    const doc = useDocumentStore()
    for (const id of ['p1', 'p2']) {
      doc.pages.push({
        id,
        sourceId: 's',
        sourceIndex: 0,
        box: { x: 0, y: 0, width: 600, height: 800 },
        baseRotation: 0,
        rotation: 0,
        annotations: [],
      })
    }
    doc.selectedPageId = 'p1'
    answer.mockResolvedValueOnce('Bis 31.12. (S. 2)')

    const wrapper = mount(AskPanel)
    await wrapper.get('[data-testid="ask-input"]').setValue('Bis wann?')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[data-testid="ask-question"]').text()).toBe('Bis wann?')
    expect(wrapper.get('[data-testid="ask-answer"]').text()).toBe('Bis 31.12. (S. 2)')
    expect((wrapper.get('[data-testid="ask-input"]').element as HTMLTextAreaElement).value).toBe('')
    await wrapper.get('[data-testid="ask-answer"] button').trigger('click')
    expect(doc.selectedPageId).toBe('p2')
  })

  it('stellt die Frage nach einem Fehler wieder ins Eingabefeld', async () => {
    const doc = useDocumentStore()
    doc.pages.push({
      id: 'p1',
      sourceId: 's',
      sourceIndex: 0,
      box: { x: 0, y: 0, width: 600, height: 800 },
      baseRotation: 0,
      rotation: 0,
      annotations: [],
    })
    answer.mockRejectedValueOnce(new Error('kaputt'))
    const wrapper = mount(AskPanel)
    await wrapper.get('[data-testid="ask-input"]').setValue('Frage?')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect((wrapper.get('[data-testid="ask-input"]').element as HTMLTextAreaElement).value).toBe(
      'Frage?',
    )
  })
})
