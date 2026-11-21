import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TextLine } from '@/lib/textLines'
import { requestAnswer } from '@/private/ask/api'
import { splitPageRefs } from '@/private/ask/pageRefs'
import { SuggestApiError } from '@/private/suggestions/api'
import {
  buildMessages,
  limitPages,
  MAX_HISTORY_CHARS,
  MAX_HISTORY_PAIRS,
  useAskStore,
} from '@/private/stores/ask'
import { useDocumentStore } from '@/stores/document'

const { answer } = vi.hoisted(() => ({
  answer: vi.fn<typeof import('@/private/ask/api').requestAnswer>(),
}))

function line(text: string): TextLine {
  return {
    key: text,
    text,
    x: 0,
    top: 0,
    width: 10,
    height: 10,
    baseline: 8,
    fontSize: 10,
    font: 'sans',
    segments: [],
  }
}

vi.mock('@/services/pdfRenderer', () => ({
  openDocument: async () => [],
  closeDocument: async () => undefined,
  renderPage: async () => undefined,
  getTextLines: async (_s: string, index: number): Promise<TextLine[]> =>
    index === 1 ? [] : [line(`Text Seite ${index + 1}`), line('   ')],
}))

vi.mock('@/private/ask/api', async (orig) => ({
  ...(await orig<typeof import('@/private/ask/api')>()),
  requestAnswer: answer,
}))

const { ocrRequest } = vi.hoisted(() => ({
  ocrRequest: vi.fn<typeof import('@/private/ocr/api').requestOcr>(),
}))
vi.mock('@/private/ocr/render', () => ({
  renderPageImage: async () => ({
    image: { image: 'x', mediaType: 'image/jpeg', width: 1000, height: 1000 },
    display: { width: 600, height: 800 },
  }),
}))
vi.mock('@/private/ocr/api', () => ({ requestOcr: ocrRequest }))

function setup(pageCount = 3) {
  const doc = useDocumentStore()
  for (let i = 0; i < pageCount; i++) {
    doc.pages.push({
      id: `p${i + 1}`,
      sourceId: 's',
      sourceIndex: i,
      box: { x: 0, y: 0, width: 600, height: 800 },
      baseRotation: 0,
      rotation: 0,
      annotations: [],
    })
  }
  return { doc, ask: useAskStore() }
}

describe('splitPageRefs', () => {
  it('macht gültige Seitenverweise anklickbar', () => {
    const parts = splitPageRefs('Frist 30 Tage (S. 2, 3). Siehe auch (Seite 9).', 5)
    expect(parts.filter((p) => p.kind === 'page').map((p) => p.page)).toEqual([2, 3])
    expect(parts.map((p) => (p.kind === 'page' ? p.label : p.text)).join('')).toBe(
      'Frist 30 Tage (S. 2, 3). Siehe auch (Seite 9).',
    )
  })
  it('unterstützt Bereiche und lässt Text ohne Verweis unverändert', () => {
    expect(splitPageRefs('(S. 1–2)', 2).filter((p) => p.kind === 'page')).toHaveLength(2)
    expect(splitPageRefs('Kein Verweis (S. x)', 2)).toEqual([
      { kind: 'text', text: 'Kein Verweis (S. x)' },
    ])
  })
})

describe('limitPages / buildMessages', () => {
  it('kürzt zeilenweise und meldet das', () => {
    const r = limitPages(
      [
        { page: 1, lines: ['a'.repeat(10)] },
        { page: 2, lines: ['b'.repeat(10), 'c'.repeat(10)] },
      ],
      25,
    )
    expect(r.truncated).toBe(true)
    expect(r.pages).toEqual([
      { page: 1, lines: ['a'.repeat(10)] },
      { page: 2, lines: ['b'.repeat(10)] },
    ])
    expect(limitPages([{ page: 1, lines: ['x'] }], 25).truncated).toBe(false)
  })
  const history = (n: number, answerLength: number) =>
    Array.from({ length: n }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: i % 2 === 0 ? `F${i}` : 'A'.repeat(answerLength),
    }))

  it('begrenzt die Anzahl der Nachrichten und beginnt immer mit einer Frage', () => {
    const msgs = buildMessages(history(50, 10), 'Neu?')
    expect(msgs).toHaveLength(MAX_HISTORY_PAIRS * 2 + 1)
    expect(msgs[0]).toEqual({ role: 'user', content: 'F12' })
    expect(msgs[msgs.length - 1]).toEqual({ role: 'user', content: 'Neu?' })
    expect(buildMessages(history(3, 10).slice(1), 'Neu?')[0]?.role).toBe('user')
  })

  it('kürzt lange Antworten und hält das Zeichenbudget ein', () => {
    const msgs = buildMessages(history(50, 20_000), 'Neu?')
    expect(Math.max(...msgs.map((m) => m.content.length))).toBe(16_000)
    expect(msgs.reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(
      MAX_HISTORY_CHARS + 4,
    )
    expect(msgs[0]?.role).toBe('user')
    expect(msgs.map((m) => m.role).join()).toMatch(/^(user,assistant,)*user$/)
  })
})

