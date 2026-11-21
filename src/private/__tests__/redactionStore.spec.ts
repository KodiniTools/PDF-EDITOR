import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TextLine } from '@/lib/textLines'
import { batchPages, useRedactionStore } from '@/private/stores/redaction'
import { useDocumentStore } from '@/stores/document'

const { requestSuggestions } = vi.hoisted(() => ({
  requestSuggestions: vi.fn<typeof import('@/private/suggestions/api').requestSuggestions>(),
}))

vi.mock('@/services/pdfRenderer', () => ({
  openDocument: async () => [],
  closeDocument: async () => undefined,
  renderPage: async () => undefined,
  getTextLines: async (_s: string, index: number): Promise<TextLine[]> =>
    index === 0
      ? [
          {
            key: 'a',
            text: 'Kunde: Max Mustermann',
            x: 50,
            top: 100,
            width: 105,
            height: 12,
            baseline: 109,
            fontSize: 10,
            font: 'sans',
            segments: [{ start: 0, end: 21, x: 50, width: 105 }],
          },
        ]
      : [],
}))

// jsdom hat kein Canvas → Zeichenzahl als Maß (deterministisch).
vi.mock('@/private/suggestions/measure', () => ({ getMeasure: () => (t: string) => t.length }))

vi.mock('@/private/suggestions/api', async (orig) => ({
  ...(await orig<typeof import('@/private/suggestions/api')>()),
  requestSuggestions,
}))

function setup() {
  const doc = useDocumentStore()
  for (const [id, sourceIndex] of [
    ['p1', 0],
    ['p2', 1],
  ] as const) {
    doc.pages.push({
      id,
      sourceId: 's',
      sourceIndex,
      box: { x: 0, y: 0, width: 600, height: 800 },
      baseRotation: 0,
      rotation: 0,
      annotations: [],
    })
  }
  doc.selectedPageId = 'p1'
  return { doc, redaction: useRedactionStore() }
}

describe('batchPages', () => {
  it('teilt nach Zeichenzahl und kürzt Riesenseiten', () => {
    const pages = [
      { page: 1, lines: ['a'.repeat(40)] },
      { page: 2, lines: ['b'.repeat(40)] },
      { page: 3, lines: ['c'.repeat(60), 'd'.repeat(60)] },
    ]
    const batches = batchPages(pages, 100)
    expect(batches.map((b) => b.map((p) => p.page))).toEqual([[1, 2], [3]])
    expect(batches[1]![0]!.lines).toHaveLength(1)
  })
})

describe('useRedactionStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    requestSuggestions.mockReset()
  })

  it('verortet Vorschläge und übernimmt sie als echte Schwärzung (ein Undo-Schritt)', async () => {
    const { doc, redaction } = setup()
    requestSuggestions.mockResolvedValue([
      { page: 1, text: 'Max Mustermann', category: 'name', reason: 'Name' },
      { page: 1, text: 'Gibt es nicht', category: 'name', reason: '' },
    ])

    await redaction.analyze('all')

    // Seite 2 hat keinen Text → wird nicht gesendet
    expect(requestSuggestions).toHaveBeenCalledTimes(1)
    expect(requestSuggestions.mock.calls[0]![0]).toEqual([
      { page: 1, lines: ['Kunde: Max Mustermann'] },
    ])
    expect(redaction.pagesWithoutText).toBe(1)
    expect(redaction.status).toBe('done')
    expect(redaction.valid).toHaveLength(1)
    const rect = redaction.valid[0]!.rects[0]!
    // „Max Mustermann“ = Zeichen 7–21 von 21 auf 105 pt ab x 50
    expect(rect.x).toBeCloseTo(50 + 35 - 0.6)
    expect(rect.width).toBeCloseTo(70 + 1.2)

    expect(redaction.applySelected()).toBe(1)
    const ann = doc.pages[0]!.annotations
    expect(ann).toHaveLength(1)
    expect(ann[0]).toMatchObject({ kind: 'cover', redact: true, color: '#000000' })
    expect(redaction.valid).toHaveLength(0)

    doc.undo()
    expect(doc.pages[0]!.annotations).toHaveLength(0)
  })

  it('schlägt bereits geschwärzte Stellen nicht erneut vor', async () => {
    const { doc, redaction } = setup()
    doc.pages[0]!.annotations.push({
      id: 'r',
      kind: 'cover',
      redact: true,
      color: '#000000',
      x: 40,
      y: 90,
      width: 200,
      height: 30,
    })
    requestSuggestions.mockResolvedValue([
      { page: 1, text: 'Max Mustermann', category: 'name', reason: '' },
    ])
    await redaction.analyze('page')
    expect(redaction.valid).toHaveLength(0)
  })

  it('blendet Vorschläge nach dem Drehen der Seite aus', async () => {
    const { doc, redaction } = setup()
    requestSuggestions.mockResolvedValue([
      { page: 1, text: 'Max Mustermann', category: 'name', reason: '' },
    ])
    await redaction.analyze('page')
    expect(redaction.forPage('p1')).toHaveLength(1)
    doc.rotatePage('p1', 'cw')
    expect(redaction.forPage('p1')).toHaveLength(0)
    expect(redaction.applySelected()).toBe(0)
  })

  it('zeigt Fehler des Backends an', async () => {
    const { redaction } = setup()
    const { SuggestApiError } = await import('@/private/suggestions/api')
    requestSuggestions.mockRejectedValue(new SuggestApiError('Die KI ist gerade ausgelastet.', 429))
    await redaction.analyze('all')
    expect(redaction.status).toBe('error')
    expect(redaction.error).toBe('Die KI ist gerade ausgelastet.')
  })
})
