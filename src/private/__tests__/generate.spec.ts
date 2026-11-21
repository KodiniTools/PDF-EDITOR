import { flushPromises, mount } from '@vue/test-utils'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import NewDocumentDialog from '@/private/components/NewDocumentDialog.vue'
import { parseDocument } from '@/private/generate/api'
import { renderDocument, renderEmpty, wrapText } from '@/private/generate/render'
import type { GeneratedDocument } from '@/private/generate/types'
import { estimateCost, formatUsd } from '@/private/models'
import { fileNameFor, useGenerateStore } from '@/private/stores/generate'
import { MODEL_STORAGE_KEY, useModelStore } from '@/private/stores/model'
import { postJson, SuggestApiError } from '@/private/suggestions/api'

const { addFiles, requestDocument } = vi.hoisted(() => ({
  addFiles: vi.fn<(files: readonly File[]) => Promise<{ added: number; errors: string[] }>>(
    async (files) => ({ added: files.length, errors: [] }),
  ),
  requestDocument: vi.fn<typeof import('@/private/generate/api').requestDocument>(),
}))
vi.mock('@/stores/document', () => ({
  useDocumentStore: () => ({ addFiles, hasDocument: false, pages: [], selectPage: vi.fn() }),
}))
vi.mock('@/private/generate/api', async (orig) => ({
  ...(await orig<typeof import('@/private/generate/api')>()),
  requestDocument,
}))

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const META = {
  model: 'claude-haiku-5-5',
  inputTokens: 1_000,
  outputTokens: 2_000,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  addFiles.mockClear()
  requestDocument.mockReset()
})

describe('renderEmpty', () => {
  it('erzeugt leere Seiten im Format, Querformat getauscht, begrenzt', async () => {
    const pdf = await PDFDocument.load(
      await renderEmpty({ format: 'A5', orientation: 'landscape', pages: 3 }),
    )
    expect(pdf.getPageCount()).toBe(3)
    const { width, height } = pdf.getPage(0).getSize()
    expect([Math.round(width), Math.round(height)]).toEqual([595, 420])
    const many = await PDFDocument.load(
      await renderEmpty({ format: 'Letter', orientation: 'portrait', pages: 500 }),
    )
    expect(many.getPageCount()).toBe(50)
    expect(many.getPage(0).getSize()).toEqual({ width: 612, height: 792 })
  })
})

describe('wrapText', () => {
  it('bricht innerhalb der Breite um, auch sehr lange Wörter', async () => {
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica)
    const lines = wrapText(`Kurzer Satz ${'x'.repeat(200)} Ende\n\nNeu`, font, 10, 100)
    expect(lines.length).toBeGreaterThan(4)
    for (const l of lines) expect(font.widthOfTextAtSize(l, 10)).toBeLessThanOrEqual(100)
    expect(lines.slice(-2)).toEqual(['', 'Neu'])
  })
})

describe('renderDocument', () => {
  const content: GeneratedDocument = {
    title: 'Vorlage',
    blocks: [
      { type: 'heading', level: 1, text: 'Rechnung 😀' },
      { type: 'paragraph', text: 'Łódź – Grüße. '.repeat(40) },
      { type: 'bullets', items: ['Eins', 'Zwei'] },
      { type: 'numbered', items: ['A', 'B'] },
      {
        type: 'table',
        header: true,
        rows: [
          ['Pos', 'Text', 'Betrag'],
          ...Array.from({ length: 80 }, (_, i) => [`${i}`, 'x', '1 €']),
        ],
      },
      { type: 'field', text: 'Datum, Unterschrift' },
      { type: 'field', text: 'Sehr lange Beschriftung '.repeat(20) },
      { type: 'divider' },
      { type: 'spacer' },
      { type: 'pagebreak' },
      { type: 'paragraph', text: 'Letzte Seite' },
    ],
  }

  it('setzt alle Blocktypen mit Seitenumbruch und Titel', async () => {
    const pdf = await PDFDocument.load(
      await renderDocument(content, { format: 'A4', orientation: 'portrait' }),
    )
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(3)
    expect(pdf.getTitle()).toBe('Vorlage')
    for (const page of pdf.getPages()) {
      expect(page.getSize()).toEqual({ width: 595.28, height: 841.89 })
    }
  })

  it('pagebreak am Seitenanfang erzeugt keine Leerseite', async () => {
    const pdf = await PDFDocument.load(
      await renderDocument(
        {
          title: 't',
          blocks: [{ type: 'pagebreak' }, { type: 'paragraph', text: 'a' }, { type: 'pagebreak' }],
        },
        { format: 'A3', orientation: 'landscape' },
      ),
    )
    expect(pdf.getPageCount()).toBe(1)
    expect(pdf.getPage(0).getSize().width).toBeCloseTo(1190.55)
  })
})

describe('parseDocument / fileNameFor', () => {
  it('übernimmt gültige Blöcke und verwirft unbekannte', () => {
    expect(
      parseDocument({
        document: {
          title: 'X',
          blocks: [
            { type: 'heading', level: 9, text: 'H' },
            { type: 'bild' },
            { type: 'table', rows: [['a', 1]], header: true },
          ],
        },
      }),
    ).toEqual({
      title: 'X',
      blocks: [
        { type: 'heading', level: 2, text: 'H' },
        { type: 'table', rows: [['a', '1']], header: true },
      ],
    })
    expect(() => parseDocument({ document: { blocks: [] } })).toThrow(SuggestApiError)
    expect(() => parseDocument({})).toThrow(SuggestApiError)
  })
  it('bildet sichere Dateinamen', () => {
    expect(fileNameFor('Rechnung: 2026/11')).toBe('Rechnung 2026 11.pdf')
    expect(fileNameFor('  ')).toBe('Neues Dokument.pdf')
  })
})