describe('requestAnswer', () => {
  it('sendet Seiten und Verlauf an api/ask', async () => {
    const fetchFn = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ answer: 'Ja (S. 1)' }), { status: 200 }),
    )
    const pages = [{ page: 1, lines: ['x'] }]
    const messages = [{ role: 'user' as const, content: 'Frage?' }]
    const { requestAnswer: real } =
      await vi.importActual<typeof import('@/private/ask/api')>('@/private/ask/api')
    expect(await real(pages, messages, new AbortController().signal, fetchFn)).toBe('Ja (S. 1)')
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(/api\/ask$/)
    expect(JSON.parse(String(init.body))).toEqual({ pages, messages })
    await expect(
      real(pages, messages, new AbortController().signal, async () => new Response('{}')),
    ).rejects.toBeInstanceOf(SuggestApiError)
    expect(requestAnswer).toBe(answer) // Store nutzt die gemockte Variante
  })
})

describe('useAskStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    answer.mockReset()
    ocrRequest.mockReset()
    ocrRequest.mockResolvedValue([])
  })

  it('sendet den Text aller Seiten und speichert Frage und Antwort', async () => {
    const { ask } = setup()
    answer.mockResolvedValueOnce('Antwort (S. 1)')
    expect(await ask.ask('  Worum geht es?  ')).toBeNull()
    const [pages, messages] = answer.mock.calls[0]!
    expect(pages).toEqual([
      { page: 1, lines: ['Text Seite 1'] },
      { page: 3, lines: ['Text Seite 3'] },
    ])
    expect(messages).toEqual([{ role: 'user', content: 'Worum geht es?' }])
    expect(ask.pagesWithoutText).toBe(1)
    expect(ask.entries.map((e) => e.content)).toEqual(['Worum geht es?', 'Antwort (S. 1)'])
    expect(ask.busy).toBe(false)

    answer.mockResolvedValueOnce('Zweite')
    await ask.ask('Und?')
    expect(answer.mock.calls[1]![1].map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
  })

  it('lässt den Verlauf bei Fehlern unverändert und gibt die Frage zurück', async () => {
    const { ask } = setup()
    answer.mockRejectedValueOnce(new SuggestApiError('Die KI ist gerade ausgelastet.', 429))
    expect(await ask.ask('Frage')).toBe('Frage')
    expect(ask.entries).toHaveLength(0)
    expect(ask.error).toMatch(/ausgelastet/)
  })

  it('bricht ab und leert das Gespräch beim Schließen des Dokuments', async () => {
    const { doc, ask } = setup()
    answer.mockImplementationOnce(
      (_p, _m, signal) =>
        new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(new DOMException('x', 'AbortError'))),
        ),
    )
    const pending = ask.ask('Lange Frage')
    await vi.waitFor(() => expect(answer).toHaveBeenCalled())
    expect(ask.busy).toBe(true)
    ask.cancel()
    expect(await pending).toBe('Lange Frage')
    expect(ask.busy).toBe(false)
    expect(ask.error).toBeNull()

    answer.mockResolvedValueOnce('A')
    await ask.ask('F')
    expect(ask.entries).toHaveLength(2)
    doc.pages.splice(0)
    await nextTick()
    expect(ask.entries).toHaveLength(0)
  })

  it('meldet Dokumente ohne Text, ohne das Backend zu fragen', async () => {
    const doc = useDocumentStore()
    doc.pages.push({
      id: 'scan',
      sourceId: 's',
      sourceIndex: 1,
      box: { x: 0, y: 0, width: 600, height: 800 },
      baseRotation: 0,
      rotation: 0,
      annotations: [],
    })
    const ask = useAskStore()
    expect(await ask.ask('Was steht drin?')).toBe('Was steht drin?')
    expect(ask.error).toMatch(/keinen erkennbaren Text/)
    expect(answer).not.toHaveBeenCalled()
  })

  it('bezieht gescannte Seiten per Bilderkennung ein (einmal, dann aus dem Cache)', async () => {
    const { ask } = setup()
    ocrRequest.mockResolvedValue([{ text: 'Gescannter Text', box: [0, 0, 100, 20] }])
    answer.mockResolvedValue('A')
    await ask.ask('Frage 1')
    expect(answer.mock.calls[0]![0]).toEqual([
      { page: 1, lines: ['Text Seite 1'] },
      { page: 2, lines: ['Gescannter Text'] },
      { page: 3, lines: ['Text Seite 3'] },
    ])
    expect(ask.ocrPages).toBe(1)
    expect(ask.pagesWithoutText).toBe(0)
    await ask.ask('Frage 2')
    expect(ocrRequest).toHaveBeenCalledTimes(1)
    expect(ask.reading).toBeNull()
  })
})
