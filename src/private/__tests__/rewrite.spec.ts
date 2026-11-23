import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TextPanel from '@/private/components/TextPanel.vue'
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
  it('erkennt Zeichen, die weder WinAnsi noch die Unicode-Schrift kennt', () => {
    expect(unsupportedChars('Grüße „Test“ – 5 € ß\nÀ')).toEqual([])
    expect(unsupportedChars('Čačak, Đakovo, ćevapi, Łódź, ğ')).toEqual([])
    expect(unsupportedChars('😀 Жд 😀')).toEqual(['😀', 'Ж', 'д'])
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

describe('TextPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    rewrite.mockReset()
    localStorage.clear()
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
    doc.selectedPageId = 'p1'
    doc.selectedAnnotationId = id
    const wrapper = mount(TextPanel)
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

  it('sendet Text ohne automatische Umbrüche und bricht das Ergebnis am Seitenrand um', async () => {
    const { doc, annotation, wrapper } = setup()
    doc.updateAnnotation('p1', annotation().id, { text: 'hallo\nwelt', softBreaks: [5] })
    await flushPromises()
    expect(wrapper.get<HTMLTextAreaElement>('[data-testid="text-panel-input"]').element.value).toBe(
      'hallo welt',
    )
    const long = Array.from({ length: 40 }, (_, i) => `Wort${i}`).join(' ')
    rewrite.mockResolvedValueOnce(long)
    await wrapper.get('[data-testid="assist-correct"]').trigger('click')
    await flushPromises()
    expect(rewrite.mock.calls[0]![0]).toMatchObject({ text: 'hallo welt' })

    await wrapper.get('[data-testid="assist-apply"]').trigger('click')
    const lines = annotation().text.split('\n')
    expect(lines.length).toBeGreaterThan(1)
    // Schätzbreite ohne Canvas: 0,55 × Schriftgröße je Zeichen; Seite ist 600 pt breit.
    for (const line of lines) expect(10 + line.length * 12 * 0.55).toBeLessThanOrEqual(600)
    expect(annotation().text.replace(/\n/g, ' ')).toBe(long)
    expect(annotation().softBreaks).toHaveLength(lines.length - 1)
    doc.undo()
    expect(annotation().text).toBe('hallo\nwelt')
  })

  it('bearbeitet den ausgewählten Text im Feld der Seitenleiste (ein Undo-Schritt)', async () => {
    const { doc, annotation, wrapper } = setup()
    const input = wrapper.get('[data-testid="text-panel-input"]')
    const long = Array.from({ length: 40 }, (_, i) => `Wort${i}`).join(' ')
    await input.setValue('Erste Fassung')
    await input.setValue(`${long}\nZweiter Absatz`)
    expect(annotation().text.endsWith('\nZweiter Absatz')).toBe(true)
    expect(annotation().text.split('\n').length).toBeGreaterThan(2)
    // Das Feld zeigt den Text ohne automatische Umbrüche.
    expect((input.element as HTMLTextAreaElement).value).toBe(`${long}\nZweiter Absatz`)
    await input.trigger('blur')
    doc.undo()
    expect(annotation().text).toBe('hallo welt')
  })

  it('zeigt ohne ausgewählten Text einen Hinweis und entfernt geleerten Text', async () => {
    const { doc, wrapper } = setup()
    const input = wrapper.get('[data-testid="text-panel-input"]')
    await input.setValue('')
    await input.trigger('blur')
    await flushPromises()
    expect(doc.pages[0]!.annotations).toHaveLength(0)
    expect(wrapper.find('[data-testid="text-panel-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="assist-correct"]').exists()).toBe(false)
  })

  it('übersetzt ersetzte PDF-Zeilen einzeilig in die gewählte Sprache', async () => {
    const { wrapper } = setup({ replacesKey: 'line-1' })
    rewrite.mockResolvedValueOnce('Bonjour')
    const select = wrapper.get('[data-testid="assist-language"]')
    expect(select.findAll('option').map((o) => o.text())).toEqual([
      'Deutsch',
      'Englisch',
      'Kroatisch',
      'Bosnisch',
      'Italienisch',
      'Spanisch',
      'Französisch',
      'Niederländisch',
      'Portugiesisch',
    ])
    await select.setValue('hr')
    expect(localStorage.getItem('pdf-editor-privat:zielsprache')).toBe('hr')
    await wrapper.get('[data-testid="assist-translate"]').trigger('click')
    await flushPromises()
    expect(rewrite.mock.calls[0]![0]).toEqual({
      text: 'hallo welt',
      mode: 'translate',
      language: 'hr',
      singleLine: true,
    })
  })

  it('zeigt Fehler und warnt vor nicht darstellbaren Zeichen', async () => {
    const { wrapper } = setup()
    rewrite.mockRejectedValueOnce(new SuggestApiError('Die KI ist gerade ausgelastet.', 429))
    await wrapper.get('[data-testid="assist-shorter"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toMatch(/ausgelastet/)

    rewrite.mockResolvedValueOnce('Đakovo 😀')
    await wrapper.get('[data-testid="assist-shorter"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toMatch(/wird im Export zu „\?“: 😀/)
  })
})
