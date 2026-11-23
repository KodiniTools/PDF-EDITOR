import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'

import {
  exportPdf,
  PdfEditorError,
  sanitizeForFont,
  standardFontFor,
  validatePdf,
} from '@/services/pdfExport'
import type { PageRef } from '@/types/pdf'

/** Erzeugt ein PDF mit Seiten unterschiedlicher Breite, um die Reihenfolge prüfen zu können. */
async function makePdf(widths: number[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (const w of widths) doc.addPage([w, 800])
  return doc.save()
}

function ref(
  sourceId: string,
  sourceIndex: number,
  width: number,
  extra: Partial<PageRef> = {},
): PageRef {
  return {
    id: `${sourceId}-${sourceIndex}`,
    sourceId,
    sourceIndex,
    box: { x: 0, y: 0, width, height: 800 },
    baseRotation: 0,
    rotation: 0,
    annotations: [],
    ...extra,
  }
}

// 1×1 transparentes PNG
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

describe('validatePdf', () => {
  it('akzeptiert gültige PDFs', async () => {
    await expect(validatePdf(await makePdf([100]))).resolves.toBeUndefined()
  })

  it('lehnt Müll mit PdfEditorError ab', async () => {
    await expect(validatePdf(new TextEncoder().encode('kein pdf'))).rejects.toBeInstanceOf(
      PdfEditorError,
    )
  })
})

describe('exportPdf', () => {
  it('führt zusammen, sortiert um und lässt gelöschte Seiten weg', async () => {
    const sources = new Map([
      ['a', await makePdf([100, 200, 300])],
      ['b', await makePdf([400])],
    ])
    // Reihenfolge: b0, a2, a0 (a1 gelöscht)
    const pages = [ref('b', 0, 400), ref('a', 2, 300), ref('a', 0, 100)]
    const out = await PDFDocument.load(await exportPdf(sources, pages))
    expect(out.getPageCount()).toBe(3)
    expect(out.getPages().map((p) => p.getWidth())).toEqual([400, 300, 100])
  })

  it('setzt die Gesamtdrehung (Original + Nutzer)', async () => {
    const sources = new Map([['a', await makePdf([100])]])
    const pages = [ref('a', 0, 100, { baseRotation: 90, rotation: 270 })]
    const out = await PDFDocument.load(await exportPdf(sources, pages))
    expect(out.getPage(0).getRotation().angle).toBe(0)

    const pages2 = [ref('a', 0, 100, { rotation: 90 })]
    const out2 = await PDFDocument.load(await exportPdf(sources, pages2))
    expect(out2.getPage(0).getRotation().angle).toBe(90)
  })

  it('zeichnet Annotationen ohne Fehler (inkl. Umlaute, Emoji, Bild)', async () => {
    const sources = new Map([['a', await makePdf([600])]])
    const page = ref('a', 0, 600, {
      rotation: 90,
      annotations: [
        {
          id: '1',
          kind: 'text',
          text: 'Grüße\nZeile 2 🙂',
          fontSize: 12,
          color: '#ff0000',
          x: 10,
          y: 10,
        },
        { id: '2', kind: 'highlight', color: '#ffff00', x: 20, y: 40, width: 100, height: 20 },
        { id: '3', kind: 'image', dataUrl: PNG, x: 50, y: 50, width: 40, height: 20 },
        {
          id: '5',
          kind: 'text',
          text: 'Serif',
          font: 'serif',
          fontSize: 10,
          color: '#000',
          x: 0,
          y: 0,
        },
        { id: '4', kind: 'cover', color: '#ffffff', x: 5, y: 5, width: 60, height: 15 },
      ],
    })
    const bytes = await exportPdf(sources, [page])
    const out = await PDFDocument.load(bytes)
    expect(out.getPageCount()).toBe(1)
    expect(bytes.length).toBeGreaterThan(500)
  })

  it('wirft ohne Seiten oder bei fehlender Quelle', async () => {
    await expect(exportPdf(new Map(), [])).rejects.toBeInstanceOf(PdfEditorError)
    await expect(exportPdf(new Map(), [ref('x', 0, 100)])).rejects.toBeInstanceOf(PdfEditorError)
  })
})

describe('sanitizeForFont', () => {
  it('ersetzt nicht kodierbare Zeichen', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    expect(sanitizeForFont('Äpfel € 🙂', font)).toBe('Äpfel € ?')
  })
})

describe('Textformat im Export', () => {
  it('wählt den Schnitt der Standardschrift', () => {
    const plain = { bold: false, italic: false }
    expect(standardFontFor('sans', plain)).toBe(StandardFonts.Helvetica)
    expect(standardFontFor('sans', { bold: true, italic: false })).toBe(StandardFonts.HelveticaBold)
    expect(standardFontFor('serif', { bold: false, italic: true })).toBe(
      StandardFonts.TimesRomanItalic,
    )
    expect(standardFontFor('mono', { bold: true, italic: true })).toBe(
      StandardFonts.CourierBoldOblique,
    )
  })

  it('bettet für fette, kursive und ausgerichtete Texte die passenden Schriften ein', async () => {
    const sources = new Map([['a', await makePdf([300])]])
    const text = { kind: 'text' as const, x: 10, y: 20, fontSize: 12, color: '#000000' }
    const bytes = await exportPdf(sources, [
      ref('a', 0, 300, {
        annotations: [
          { ...text, id: 't1', text: 'normal' },
          { ...text, id: 't2', text: 'fett\nzweite Zeile', bold: true, align: 'right' },
          { ...text, id: 't3', text: 'kursiv', italic: true, font: 'serif', align: 'center' },
          { ...text, id: 't4', text: 'beides', bold: true, italic: true, font: 'mono' },
        ],
      }),
    ])
    const doc = await PDFDocument.load(bytes)
    const names = doc.context
      .enumerateIndirectObjects()
      .map(([, obj]) => String(obj))
      .filter((s) => s.includes('/BaseFont'))
      .map((s) => /\/BaseFont\s*\/([\w-]+)/.exec(s)?.[1])
      .sort()
    expect(names).toEqual(['Courier-BoldOblique', 'Helvetica', 'Helvetica-Bold', 'Times-Italic'])
  })
})
