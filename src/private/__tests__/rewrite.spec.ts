import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TextAssist from '@/private/components/TextAssist.vue'
import { unsupportedChars } from '@/private/rewrite/winAnsi'
import { SuggestApiError } from '@/private/suggestions/api'
import { useDocumentStore } from '@/stores/document'
import type { TextAnnotation } from '@/types/pdf'

const { rewrite } = vi.hoisted(() => ({
  rewrite: vi.fn<typeof import('@/private/rewrite/api').requestRewrite>(),
}))
vi.mock('@/services/pdfRenderer', () => ({
  openDocument: async () => [],
  closeDocument: async () => undefined,
  renderPage: async () => undefined,
  getTextLines: async () => [],
}))
vi.mock('@/private/rewrite/api', async (orig) => ({
  ...(await orig<typeof import('@/private/rewrite/api')>()),
  requestRewrite: rewrite,
}))

describe('unsupportedChars', () => {
  it('erkennt Zeichen außerhalb von WinAnsi', () => {
    expect(unsupportedChars('Grüße „Test“ – 5 € ß\nÀ')).toEqual([])
    expect(unsupportedChars('Łódź 😀 ğ ğ')).toEqual(['Ł', 'ź', '😀', 'ğ'])
  })
})

describe('requestRewrite', () => {
  it('sendet Text und Modus an api/rewrite', async () => {
    const { requestRewrite } =
      await vi.importActual<typeof import('@/private/rewrite/api')>('@/private/rewrite/api')
    const fetchFn = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ text: 'Hello' }), { status: 200 }),
    )
    const input = {
      text: 'Hallo',
      mode: 'translate' as const,
      language: 'en' as const,
      singleLine: true,
    }
    expect(await requestRewrite(input, new AbortController().signal, fetchFn)).toBe('Hello')
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(/api\/rewrite$/)
    expect(JSON.parse(String(init.body))).toEqual(input)
    await expect(
      requestRewrite(input, new AbortController().signal, async () => new Response('{}')),
    ).rejects.toBeInstanceOf(SuggestApiError)
  })
})

describe('TextAssist', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    rewrite.mockReset()
  })

  function setup(extra: Partial<TextAnnotation> = {}) {
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
    const id = doc.addAnnotation('p1', {
      kind: 'text',
      x: 10,
      y: 20,
      text: 'hallo welt',
      fontSize: 12,
      color: '#000000',
      ...extra,
    })!
    const annotation = () => doc.pages[0]!.annotations.find((a) => a.id === id) as TextAnnotation
    const wrapper = mount(TextAssist, {
      props: { pageId: 'p1', annotation: annotation(), zoom: 1 },
    })
    return { doc, annotation, wrapper }
  }

  it('zeigt eine Vorschau und übernimmt sie als ein Undo-Schritt', async () => {
    const { doc, annotation, wrapper } = setup()
    rewrite.mockResolvedValueOnce('Hallo Welt.')
    await wrapper.get('[data-testid="assist-correct"]').trigger('click')
    await flushPromises()
    expect(rewrite.mock.calls[0]![0]).toEqual({
      text: 'hallo welt',
      mode: 'correct',
      singleLine: false,
    })
    expect(wrapper.get('[data-testid="assist-result"]').text()).toBe('Hallo Welt.')
    expect(annotation().text).toBe('hallo welt') // noch nicht übernommen

    await wrapper.get('[data-testid="assist-apply"]').trigger('click')
    expect(annotation().text).toBe('Hallo Welt.')
    expect(wrapper.find('[data-testid="assist-result"]').exists()).toBe(false)
    doc.undo()
    expect(annotation().text).toBe('hallo welt')
  })

  it('übersetzt ersetzte PDF-Zeilen einzeilig in die gewählte Sprache', async () => {
    const { wrapper } = setup({ replacesKey: 'line-1' })
    rewrite.mockResolvedValueOnce('Bonjour')
    await wrapper.get('select').setValue('fr')
    await wrapper.get('[data-testid="assist-translate"]').trigger('click')
    await flushPromises()
    expect(rewrite.mock.calls[0]![0]).toEqual({
      text: 'hallo welt',
      mode: 'translate',
      language: 'fr',
      singleLine: true,
    })
  })

  it('zeigt Fehler und warnt vor nicht darstellbaren Zeichen', async () => {
    const { wrapper } = setup()
    rewrite.mockRejectedValueOnce(new SuggestApiError('Die KI ist gerade ausgelastet.', 429))
    await wrapper.get('[data-testid="assist-shorter"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toMatch(/ausgelastet/)

    rewrite.mockResolvedValueOnce('Łukasz')
    await wrapper.get('[data-testid="assist-shorter"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toMatch(/wird im Export zu „\?“: Ł/)
  })
})
