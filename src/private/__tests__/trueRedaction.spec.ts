// @vitest-environment node
import * as mupdf from 'mupdf'
import { degrees, PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'

import { displayToPdf } from '@/lib/geometry'
import { applyTrueRedactions, type RedactionRect } from '@/private/redaction/trueRedaction'
import type { PdfBox, Rotation } from '@/types/pdf'

const CROP: PdfBox = { x: 50, y: 100, width: 500, height: 600 }

/** Umkehrung von displayToPdf (affin) für Testzwecke. */
function pdfToDisplay(p: { x: number; y: number }, box: PdfBox, rot: Rotation) {
  const o = displayToPdf({ x: 0, y: 0 }, box, rot)
  const ex = displayToPdf({ x: 1, y: 0 }, box, rot)
  const ey = displayToPdf({ x: 0, y: 1 }, box, rot)
  const a = ex.x - o.x
  const b = ex.y - o.y
  const c = ey.x - o.x
  const d = ey.y - o.y
  const det = a * d - b * c
  const dx = p.x - o.x
  const dy = p.y - o.y
  return { x: (d * dx - c * dy) / det, y: (-b * dx + a * dy) / det }
}

/** Rechteck im Benutzerraum → Rechteck im angezeigten Raum. */
function userRectToDisplay(
  r: { x: number; y: number; width: number; height: number },
  rot: Rotation,
): RedactionRect {
  const p1 = pdfToDisplay({ x: r.x, y: r.y }, CROP, rot)
  const p2 = pdfToDisplay({ x: r.x + r.width, y: r.y + r.height }, CROP, rot)
  return {
    x: Math.min(p1.x, p2.x),
    y: Math.min(p1.y, p2.y),
    width: Math.abs(p1.x - p2.x),
    height: Math.abs(p1.y - p2.y),
  }
}

async function makePdf(rot: Rotation): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle('Geheimer Titel')
  doc.setAuthor('Max Mustermann')
  const page = doc.addPage([600, 800])
  page.setCropBox(CROP.x, CROP.y, CROP.width, CROP.height)
  page.setRotation(degrees(rot))
  const font = await doc.embedFont(StandardFonts.Helvetica)
  page.drawText('GEHEIM', { x: 100, y: 600, size: 20, font })
  page.drawText('BLEIBT', { x: 300, y: 600, size: 20, font })

  // Formularfeld mit Wert im zu schwärzenden Bereich
  const form = doc.getForm()
  const field = form.createTextField('iban')
  field.setText('DE89370400440532013000')
  field.addToPage(page, { x: 100, y: 300, width: 200, height: 20, font })
  return doc.save()
}

/** Gesamter dekomprimierter Dateiinhalt als Text (für Suchen nach Resten). */
function rawText(bytes: Uint8Array): string {
  const doc = new mupdf.PDFDocument(bytes)
  try {
    const buf = doc.saveToBuffer('decompress')
    return new TextDecoder('latin1').decode(buf.asUint8Array())
  } finally {
    doc.destroy()
  }
}

function hex(s: string, width: 2 | 4): string {
  return [...s].map((c) => c.charCodeAt(0).toString(16).padStart(width, '0')).join('')
}

/** Sucht einen String als Klartext, Hex (PDFDocEncoding) oder UTF-16BE-Hex. */
function containsSecret(raw: string, secret: string): boolean {
  const lower = raw.toLowerCase()
  return raw.includes(secret) || lower.includes(hex(secret, 2)) || lower.includes(hex(secret, 4))
}

function pageText(bytes: Uint8Array): string {
  const doc = new mupdf.PDFDocument(bytes)
  try {
    const page = doc.loadPage(0)
    return page.toStructuredText('preserve-whitespace').asText()
  } finally {
    doc.destroy()
  }
}

describe('applyTrueRedactions', () => {
  it.each([0, 90, 180, 270] as const)(
    'entfernt Text, Formularfeld und Metadaten im Bereich (Drehung %i°)',
    async (rot) => {
      const input = await makePdf(rot)
      expect(pageText(input)).toContain('GEHEIM')
      expect(containsSecret(rawText(input), 'DE89370400440532013000')).toBe(true)
      expect(containsSecret(rawText(input), 'Mustermann')).toBe(true)

      const rects = [
        userRectToDisplay({ x: 95, y: 590, width: 90, height: 30 }, rot), // „GEHEIM“
        userRectToDisplay({ x: 95, y: 295, width: 210, height: 30 }, rot), // Feld
      ]
      const { bytes, report } = await applyTrueRedactions(input, [rects])

      expect(report).toEqual({ areas: 2, removedAnnotations: 0, removedFields: 1 })
      const text = pageText(bytes)
      expect(text).not.toContain('GEHEIM')
      expect(text).toContain('BLEIBT')

      const raw = rawText(bytes)
      for (const secret of ['GEHEIM', 'DE89370400440532013000', 'Geheimer Titel', 'Mustermann']) {
        expect({ secret, found: containsSecret(raw, secret) }).toEqual({ secret, found: false })
      }
    },
  )

  it('lässt Seiten ohne Flächen unverändert lesbar und entfernt trotzdem Metadaten', async () => {
    const input = await makePdf(0)
    const { bytes, report } = await applyTrueRedactions(input, [])
    expect(report.areas).toBe(0)
    expect(pageText(bytes)).toContain('GEHEIM')
    expect(containsSecret(rawText(bytes), 'Geheimer Titel')).toBe(false)
  })

  it('entfernt Kommentare im Bereich und behält solche außerhalb', async () => {
    const src = new mupdf.PDFDocument(await makePdf(0))
    const page = src.loadPage(0)
    const inside = page.createAnnotation('FreeText')
    inside.setRect([60, 300, 200, 330])
    inside.setContents('Geheimkommentar')
    const outside = page.createAnnotation('FreeText')
    outside.setRect([300, 500, 450, 530])
    outside.setContents('Offener Kommentar')
    page.update()
    const input = src.saveToBuffer('').asUint8Array().slice()
    src.destroy()

    const { bytes, report } = await applyTrueRedactions(input, [
      [{ x: 50, y: 290, width: 200, height: 60 }],
    ])
    expect(report.removedAnnotations).toBe(1)
    const raw = rawText(bytes)
    expect(containsSecret(raw, 'Geheimkommentar')).toBe(false)
    expect(containsSecret(raw, 'Offener Kommentar')).toBe(true)
  })

  it('lehnt Flächen für nicht vorhandene Seiten ab', async () => {
    const input = await makePdf(0)
    await expect(applyTrueRedactions(input, [[], []])).rejects.toThrow(/nicht vorhandene Seiten/)
  })
})