describe('Modellauswahl', () => {
  it('schickt das gewählte Modell mit und erfasst Modell, Tokens und Kosten', async () => {
    const models = useModelStore()
    models.selected = 'claude-haiku-5-5'
    const fetchFn = vi.fn<typeof fetch>(async () => json(200, { text: 'ok', meta: META }))
    await postJson('rewrite', { text: 'a' }, new AbortController().signal, fetchFn)
    const init = fetchFn.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({ text: 'a', model: 'claude-haiku-5-5' })
    expect(models.last).toMatchObject({ ...META, requested: 'claude-haiku-5-5' })
    expect(models.last?.cost).toBeCloseTo((1_000 * 0.1 + 2_000 * 0.5) / 1e6)
    expect(models.mismatch).toBe(false)
    expect(models.requests).toBe(1)
  })

  it('meldet, wenn ein anderes Modell geantwortet hat', async () => {
    const models = useModelStore()
    models.selected = 'claude-opus-5-5'
    await postJson('ask', {}, new AbortController().signal, async () =>
      json(200, { answer: 'x', meta: META }),
    )
    expect(models.mismatch).toBe(true)
  })

  it('lädt die Allowlist vom Server und speichert die Auswahl', async () => {
    localStorage.setItem(MODEL_STORAGE_KEY, 'claude-fable-5-2')
    const models = useModelStore()
    await models.loadAvailable(async () =>
      json(200, { ok: true, model: 'claude-sonnet-5-5', models: ['claude-sonnet-5-5', 'x'] }),
    )
    expect(models.available).toEqual(['claude-sonnet-5-5', 'x'])
    expect(models.selected).toBe('claude-sonnet-5-5')
    models.selected = 'x'
    await flushPromises()
    expect(localStorage.getItem(MODEL_STORAGE_KEY)).toBe('x')
  })

  it('bleibt bei Serverfehler bei der bekannten Liste', async () => {
    const models = useModelStore()
    await models.loadAvailable(async () => {
      throw new Error('offline')
    })
    expect(models.available).toContain('claude-opus-5-5')
  })

  it('schätzt Kosten nach Listenpreis', () => {
    expect(
      estimateCost({ ...META, model: 'claude-opus-5-5', inputTokens: 1e6, outputTokens: 0 }),
    ).toBe(4)
    expect(estimateCost({ ...META, inputTokens: 200_000, outputTokens: 0 })).toBeCloseTo(0.1)
    expect(estimateCost({ ...META, model: 'unbekannt' })).toBeNull()
    expect(formatUsd(0.001)).toBe('< $0.01')
    expect(formatUsd(1.234)).toBe('$1.23')
  })
})

describe('Neues Dokument (Store und Dialog)', () => {
  it('leeres Dokument: lokal, ohne KI-Anfrage', async () => {
    const ok = await useGenerateStore().createEmpty({
      format: 'Legal',
      orientation: 'portrait',
      pages: 2,
    })
    expect(ok).toBe(true)
    expect(requestDocument).not.toHaveBeenCalled()
    const file = addFiles.mock.calls[0]?.[0][0] as File
    expect(file.name).toBe('Neues Dokument.pdf')
    const pdf = await PDFDocument.load(await file.arrayBuffer())
    expect(pdf.getPageCount()).toBe(2)
    expect(pdf.getPage(0).getSize()).toEqual({ width: 612, height: 1008 })
  })

  it('Dialog: mit Beschreibung → KI im gewählten Format, Fehler sichtbar', async () => {
    requestDocument.mockRejectedValueOnce(new SuggestApiError('Claude hat abgelehnt.', 422))
    const w = mount(NewDocumentDialog)
    expect(w.get('[data-testid="new-doc-create"]').text()).toBe('Leer erstellen')
    await w.get('[data-testid="new-doc-format"]').setValue('A5')
    await w.get('[data-testid="new-doc-landscape"]').setValue(true)
    await w.get('[data-testid="new-doc-prompt"]').setValue('Protokollvorlage')
    expect(w.get('[data-testid="new-doc-create"]').text()).toBe('Mit KI erstellen')
    expect(w.get('[data-testid="new-doc-model"]').text()).toBe('Opus 5.5')
    await w.get('[data-testid="new-doc-create"]').trigger('click')
    await flushPromises()
    expect(requestDocument.mock.calls[0]?.[0]).toEqual({
      prompt: 'Protokollvorlage',
      format: 'A5',
      orientation: 'landscape',
      language: 'de',
    })
    expect(w.get('[role="alert"]').text()).toBe('Claude hat abgelehnt.')
    expect(w.emitted('close')).toBeUndefined()

    requestDocument.mockResolvedValueOnce({
      title: 'Protokoll',
      blocks: [{ type: 'heading', level: 1, text: 'Protokoll' }],
    })
    await w.get('[data-testid="new-doc-create"]').trigger('click')
    await flushPromises()
    expect(w.emitted('close')).toHaveLength(1)
    const file = addFiles.mock.calls[0]?.[0][0] as File
    expect(file.name).toBe('Protokoll.pdf')
    const pdf = await PDFDocument.load(await file.arrayBuffer())
    expect(Math.round(pdf.getPage(0).getSize().width)).toBe(595)
  })
})
